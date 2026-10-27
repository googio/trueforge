'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

import { useServerQueryClient } from '../server/queryClient.js';
import { queryKeys } from '../server/queryKeys.js';
import type { PermissionsServer } from '../server/types.js';

export type UseCanCreateAgentResult = {
  loading: boolean;
  /** False while loading, on error, or when CREATE is not granted (fail-closed). */
  canCreateAgent: boolean;
  /** False while loading, on error, or when sandbox environment CREATE is not granted. */
  canCreateSandboxEnvironment: boolean;
};

const CanCreateAgentContext = createContext<UseCanCreateAgentResult>({
  loading: false,
  canCreateAgent: true,
  canCreateSandboxEnvironment: true,
});

/**
 * Fetches tenant-scoped CREATE grants once for the given permissions server
 * and broadcasts the result via context. Mount once high in the tree (inside
 * ServerProvider) so every useCanCreateAgent consumer shares a single
 * list-permissions call instead of each firing its own.
 */
export function CanCreateAgentProvider({
  permissionsServer,
  children,
}: {
  permissionsServer: PermissionsServer | null;
  children: ReactNode;
}) {
  const queryClient = useServerQueryClient();
  const tenantQuery = useQuery(
    {
      queryKey: queryKeys.permissions.tenant(),
      queryFn: () =>
        permissionsServer == null
          ? Promise.reject(new Error('Permissions server is not configured.'))
          : permissionsServer.listPermissions({ resourceType: 'tenant', resourceIds: [] }),
      enabled: permissionsServer != null,
    },
    queryClient,
  );

  const value = useMemo<UseCanCreateAgentResult>(() => {
    if (permissionsServer == null) {
      return { loading: false, canCreateAgent: true, canCreateSandboxEnvironment: true };
    }
    if (tenantQuery.data == null) {
      return {
        loading: tenantQuery.isPending,
        canCreateAgent: false,
        canCreateSandboxEnvironment: false,
      };
    }
    const agentGranted = tenantQuery.data.data.permissions.agent ?? [];
    const environmentGranted = tenantQuery.data.data.permissions.sandbox_environment ?? [];
    return {
      loading: false,
      canCreateAgent: agentGranted.includes('CREATE'),
      canCreateSandboxEnvironment: environmentGranted.includes('CREATE'),
    };
  }, [permissionsServer, tenantQuery.data, tenantQuery.isPending]);

  return createElement(CanCreateAgentContext.Provider, { value }, children);
}

/**
 * Tenant-scoped create grants. Reads from CanCreateAgentProvider (mounted
 * inside ServerProvider). Falls back to allow-all when no permissions port is configured.
 */
export function useCanCreateAgent(): UseCanCreateAgentResult {
  return useContext(CanCreateAgentContext);
}
