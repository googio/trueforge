import type { ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import { HTTPException } from 'hono/http-exception';
import type { RequestContext } from '../../../../../src/auth/identity';
import { validateDraftInvocation } from '../../../../../src/mcp/server/trueforge/route';

const CTX: RequestContext = {
  tenant_id: 'acme',
  subject: { id: 'alice', type: 'user', display_name: 'Alice' },
  roles: [],
  user_credential: 'tok',
};

function store(overrides: { session?: unknown; turn?: unknown }): ISessionStore {
  return {
    getSession: async () => overrides.session,
    getTurn: async () => overrides.turn,
  } as unknown as ISessionStore;
}

function inlineSession(extra?: { owner?: string; connector?: boolean; tenant?: string }) {
  return {
    tenant_id: extra?.tenant ?? 'acme',
    session_id: 's1',
    created_by_subject: { subject_id: extra?.owner ?? 'alice' },
    agent: {
      type: 'inline',
      spec: { mcp_servers: (extra?.connector ?? true) ? [{ name: 'trueforge' }] : [{ name: 'other' }] },
    },
  };
}

async function statusOf(promise: Promise<void>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof HTTPException) {
      return error.status;
    }
    throw error;
  }
}

describe('validateDraftInvocation', () => {
  const base = { requestContext: CTX, sessionId: 's1', turnId: 't1' };

  it('passes for an owned inline draft that includes the connector with a matching turn', async () => {
    const sessionStore = store({ session: inlineSession(), turn: { session_id: 's1', turn_id: 't1' } });
    await expect(validateDraftInvocation({ sessionStore, ...base })).resolves.toBeUndefined();
  });

  it('404 when the session is absent (covers cross-tenant ids)', async () => {
    const sessionStore = store({ session: undefined });
    await expect(statusOf(validateDraftInvocation({ sessionStore, ...base }))).resolves.toBe(404);
  });

  it('403 when the caller does not own the session', async () => {
    const sessionStore = store({ session: inlineSession({ owner: 'mallory' }), turn: {} });
    await expect(statusOf(validateDraftInvocation({ sessionStore, ...base }))).resolves.toBe(403);
  });

  it('403 for a non-inline (reference) session', async () => {
    const sessionStore = store({
      session: { tenant_id: 'acme', created_by_subject: { subject_id: 'alice' }, agent: { type: 'reference' } },
      turn: {},
    });
    await expect(statusOf(validateDraftInvocation({ sessionStore, ...base }))).resolves.toBe(403);
  });

  it('403 when the inline spec no longer includes the connector', async () => {
    const sessionStore = store({ session: inlineSession({ connector: false }), turn: {} });
    await expect(statusOf(validateDraftInvocation({ sessionStore, ...base }))).resolves.toBe(403);
  });

  it('404 when the turn does not belong to the session', async () => {
    const sessionStore = store({ session: inlineSession(), turn: undefined });
    await expect(statusOf(validateDraftInvocation({ sessionStore, ...base }))).resolves.toBe(404);
  });
});
