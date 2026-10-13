/**
 * Authenticated, stateless Streamable HTTP endpoint for the TrueForge MCP (mounted at /mcp).
 *
 * Each request: authenticate → require the trusted invocation marker → build a request-scoped SDK client +
 * stateless MCP server → hand the Web Request to the transport. Nothing is retained across requests.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import type { ResolveRequestContext } from '../../../auth/identity';
import { createTrueForgeClient } from './client';
import { X_TFG_TRUEFORGE_MCP } from './headers';
import { createTrueForgeMcpServer } from './server';

export interface TrueForgeMcpRouterDeps {
  resolveRequestContext: ResolveRequestContext;
  /** Trusted self-origin base URL */
  serverUrl: string;
  version: string;
  logger: Logger;
}

export function requireTrueForgeMcpHeader(raw: string | undefined): void {
  if (raw === undefined) {
    throw new HTTPException(403, { message: `Missing ${X_TFG_TRUEFORGE_MCP} invocation marker` });
  }
}

export function createTrueForgeMcpRouter(deps: TrueForgeMcpRouterDeps): Hono {
  const router = new Hono();
  router.all('/', async c => {
    const requestContext = deps.resolveRequestContext(c);
    requireTrueForgeMcpHeader(c.req.header(X_TFG_TRUEFORGE_MCP));

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
