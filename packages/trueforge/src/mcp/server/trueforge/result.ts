/** Shared success/error shaping for TrueForge tool results. */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TrueForgeError } from '@truefoundry/trueforge-sdk';

interface SafeToolError {
  status: number | null;
  message: string;
}

const FALLBACK_MESSAGE = 'The TrueForge API request failed.';

/** Best-effort read of the TrueForge `{ error: { message } }` envelope. */
function messageFromBody(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const { message } = error;
      if (typeof message === 'string') {
        return message;
      }
    }
  }
  return undefined;
}

/** Convert SDK/API failures into a compact, secret-free shape for MCP tool results. */
function toSafeToolError(error: unknown): SafeToolError {
  if (error instanceof TrueForgeError) {
    return {
      status: error.statusCode ?? null,
      message: messageFromBody(error.body) ?? FALLBACK_MESSAGE,
    };
  }
  return { status: null, message: FALLBACK_MESSAGE };
}

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
