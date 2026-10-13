import { TrueForge } from '@truefoundry/trueforge-sdk';
import configuration from '../../../config';
import { internalTlsFetch, normalizeTlsUrl } from '../../../http/tls';

export const X_TFG_TRUEFORGE_MCP = 'x-tfg-trueforge-mcp';

const baseUrl = normalizeTlsUrl({ url: configuration.SERVER_URL, enabled: configuration.MTLS_ENABLED });
const fetch = internalTlsFetch(configuration);

function withTrueForgeMcpHeader(fetchFn: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    headers.set(X_TFG_TRUEFORGE_MCP, 'true');
    return fetchFn(input, { ...init, headers });
  };
}

/** Exact self-origin MCP endpoint and marked transport allowed to bypass the outbound SSRF guard. */
export const trueForgeMcpTrustedEndpoint = {
  url: new URL('/mcp', baseUrl).href,
  fetch: withTrueForgeMcpHeader(fetch),
};

/**
 * Request-scoped SDK client carrying the draft caller's credential. The service API key is
 * intentionally never used here.
 */
export function createTrueForgeMcpClient(input: { userCredential: string | null }): TrueForge {
  return new TrueForge({
    baseUrl,
    timeoutInSeconds: 60,
    ...(input.userCredential === null ? { auth: false } : { token: input.userCredential }),
    fetch,
  });
}
