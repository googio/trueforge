'use client';

import { useCallback } from 'react';

import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';

/** Refreshes every environment read after a mutation; the shell path also bumps its catalog epoch. */
export function useInvalidateEnvironments(): () => void {
  const queryClient = useServerQueryClient();
  const shell = useOptionalShellMode();
  return useCallback(() => {
    if (shell != null) {
      shell.invalidateEnvironmentsList();
      return;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all() });
  }, [queryClient, shell]);
}
