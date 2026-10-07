/** Shared success/error shaping for TrueForge tool results. */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toSafeToolError } from './errors';

/** Mirror the API envelope as both text and structuredContent; no second prose summary. */
export function toolOk(result: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result as Record<string, unknown>,
  };
}

export function toolError(error: unknown): CallToolResult {
  const safe = toSafeToolError(error);
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(safe) }],
  };
}

/** Run an SDK call and map success/failure into a tool result. No mutation is retried here. */
export async function runTool(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return toolOk(await fn());
  } catch (error) {
    return toolError(error);
  }
}
