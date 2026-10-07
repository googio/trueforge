import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { registerAgentTools } from './agents';
import { registerMcpServerTools } from './mcpServers';
import { registerModelTools } from './models';
import { registerSandboxEnvironmentTools } from './sandboxEnvironments';
import { registerScheduleTools } from './schedules';
import { registerSkillTools } from './skills';

/** Register the fixed TrueForge tool catalog against a request-scoped SDK client. */
export function registerTrueForgeTools(server: McpServer, client: TrueForge): void {
  registerAgentTools(server, client);
  registerScheduleTools(server, client);
  registerSandboxEnvironmentTools(server, client);
  registerModelTools(server, client);
  registerMcpServerTools(server, client);
  registerSkillTools(server, client);
}
