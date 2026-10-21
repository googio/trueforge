import { OpenAPIHono } from '@hono/zod-openapi';
import { AgentSpecSchema, Sessions } from '@truefoundry/trueforge-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import type { Kysely } from 'kysely';
import { createClient } from 'redis';
import { createLogger } from 'winston';
import { createSessionsRouter } from '../../../src/apis/sessions';
import { createAppErrorHandler } from '../../../src/app';
import { TrueForgeAuthorizer } from '../../../src/auth/authorizer';
import type { RequestContext } from '../../../src/auth/identity';
import { EmptyUserDirectory, type UserDirectory } from '../../../src/auth/userDirectory';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAccessControlEntryStore } from '../../../src/db/sqlite/access-control-entry-store/SqliteAccessControlEntryStore';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxEnvironmentStore } from '../../../src/db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import type { Database } from '../../../src/db/sqlite/types';
import { SqliteWebSearchProviderStore } from '../../../src/db/sqlite/web-search-provider-store/SqliteWebSearchProviderStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { ListSessionAccessResponseSchema } from '../../../src/schemas/sessionAccess';
import type { DirectoryUser } from '../../../src/schemas/user';

const TENANT = 'default';
const SESSION_ID = 'shared-session';
const CALLER_HEADER = 'x-test-caller';

const USERS: DirectoryUser[] = [
  { id: 'alice', display_name: 'Alice', email: 'alice@example.com' },
  { id: 'bob', display_name: 'Bob', email: null },
];

function contextFor(subjectId: string): RequestContext {
  return {
    tenant_id: TENANT,
    subject: { id: subjectId, type: 'user', display_name: subjectId },
    roles: [],
    user_credential: null,
  };
}

class FakeUserDirectory implements UserDirectory {
  readonly getUsersByIdsCalls: string[][] = [];
  readonly #users: DirectoryUser[];

  constructor(users: DirectoryUser[]) {
    this.#users = users;
  }

  listUsers(): Promise<{ data: DirectoryUser[]; total: number }> {
    return Promise.resolve({ data: this.#users, total: this.#users.length });
  }

  getUsersByIds(input: { ids: readonly string[] }): Promise<DirectoryUser[]> {
    this.getUsersByIdsCalls.push([...input.ids]);
    const ids = new Set(input.ids);
    return Promise.resolve(this.#users.filter(user => ids.has(user.id)));
  }
}

function jsonInit(method: string, body: unknown, caller = 'owner'): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', [CALLER_HEADER]: caller },
    body: JSON.stringify(body),
  };
}

function asCaller(caller: string, method = 'GET'): RequestInit {
  return { method, headers: { [CALLER_HEADER]: caller } };
}

function buildApp(input: { db: Kysely<Database>; sessionStore: SqliteSessionStore; userDirectory: UserDirectory }) {
  const { db, sessionStore, userDirectory } = input;
  const agentStore = new SqliteAgentStore(db);
  const logger = createLogger({ silent: true });
  const app = new OpenAPIHono();
  app.route(
    '/',
    createSessionsRouter({
      sessions: new Sessions({ sessionStore }),
      sessionStore,
      accessControlEntryStore: new SqliteAccessControlEntryStore(db),
      userDirectory,
      activeTurns: new ActiveTurnRegistry(),
      resolveModelProviderStore: () => new SqliteModelProviderStore(db),
      resolveMcpServerStore: () => new SqliteMcpServerStore(db),
      resolveSkillStore: () => new SqliteSkillStore(db),
      resolveAgentStore: () => agentStore,
      resolveSandboxProviderStore: () => new SqliteSandboxProviderStore(db),
      sandboxEnvironmentStore: new SqliteSandboxEnvironmentStore(db),
      resolveWebSearchProviderStore: () => new SqliteWebSearchProviderStore(db),
      redis: createClient(),
      requestReplyRouter: new RequestReplyRouter(),
      resolveRequestContext: c => contextFor(c.req.header(CALLER_HEADER) ?? 'owner'),
      logger,
      authorizer: new TrueForgeAuthorizer(),
    }),
  );
  app.onError(createAppErrorHandler({ logger }));
  return app;
}

describe('session access API', () => {
  let db: Kysely<Database>;
  let sessionStore: SqliteSessionStore;
  let directory: FakeUserDirectory;
  let app: OpenAPIHono;

  beforeEach(async () => {
    db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    sessionStore = new SqliteSessionStore(db);
    directory = new FakeUserDirectory(USERS);
    app = buildApp({ db, sessionStore, userDirectory: directory });
    await sessionStore.createSession({
      tenant_id: TENANT,
      session_id: SESSION_ID,
      created_by_subject: { subject_id: 'owner', subject_type: 'user', subject_display_name: 'Owner' },
      agent: {
        type: 'inline',
        spec: AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' }),
      },
      custom: null,
      metadata: {},
      external_id: null,
      source: null,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function listGrants(): Promise<string[]> {
    const response = await app.request(`/${SESSION_ID}/access`, asCaller('owner'));
    expect(response.status).toBe(200);
    return ListSessionAccessResponseSchema.parse(await response.json()).data.map(grant => grant.subject_id);
  }

  async function grant(subjectIds: string[]): Promise<Response> {
    return app.request(
      `/${SESSION_ID}/access`,
      jsonInit('POST', { subjects: subjectIds.map(subject_id => ({ subject_type: 'user', subject_id })) }),
    );
  }

  describe('access rules', () => {
    it('rejects callers other than the session creator', async () => {
      const forbidden = { error: { message: 'Only the session creator can manage access to this session' } };

      const list = await app.request(`/${SESSION_ID}/access`, asCaller('alice'));
      expect(list.status).toBe(403);
      expect(await list.json()).toEqual(forbidden);

      const create = await app.request(
        `/${SESSION_ID}/access`,
        jsonInit('POST', { subjects: [{ subject_type: 'user', subject_id: 'bob' }] }, 'alice'),
      );
      expect(create.status).toBe(403);

      const remove = await app.request(`/${SESSION_ID}/access/user/bob`, asCaller('alice', 'DELETE'));
      expect(remove.status).toBe(403);
    });

    it('returns 404 for an unknown session', async () => {
      expect((await app.request('/missing/access', asCaller('owner'))).status).toBe(404);
      expect(
        (
          await app.request(
            '/missing/access',
            jsonInit('POST', { subjects: [{ subject_type: 'user', subject_id: 'alice' }] }),
          )
        ).status,
      ).toBe(404);
      expect((await app.request('/missing/access/user/alice', asCaller('owner', 'DELETE'))).status).toBe(404);
    });
  });

  describe('create', () => {
    it('grants users and returns the enriched list', async () => {
      const response = await grant(['alice', 'bob']);

      expect(response.status).toBe(201);
      const { data } = ListSessionAccessResponseSchema.parse(await response.json());
      expect(data).toEqual([
        expect.objectContaining({
          subject_type: 'user',
          subject_id: 'alice',
          subject_display_name: 'Alice',
          subject_email: 'alice@example.com',
          granted_by_subject: { subject_id: 'owner', subject_type: 'user', subject_display_name: 'owner' },
        }),
        expect.objectContaining({ subject_id: 'bob', subject_display_name: 'Bob', subject_email: null }),
      ]);
    });

    it('collapses duplicates and is idempotent', async () => {
      expect((await grant(['alice', 'alice'])).status).toBe(201);
      expect(directory.getUsersByIdsCalls[0]).toEqual(['alice']);

      const again = await grant(['alice']);
      expect(again.status).toBe(201);
      expect(ListSessionAccessResponseSchema.parse(await again.json()).data.map(g => g.subject_id)).toEqual(['alice']);
    });

    it('rejects granting the session creator', async () => {
      const response = await grant(['owner']);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'The session creator already has access.' } });
    });

    it('rejects unknown users without writing anything', async () => {
      const response = await grant(['alice', 'ghost', 'phantom']);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'Unknown users: ghost, phantom' } });
      expect(await listGrants()).toEqual([]);
    });

    it('rejects every user when no directory is configured', async () => {
      app = buildApp({ db, sessionStore, userDirectory: new EmptyUserDirectory() });

      const response = await grant(['alice']);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'Unknown users: alice' } });
    });

    it.each([
      ['an empty subject list', { subjects: [] }],
      [
        'more than 100 subjects',
        {
          subjects: Array.from({ length: 101 }, (_, i) => ({ subject_type: 'user', subject_id: `u${String(i)}` })),
        },
      ],
      ['an unsupported subject type', { subjects: [{ subject_type: 'tenant', subject_id: 'default' }] }],
    ])('rejects %s', async (_label, body) => {
      const response = await app.request(`/${SESSION_ID}/access`, jsonInit('POST', body));
      expect(response.status).toBe(400);
    });
  });

  describe('list', () => {
    it('keeps grants for users the directory no longer resolves', async () => {
      expect((await grant(['alice'])).status).toBe(201);
      app = buildApp({ db, sessionStore, userDirectory: new EmptyUserDirectory() });

      const response = await app.request(`/${SESSION_ID}/access`, asCaller('owner'));

      expect(response.status).toBe(200);
      expect(ListSessionAccessResponseSchema.parse(await response.json()).data).toEqual([
        expect.objectContaining({ subject_id: 'alice', subject_display_name: null, subject_email: null }),
      ]);
    });
  });

  describe('delete', () => {
    it('revokes an existing grant', async () => {
      expect((await grant(['alice', 'bob'])).status).toBe(201);

      const response = await app.request(`/${SESSION_ID}/access/user/alice`, asCaller('owner', 'DELETE'));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(await listGrants()).toEqual(['bob']);
    });

    it('returns 404 when there is no matching grant', async () => {
      const response = await app.request(`/${SESSION_ID}/access/user/alice`, asCaller('owner', 'DELETE'));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { message: 'No matching grant found.' } });
    });

    it('rejects an unsupported subject type', async () => {
      expect((await app.request(`/${SESSION_ID}/access/tenant/default`, asCaller('owner', 'DELETE'))).status).toBe(400);
    });
  });

  it('does not yet give granted users read access', async () => {
    expect((await grant(['alice'])).status).toBe(201);

    expect((await app.request(`/${SESSION_ID}`, asCaller('alice'))).status).toBe(403);
    expect((await app.request(`/${SESSION_ID}/events`, asCaller('alice'))).status).toBe(403);
  });
});
