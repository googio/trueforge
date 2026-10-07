/** Convert SDK/API failures into a compact, secret-free shape for MCP tool results. */
import { TrueForgeError } from '@truefoundry/trueforge-sdk';

export interface SafeToolError {
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

/**
 * Surface only the HTTP status and the API's own error-envelope message. Anything else (raw body,
 * response headers, cause chain, stack, internal URLs in `Error.message`) collapses to a static
 * message so transport/network failures can't leak infra detail into the model's context.
 */
export function toSafeToolError(error: unknown): SafeToolError {
  if (error instanceof TrueForgeError) {
    return {
      status: error.statusCode ?? null,
      message: messageFromBody(error.body) ?? FALLBACK_MESSAGE,
    };
  }
  return { status: null, message: FALLBACK_MESSAGE };
}
