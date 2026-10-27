'use client';

import { useCallback } from 'react';

import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';

/** Refreshes every environment read, including agent environment pickers, after a mutation. */
export function useInvalidateEnvironments(): () => void {
  const queryClient = useServerQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all() });
  }, [queryClient]);
}
