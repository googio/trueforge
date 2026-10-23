import type {
  AgentMetricChartDataRequest,
  AgentMetricRangeRequest,
  ListSandboxEnvironmentsParams,
  ListSchedulesParams,
  ListSessionEventsParams,
  ListSessionsParams,
  PermissionResourceType,
  SearchAgentsParams,
} from './types.js';

const ROOT = 'trueforge';

type SessionHistoryPageParams = {
  sessionId: string;
  pageToken?: string;
  lastTurnId?: string;
  limit?: number;
  /** Session `updatedAt` the newest page was read against; omitted for older pages. */
  version?: string;
};

/** Query keys for server reads; one QueryClient exists per server, so keys need no server scope. */
export const queryKeys = {
  capabilities: () => [ROOT, 'capabilities'] as const,
  me: () => [ROOT, 'me'] as const,
  permissions: {
    all: () => [ROOT, 'permissions'] as const,
    tenant: () => [ROOT, 'permissions', 'tenant'] as const,
    list: ({ resourceType, resourceIds }: { resourceType: PermissionResourceType; resourceIds: readonly string[] }) =>
      [ROOT, 'permissions', 'resources', resourceType, resourceIds] as const,
  },
  catalog: {
    all: () => [ROOT, 'catalog'] as const,
    models: () => [ROOT, 'catalog', 'models'] as const,
    skills: () => [ROOT, 'catalog', 'skills'] as const,
    mcp: () => [ROOT, 'catalog', 'mcp'] as const,
    connectorCatalog: () => [ROOT, 'catalog', 'connector-catalog'] as const,
    mcpConnectors: () => [ROOT, 'catalog', 'mcp-connector'] as const,
    mcpConnector: (connectorId: string) => [ROOT, 'catalog', 'mcp-connector', connectorId] as const,
    mcpToolsAll: () => [ROOT, 'catalog', 'mcp-tools'] as const,
    mcpTools: (connectorId: string) => [ROOT, 'catalog', 'mcp-tools', connectorId] as const,
  },
  agents: {
    all: () => [ROOT, 'agents'] as const,
    search: (params: SearchAgentsParams) => [ROOT, 'agents', 'search', params] as const,
    searchPages: (params: Omit<SearchAgentsParams, 'pageToken'>) => [ROOT, 'agents', 'search-pages', params] as const,
  },
  sessions: {
    all: () => [ROOT, 'sessions'] as const,
    lists: () => [ROOT, 'sessions', 'list'] as const,
    list: (params: ListSessionsParams) => [ROOT, 'sessions', 'list', params] as const,
    /** Infinite pages for the sessions browser; nested under `lists()` so session invalidation reaches them. */
    pages: (params: ListSessionsParams) => [ROOT, 'sessions', 'list', 'pages', params] as const,
    lastRun: (agentId: string) => [ROOT, 'sessions', 'list', 'last-run', agentId] as const,
    detail: (sessionId: string) => [ROOT, 'sessions', 'detail', sessionId] as const,
    events: (params: ListSessionEventsParams) => [ROOT, 'sessions', 'events', params] as const,
  },
  /** Chat history pages; kept outside `sessions` so session-list invalidation does not evict them. */
  sessionHistory: {
    session: (sessionId: string) => [ROOT, 'session-history', sessionId] as const,
    page: (params: SessionHistoryPageParams) => [ROOT, 'session-history', params.sessionId, params] as const,
  },
  /** Admin settings lists; mutations also invalidate the matching `catalog` entries pickers read. */
  settings: {
    all: () => [ROOT, 'settings'] as const,
    modelProviderCatalog: () => [ROOT, 'settings', 'model-provider-catalog'] as const,
    modelProviders: () => [ROOT, 'settings', 'model-providers'] as const,
    connectors: (query?: string) => [ROOT, 'settings', 'connectors', query ?? ''] as const,
    connector: (id: string) => [ROOT, 'settings', 'connector', id] as const,
    connectorToolsAll: () => [ROOT, 'settings', 'connector-tools'] as const,
    connectorTools: (id: string) => [ROOT, 'settings', 'connector-tools', id] as const,
    skillCatalog: () => [ROOT, 'settings', 'skill-catalog'] as const,
    skills: (query?: string) => [ROOT, 'settings', 'skills', query ?? ''] as const,
    sandboxProviderCatalog: () => [ROOT, 'settings', 'sandbox-provider-catalog'] as const,
    sandboxProviders: (query?: string) => [ROOT, 'settings', 'sandbox-providers', query ?? ''] as const,
    webSearchProviderCatalog: () => [ROOT, 'settings', 'web-search-provider-catalog'] as const,
    webSearchProviders: (query?: string) => [ROOT, 'settings', 'web-search-providers', query ?? ''] as const,
  },
  agentDetails: {
    all: () => [ROOT, 'agent-details'] as const,
    agent: (agentId: string) => [ROOT, 'agent-details', 'agent', agentId] as const,
    codeSnippets: (agentId: string) => [ROOT, 'agent-details', 'code-snippets', agentId] as const,
  },
  schedules: {
    all: () => [ROOT, 'schedules'] as const,
    list: (params: ListSchedulesParams) => [ROOT, 'schedules', 'list', params] as const,
    runs: (scheduleId: string) => [ROOT, 'schedules', 'runs', scheduleId] as const,
    forAgents: (agentIds: readonly string[]) => [ROOT, 'schedules', 'for-agents', agentIds] as const,
  },
  environments: {
    all: () => [ROOT, 'environments'] as const,
    list: (params: ListSandboxEnvironmentsParams) => [ROOT, 'environments', 'list', params] as const,
    allPages: (params: ListSandboxEnvironmentsParams) => [ROOT, 'environments', 'all-pages', params] as const,
    detail: (name: string) => [ROOT, 'environments', 'detail', name] as const,
  },
  metrics: {
    all: () => [ROOT, 'metrics'] as const,
    charts: () => [ROOT, 'metrics', 'charts'] as const,
    meters: (params: AgentMetricRangeRequest) => [ROOT, 'metrics', 'meters', params] as const,
    chartData: (params: AgentMetricChartDataRequest) => [ROOT, 'metrics', 'chart-data', params] as const,
  },
};
