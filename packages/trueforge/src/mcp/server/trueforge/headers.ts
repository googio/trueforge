export const X_TFG_TRUEFORGE_MCP = 'x-tfg-trueforge-mcp';

/**
 * Adds the TrueForge MCP marker without dropping headers already present on either a Request or
 * RequestInit. This is a coarse invocation gate, not an authentication boundary.
 */
export function withTrueForgeMcpHeader(fetchFn: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    headers.set(X_TFG_TRUEFORGE_MCP, 'true');
    return fetchFn(input, { ...init, headers });
  };
}
