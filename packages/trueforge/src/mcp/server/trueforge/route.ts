/**
 * Authenticated, stateless Streamable HTTP endpoint for the TrueForge MCP (mounted at /mcp).
 *
 * Each request: authenticate → parse server-generated session/turn metadata → revalidate draft
 * state → build a request-scoped SDK client + stateless MCP server → hand the Web Request to the
 * transport. Nothing is retained across requests.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import type { RequestContext, ResolveRequestContext } from '../../../auth/identity';
import { parseGatewayMetadataHeader, TFG_METADATA_PREFIX, X_TFY_METADATA } from '../../../truefoundry/gatewayMetadata';
import { createTrueForgeClient } from './client';
import { createTrueForgeMcpServer, TRUEFORGE_CONNECTOR_NAME } from './server';

export interface TrueForgeMcpRouterDeps {
  sessionStore: ISessionStore;
  resolveRequestContext: ResolveRequestContext;
  /** Trusted self-origin base URL */
  serverUrl: string;
  version: string;
  logger: Logger;
}

function requireMetadata(raw: string | undefined): { sessionId: string; turnId: string } {
  if (raw === undefined) {
    throw new HTTPException(400, { message: `Missing ${X_TFY_METADATA} turn metadata` });
  }
  const metadata = parseGatewayMetadataHeader(raw);
  const sessionId = metadata[`${TFG_METADATA_PREFIX}.session_id`];
  const turnId = metadata[`${TFG_METADATA_PREFIX}.turn_id`];
  if (sessionId === undefined || turnId === undefined) {
    throw new HTTPException(400, { message: 'Turn metadata must include session_id and turn_id' });
  }
  return { sessionId, turnId };
}

/**
 * Server-side draft-only enforcement. Routing metadata is revalidated against persisted session/turn
 * state — a Bearer token alone is insufficient. See docs-internal/trueforge-mcp-server.md §3.6.
 */
export async function validateDraftInvocation(input: {
  sessionStore: ISessionStore;
  requestContext: RequestContext;
  sessionId: string;
  turnId: string;
}): Promise<void> {
  const { sessionStore, requestContext, sessionId, turnId } = input;

  // Tenant scoping + existence (getSession is tenant-scoped, so a cross-tenant id reads as not found).
  const session = await sessionStore.getSession({ tenant_id: requestContext.tenant_id, session_id: sessionId });
  if (session === undefined) {
    throw new HTTPException(404, { message: 'Session not found' });
  }
  // Ownership: the authenticated subject must own the session.
  if (session.created_by_subject.subject_id !== requestContext.subject.id) {
    throw new HTTPException(403, { message: 'Session not owned by caller' });
  }
  // Draft sessions only: inline agent binding.
  if (session.agent.type !== 'inline') {
    throw new HTTPException(403, { message: 'The trueforge MCP is available only for draft (inline) sessions' });
  }
  // The inline spec must currently include the connector.
  const mcpServers = session.agent.spec.mcp_servers ?? [];
  if (!mcpServers.some(entry => entry.name === TRUEFORGE_CONNECTOR_NAME)) {
    throw new HTTPException(403, { message: 'Draft spec does not include the trueforge connector' });
  }
  // The turn must belong to the supplied session.
  const turn = await sessionStore.getTurn({ session_id: sessionId, turn_id: turnId });
  if (turn === undefined) {
    throw new HTTPException(404, { message: 'Turn not found for session' });
  }
}

export function createTrueForgeMcpRouter(deps: TrueForgeMcpRouterDeps): Hono {
  const router = new Hono();
  router.all('/', async c => {
    const requestContext = deps.resolveRequestContext(c);
    const { sessionId, turnId } = requireMetadata(c.req.header(X_TFY_METADATA));
    await validateDraftInvocation({ sessionStore: deps.sessionStore, requestContext, sessionId, turnId });

    // Built per request: the server's tools close over this caller's credential, and stateless
    // Streamable HTTP wants a fresh server+transport per request to isolate concurrent callers.
    const client = createTrueForgeClient({
      baseUrl: deps.serverUrl,
      userCredential: requestContext.user_credential,
    });
    const server = createTrueForgeMcpServer({ client, version: deps.version });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  });
  return router;
}
