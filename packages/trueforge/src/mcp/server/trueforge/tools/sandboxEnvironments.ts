import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TrueForgeError, type TrueForge } from '@truefoundry/trueforge-sdk';
import { z } from 'zod';
import { runTool } from '../result';

/**
 * The HTTP API exposes a single create-or-update PUT. We split create and update over it and add a
 * preflight GET so intent is explicit (create fails if present; update fails if absent). Best-effort:
 * two concurrent creates can still race (no conditional-create at the API layer).
 */
const manifestSchema = z.looseObject({ name: z.string() });

async function environmentExists(client: TrueForge, name: string): Promise<boolean> {
  try {
    await client.sandboxEnvironments.get(name);
    return true;
  } catch (error) {
    if (error instanceof TrueForgeError && error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

export function registerSandboxEnvironmentTools(server: McpServer, client: TrueForge): void {
  server.registerTool(
    'create_sandbox_environment',
    {
      description:
        'Create a reusable sandbox environment that agents run in — defining its resources, environment ' +
        'variables, networking, and build configuration — from a complete manifest. Fails if an environment ' +
        'with the same name already exists; the reserved `default` environment cannot be created.',
      inputSchema: { manifest: manifestSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ manifest }) =>
      runTool(async () => {
        if (await environmentExists(client, manifest.name)) {
          throw new TrueForgeError({
            statusCode: 409,
            body: { error: { message: `Sandbox environment already exists: ${manifest.name}` } },
          });
        }
        return client.sandboxEnvironments.createOrUpdate({ manifest });
      }),
  );

  server.registerTool(
    'list_sandbox_environments',
    {
      description:
        'Discover existing sandbox environments you can reference from an agent, or find one to update. ' +
        "Returns one paginated page; environment values and secrets follow the HTTP API's redaction behavior.",
      inputSchema: {
        page_size: z.number().int().positive().optional(),
        page_token: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ page_size, page_token }) =>
      runTool(async () => {
        const page = await client.sandboxEnvironments.list({
          limit: page_size,
          pageToken: page_token,
        } as Parameters<typeof client.sandboxEnvironments.list>[0]);
        return page.response;
      }),
  );

  server.registerTool(
    'get_sandbox_environment',
    {
      description:
        'Fetch one sandbox environment by name — its manifest, build status, resources, environment ' +
        'variables, and networking configuration. Use it to review an environment or get a template before updating it.',
      inputSchema: { name: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => runTool(() => client.sandboxEnvironments.get(name)),
  );

  server.registerTool(
    'update_sandbox_environment',
    {
      description:
        'Change an existing sandbox environment — the resources, environment variables, networking, and build ' +
        'configuration agents run in — by replacing it with a complete manifest. The input name and manifest ' +
        'name must match, and this tool never creates a missing environment (use create_sandbox_environment for that).',
      inputSchema: { name: z.string(), manifest: manifestSchema },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ name, manifest }) =>
      runTool(async () => {
        if (name !== manifest.name) {
          throw new TrueForgeError({
            statusCode: 400,
            body: { error: { message: 'input name and manifest.name must match' } },
          });
        }
        if (!(await environmentExists(client, name))) {
          throw new TrueForgeError({
            statusCode: 404,
            body: { error: { message: `Sandbox environment not found: ${name}` } },
          });
        }
        return client.sandboxEnvironments.createOrUpdate({ manifest });
      }),
  );
}
