import { withTrueForgeMcpHeader, X_TFG_TRUEFORGE_MCP } from '../../../../../src/mcp/server/trueforge/headers';

describe('withTrueForgeMcpHeader', () => {
  it('adds the invocation marker and preserves request and init headers', async () => {
    let receivedHeaders: Headers | undefined;
    const fetchFn = (async (_input, init) => {
      receivedHeaders = new Headers(init?.headers);
      return new Response();
    }) as typeof fetch;
    const wrappedFetch = withTrueForgeMcpHeader(fetchFn);
    const request = new Request('https://trueforge.example/mcp', {
      headers: { authorization: 'Bearer token', 'x-request-header': 'request' },
    });

    await wrappedFetch(request, { headers: { 'x-init-header': 'init' } });

    expect(receivedHeaders?.get(X_TFG_TRUEFORGE_MCP)).toBe('true');
    expect(receivedHeaders?.get('authorization')).toBe('Bearer token');
    expect(receivedHeaders?.get('x-request-header')).toBe('request');
    expect(receivedHeaders?.get('x-init-header')).toBe('init');
  });
});
