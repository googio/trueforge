/**
 * Request-scoped TrueForge SDK client for the TrueForge MCP.
 *
 * Base URL comes from trusted server config (never a tool arg or Host header). The draft caller's
 * bearer is forwarded as-is; a standalone request with no credential uses no auth. The service
 * `TRUEFORGE_API_KEY` is intentionally never used here.
 */
import { TrueForge } from '@truefoundry/trueforge-sdk';
import configuration from '../../../config';
import { createTlsFetch, normalizeTlsUrl } from '../../../http/tls';

export function createTrueForgeClient(input: { baseUrl: string; userCredential: string | null }): TrueForge {
  const tls = { enabled: configuration.MTLS_ENABLED, dir: configuration.MTLS_CERTS_DIR };
  const tlsFetch = createTlsFetch(tls);
  return new TrueForge({
    baseUrl: normalizeTlsUrl({ url: input.baseUrl, enabled: tls.enabled }),
    timeoutInSeconds: 60,
    ...(input.userCredential === null ? { auth: false } : { token: input.userCredential }),
    ...(tlsFetch === undefined ? {} : { fetch: tlsFetch }),
  });
}
