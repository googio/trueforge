/**
 * Authenticated, stateless Streamable HTTP endpoint for the TrueForge MCP (mounted at /mcp).
 *
 * Each request: authenticate → require the trusted invocation marker → build a request-scoped SDK client +
 * stateless MCP server → hand the Web Request to the transport. Nothing is retained across requests.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { TrueForge } from '@truefoundry/trueforge-sdk';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ResolveRequestContext } from '../../../auth/identity';
import configuration from '../../../config';
import { internalTlsFetch, normalizeTlsUrl } from '../../../http/tls';
import { createTrueForgeMcpServer } from './server';

export const X_TFG_TRUEFORGE_MCP = 'x-tfg-trueforge-mcp';

const baseUrl = normalizeTlsUrl({ url: configuration.SERVER_URL, enabled: configuration.MTLS_ENABLED });
const internalFetch = internalTlsFetch(configuration);

function withTrueForgeMcpHeader(fetchFn: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    headers.set(X_TFG_TRUEFORGE_MCP, 'true');
    return fetchFn(input, { ...init, headers, redirect: 'manual' });
  };
}

export function requireTrueForgeMcpHeader(raw: string | undefined): void {
  if (raw === undefined) {
    throw new HTTPException(403, { message: `Missing ${X_TFG_TRUEFORGE_MCP} invocation marker` });
  }
}

/**
 * Request-scoped SDK client carrying the draft caller's credential. The service API key is
 * intentionally never used here.
 */
function createTrueForgeSDKClient(input: { userCredential: string | null }): TrueForge {
  return new TrueForge({
    baseUrl,
    timeoutInSeconds: 60,
    ...(input.userCredential === null ? { auth: false } : { token: input.userCredential }),
    fetch: internalFetch,
  });
}

/** Canonical self-origin MCP connection with its marked, mTLS-aware fetch. */
export const trueForgeMcpConnection = {
  url: new URL('/mcp', baseUrl).href,
  fetch: withTrueForgeMcpHeader(internalFetch),
};

export interface TrueForgeMcpRouterDeps {
  resolveRequestContext: ResolveRequestContext;
  version: string;
}

export function createTrueForgeMcpRouter(deps: TrueForgeMcpRouterDeps): Hono {
  const router = new Hono();
  router.all('/', async c => {
    const requestContext = deps.resolveRequestContext(c);
    requireTrueForgeMcpHeader(c.req.header(X_TFG_TRUEFORGE_MCP));

    // Built per request: the server's tools close over this caller's credential, and stateless
    // Streamable HTTP wants a fresh server+transport per request to isolate concurrent callers.
    const client = createTrueForgeSDKClient({ userCredential: requestContext.user_credential });
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
