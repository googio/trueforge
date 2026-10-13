import { HTTPException } from 'hono/http-exception';
import { requireTrueForgeMcpHeader } from '../../../../../src/mcp/server/trueforge/route';

function statusOf(fn: () => void): number {
  try {
    fn();
    return 200;
  } catch (error) {
    if (error instanceof HTTPException) {
      return error.status;
    }
    throw error;
  }
}

describe('requireTrueForgeMcpHeader', () => {
  it('rejects a missing invocation marker', () => {
    expect(statusOf(() => requireTrueForgeMcpHeader(undefined))).toBe(403);
  });

  it('accepts the invocation marker without inspecting its contents', () => {
    expect(statusOf(() => requireTrueForgeMcpHeader('not-validated'))).toBe(200);
  });

  it('accepts an empty invocation marker because only presence is required', () => {
    expect(statusOf(() => requireTrueForgeMcpHeader(''))).toBe(200);
  });
});
