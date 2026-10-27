/**
 * Configured MCP server domain + wire schemas: the `mcp_server.manifest` JSONB
 * document, admin/chat list projections, and auth_status. Catalog file schemas
 * live in mcpCatalog.ts.
 *
 * McpServerManifest is a `type`-discriminated oneOf of
 * RemoteMcpServerManifest | TrueFoundryMcpServerManifest.
 *
 * Auth: `header` stores shared request headers on the row.
 * `passthrough` forwards the caller's bearer.
 * `additional_headers` are static extras beside `auth` (auth wins on key conflict).
 * Turn execution resolves DCR tokens via resolveMcpAuth.
 */
import { z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { OAuthToken } from '../mcp/auth/types';
import { NameSchema } from './common';

const MCP_SERVER_TYPES = ['remote', 'truefoundry'] as const;

/**
 * Transport/kind of MCP server.
 * `remote` — user-configured URL (standalone / local registry).
 * `truefoundry` — TrueFoundry-managed: gateway proxy URL.
 */
export const McpServerTypeSchema = z.enum(MCP_SERVER_TYPES).openapi('MCPServerType');

const McpServerHeaderAuthSchema = z
  .object({
    type: z.literal('header').describe('Authenticate with static HTTP headers.'),
    headers: z
      .record(z.string().min(1), z.string().min(1))
      .refine(headers => Object.keys(headers).length > 0, {
        message: 'must include at least one header',
      })
      .describe(
        'Request headers for this MCP server. Responses are redacted; on PUT, a real value sets/rotates and a redacted value keeps the stored secret for that header name.',
      ),
  })
  .strict()
  .openapi('MCPServerHeaderAuth');

/** OAuth Dynamic Client Registration — stub until authorize/token exchange is wired. */
const McpServerDcrAuthSchema = z
  .object({
    type: z.literal('dcr').describe('Authenticate via OAuth Dynamic Client Registration.'),
  })
  .strict()
  .openapi('MCPServerDcrAuth');

const McpServerPassthroughAuthSchema = z
  .object({
    type: z
      .literal('passthrough')
      .describe("Forward the caller's bearer token as Authorization on requests to this MCP server."),
  })
  .strict()
  .openapi('MCPServerPassthroughAuth');

export const McpServerManifestAuthSchema = z
  .discriminatedUnion('type', [McpServerHeaderAuthSchema, McpServerDcrAuthSchema, McpServerPassthroughAuthSchema])
  .describe('Optional auth settings. Omit when the server needs no credentials.')
  .openapi('MCPServerManifestAuth');

export const McpServerDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .describe('Concise summary of what this MCP server provides.');

/** Static extras on every request; when a key also appears under `auth`, auth wins. */
export const McpServerAdditionalHeadersSchema = z
  .record(z.string().min(1), z.string().min(1))
  .describe(
    'Additional HTTP headers sent on each request to the MCP server. If the same header is set in both additional_headers and auth, the auth value wins.',
  )
  .openapi('MCPServerAdditionalHeaders');

/** User-configured remote MCP endpoint. */
const RemoteMcpServerManifestSchema = z
  .object({
    type: z.literal(McpServerTypeSchema.enum.remote),
    name: NameSchema,
    url: z.url().describe('MCP endpoint URL.'),
    description: McpServerDescriptionSchema,
    auth: McpServerManifestAuthSchema.optional(),
    additional_headers: McpServerAdditionalHeadersSchema.optional(),
  })
  .strict()
  .openapi('RemoteMCPServerManifest');

/** TrueFoundry-managed MCP server; `url` is the resolved AI Gateway proxy URL. */
const TrueFoundryMcpServerManifestSchema = z
  .object({
    type: z.literal(McpServerTypeSchema.enum.truefoundry),
    name: NameSchema,
    url: z.url().describe('Resolved AI Gateway proxy URL for this TrueFoundry-managed MCP server.'),
    description: McpServerDescriptionSchema,
    auth: McpServerManifestAuthSchema.optional(),
    additional_headers: McpServerAdditionalHeadersSchema.optional(),
  })
  .strict()
  .openapi('TrueFoundryMCPServerManifest');

export const McpServerManifestSchema = z
  .discriminatedUnion('type', [RemoteMcpServerManifestSchema, TrueFoundryMcpServerManifestSchema])
  .openapi('MCPServerManifest');

export const McpAuthStatusSchema = z
  .object({
    status: z
      .enum(['authenticated', 'auth_required', 'not_required'])
      .describe('Current auth state for this MCP server.'),
    authorization_url: z
      .url()
      .optional()
      .describe('When auth is required, this contains the URL to redirect the user to for authorization.'),
  })
  .strict()
  .describe('Current auth state.')
  .openapi('MCPAuthStatus');

/** Admin/settings wire view: identity column plus nested manifest and auth_status. */
export const ConfiguredMcpServerSchema = z
  .object({
    name: NameSchema,
    manifest: McpServerManifestSchema,
    auth_status: McpAuthStatusSchema,
  })
  .strict()
  .openapi('ConfiguredMCPServer');

export const CreateMcpServerRequestSchema = z
  .object({
    manifest: McpServerManifestSchema,
  })
  .strict()
  .openapi('CreateMCPServerRequest');

export const UpdateMcpServerRequestSchema = z
  .object({
    manifest: McpServerManifestSchema,
  })
  .strict()
  .openapi('UpdateMCPServerRequest');

export const GetMcpServerResponseSchema = z.object({ data: ConfiguredMcpServerSchema }).openapi('GetMCPServerResponse');
export const ListMcpServersResponseSchema = z
  .object({
    data: z.array(ConfiguredMcpServerSchema),
  })
  .openapi('ListMCPServersResponse');

export const DeleteMcpServerResponseSchema = z.object({}).openapi('DeleteMCPServerResponse');

/** Public auth mechanism for chat/composer (no secrets). */
export const McpServerAuthPublicSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('dcr') }).strict(),
    z.object({ type: z.literal('header') }).strict(),
    z.object({ type: z.literal('passthrough') }).strict(),
  ])
  .describe('Auth mechanism when configured (no secrets). Omit when the server needs no credentials.')
  .openapi('MCPServerAuthPublic');

/** Chat/composer read view — public fields plus per-user auth_status. */
export const AvailableMcpServerSchema = z
  .object({
    name: NameSchema,
    url: z.url().describe('URL of the remote MCP server.'),
    auth: McpServerAuthPublicSchema.optional(),
    auth_status: McpAuthStatusSchema,
  })
  .strict()
  .openapi('AvailableMCPServer');

export const ListAvailableMcpServersResponseSchema = z
  .object({
    data: z.array(AvailableMcpServerSchema),
  })
  .openapi('ListAvailableMCPServersResponse');

export const GetAvailableMcpServerResponseSchema = z
  .object({ data: AvailableMcpServerSchema })
  .openapi('GetAvailableMCPServerResponse');

export type McpServerType = z.infer<typeof McpServerTypeSchema>;
export type McpServerManifestAuth = z.infer<typeof McpServerManifestAuthSchema>;
export type RemoteMcpServerManifest = z.infer<typeof RemoteMcpServerManifestSchema>;
export type TrueFoundryMcpServerManifest = z.infer<typeof TrueFoundryMcpServerManifestSchema>;
export type McpServerManifest = z.infer<typeof McpServerManifestSchema>;
export type McpAuthStatus = z.infer<typeof McpAuthStatusSchema>;
export type McpServerAuthPublic = z.infer<typeof McpServerAuthPublicSchema>;
export type ConfiguredMcpServer = z.infer<typeof ConfiguredMcpServerSchema>;
export type CreateMcpServerRequest = z.infer<typeof CreateMcpServerRequestSchema>;
export type UpdateMcpServerRequest = z.infer<typeof UpdateMcpServerRequestSchema>;
export type AvailableMcpServer = z.infer<typeof AvailableMcpServerSchema>;

/** Drop Authorization so a static map cannot override a caller/gateway Bearer. */
export function withoutAuthorizationHeader(headers: Record<string, string> | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization'));
}

/** Merge `additional_headers` under auth-derived headers (auth wins on conflict). */
export function withMcpAdditionalHeaders(input: {
  manifest: McpServerManifest;
  authHeaders: Record<string, string>;
}): Record<string, string> {
  return {
    ...(input.manifest.additional_headers ?? {}),
    ...input.authHeaders,
  };
}

/**
 * Headers for live MCP calls against a configured server.
 * `auth.type === 'header'` (plus `additional_headers`), or `additional_headers` alone.
 * Turn execution uses DCR via resolveMcpAuth and passthrough via
 * {@link resolvePassthroughMcpRequestHeaders}.
 */
export function resolveConfiguredMcpRequestHeaders(manifest: McpServerManifest): Record<string, string> {
  if (manifest.auth?.type === 'header') {
    return withMcpAdditionalHeaders({ manifest, authHeaders: { ...manifest.auth.headers } });
  }
  if (manifest.auth === undefined) {
    return { ...(manifest.additional_headers ?? {}) };
  }
  return {};
}

/**
 * Caller bearer plus `additional_headers` for `auth.type === 'passthrough'`.
 * Fails closed when the request has no credential (e.g. schedule runs).
 */
export function resolvePassthroughMcpRequestHeaders(input: {
  manifest: McpServerManifest;
  userCredential: string | null | undefined;
}): Record<string, string> {
  if (input.manifest.auth?.type !== 'passthrough') {
    return {};
  }
  if (input.userCredential === null || input.userCredential === undefined || input.userCredential.length === 0) {
    throw new HTTPException(422, {
      message: `MCP server "${input.manifest.name}" uses passthrough auth but the request has no caller credential`,
    });
  }
  return withMcpAdditionalHeaders({
    manifest: input.manifest,
    authHeaders: { Authorization: `Bearer ${input.userCredential}` },
  });
}

export function resolveMcpAuthStatus({
  manifest,
  token,
}: {
  manifest: McpServerManifest;
  token?: OAuthToken;
}): McpAuthStatus {
  // TrueFoundry list responses treat this as authenticated until live per-item status is requested.
  if (manifest.type === 'truefoundry') {
    return { status: 'authenticated' };
  }
  if (manifest.auth?.type === 'dcr') {
    return token ? { status: 'authenticated' } : { status: 'auth_required' };
  }
  if (manifest.auth?.type === 'header' || manifest.auth?.type === 'passthrough') {
    return { status: 'authenticated' };
  }
  return { status: 'not_required' };
}
