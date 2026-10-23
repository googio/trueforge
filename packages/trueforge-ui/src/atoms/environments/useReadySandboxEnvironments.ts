'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalSandboxEnvironmentServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { SandboxEnvironment } from '../../server/types.js';
import { drainListPages } from '../../utils/drainListPages.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

const ALL_ENVIRONMENTS_PAGE_LIMIT = 1000;
const EMPTY_ENVIRONMENTS: SandboxEnvironment[] = [];

export type UseReadySandboxEnvironmentsResult = {
  environments: SandboxEnvironment[];
  loading: boolean;
  /** True once a list request has finished successfully, so an empty list is authoritative. */
  loaded: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

function selectReady(environments: SandboxEnvironment[]): SandboxEnvironment[] {
  return environments.filter(env => env.status === 'ready');
}

/**
 * Loads sandbox environments and filters strictly to ready (`status === 'ready'`) records.
 * Environments still building (`pending`) or failed (`failed`) are excluded.
 *
 * Refreshes when environment mutations invalidate the cache and when the Manage Environments
 * overlay closes, so still-mounted agent pickers stay in sync without remounting.
 */
export function useReadySandboxEnvironments(): UseReadySandboxEnvironmentsResult {
  const environmentServer = useOptionalSandboxEnvironmentServer();
  const queryClient = useServerQueryClient();
  const shell = useOptionalShellMode();
  const environmentsOpen = shell?.environmentsOpen ?? false;
  const wasEnvironmentsOpenRef = useRef(environmentsOpen);

  const readyQuery = useQuery(
    {
      queryKey: queryKeys.environments.allPages({ limit: ALL_ENVIRONMENTS_PAGE_LIMIT }),
      queryFn: () => {
        if (environmentServer == null) throw new Error('Sandbox environments are not configured.');
        return drainListPages({
          fetchPage: pageToken => environmentServer.listEnvironments({ limit: ALL_ENVIRONMENTS_PAGE_LIMIT, pageToken }),
        });
      },
      enabled: environmentServer != null,
      select: selectReady,
    },
    queryClient,
  );

  useEffect(() => {
    if (wasEnvironmentsOpenRef.current && !environmentsOpen) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all() });
    }
    wasEnvironmentsOpenRef.current = environmentsOpen;
  }, [environmentsOpen, queryClient]);

  const { refetch: refetchQuery } = readyQuery;
  const refetch = useCallback(async () => {
    if (environmentServer == null) return;
    await refetchQuery();
  }, [environmentServer, refetchQuery]);

  if (environmentServer == null) {
    return { environments: EMPTY_ENVIRONMENTS, loading: false, loaded: false, error: null, refetch };
  }
  return {
    environments: readyQuery.isError ? EMPTY_ENVIRONMENTS : (readyQuery.data ?? EMPTY_ENVIRONMENTS),
    loading: readyQuery.isFetching,
    loaded: readyQuery.data !== undefined,
    error: readyQuery.isError ? getErrorMessage(readyQuery.error, 'Failed to load sandbox environments.') : null,
    refetch,
  };
}
