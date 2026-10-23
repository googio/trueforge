'use client';

import { hashKey, QueryClient, type DefaultOptions } from '@tanstack/react-query';
import { createContext, useContext, useState } from 'react';

const DEFAULT_STALE_TIME_MS = 30_000;
const DEFAULT_GC_TIME_MS = 5 * 60_000;

/** Catalogs (models, skills, connectors, providers) change rarely and are invalidated by their own mutations. */
export const CATALOG_STALE_TIME_MS = 5 * 60_000;

/**
 * Reads refresh only when stale on mount or when a mutation invalidates them; focus,
 * reconnect, and automatic retries would add requests the UI does not need.
 */
function serverQueryDefaults(scope: number): DefaultOptions {
  return {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      gcTime: DEFAULT_GC_TIME_MS,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // Hashing under the server scope keeps entries from a previous server unreachable.
      queryKeyHashFn: key => hashKey([scope, ...key]),
    },
    mutations: { retry: false },
  };
}

export function createServerQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: serverQueryDefaults(0) });
}

/** Points the client at a new server without remounting query observers bound to it. */
export function rescopeServerQueryClient({ queryClient, scope }: { queryClient: QueryClient; scope: number }): void {
  queryClient.setDefaultOptions(serverQueryDefaults(scope));
}

// Own context instead of QueryClientProvider so a host app's React Query client is never shadowed.
export const ServerQueryClientContext = createContext<QueryClient | null>(null);

export function useServerQueryClient(): QueryClient {
  const provided = useContext(ServerQueryClientContext);
  // Outside ServerProvider each consumer gets an isolated client, matching uncached behavior.
  const [isolated] = useState(createServerQueryClient);
  return provided ?? isolated;
}
