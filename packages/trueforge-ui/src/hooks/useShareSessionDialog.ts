'use client';

import { useCallback, useState } from 'react';

import { useToasterOptional } from '../containers/ToasterContainer.js';
import { buildSharedSessionHref } from '../routing/paths.js';
import { useOptionalResolvedRoutes } from '../routing/ResolvedRoutesContext.js';
import { useServerQueryClient } from '../server/queryClient.js';
import { queryKeys } from '../server/queryKeys.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { fetchSessionDetail } from '../server/sessionQueries.js';
import { useCopySharedSessionLink } from './useCopySharedSessionLink.js';
import { useResourcePermissions } from './useResourcePermissions.js';

export type SessionSharePermission = 'private' | 'tenant';

export function useShareSessionDialog(sessionId: string | null | undefined): {
  permission: SessionSharePermission;
  canManage: boolean;
  loading: boolean;
  shareUrl: string;
  copied: boolean;
  tenantId: string | undefined;
  load: () => Promise<void>;
  changePermission: (next: SessionSharePermission) => Promise<void>;
  copySharedSessionLink: () => Promise<void>;
} {
  const server = useOptionalServer();
  const queryClient = useServerQueryClient();
  const toaster = useToasterOptional();
  const routes = useOptionalResolvedRoutes();
  const resourceIds = sessionId == null || sessionId.length === 0 ? [] : [sessionId];
  const { allows } = useResourcePermissions({ resourceType: 'session', resourceIds });
  const canManage = allows(sessionId, 'MANAGE');
  const { copied, copySharedSessionLink } = useCopySharedSessionLink(sessionId);
  const [permission, setPermission] = useState<SessionSharePermission>('private');
  const [tenantId, setTenantId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const shareUrl = sessionId == null || sessionId.length === 0 ? '' : buildSharedSessionHref({ sessionId, routes });

  const load = useCallback(async () => {
    if (sessionId == null || sessionId.length === 0 || server == null) return;
    setLoading(true);
    try {
      // Sharing can change from another tab or user; read the current state.
      const session = await fetchSessionDetail({ queryClient, server, sessionId, staleTime: 0 });
      setPermission(session.shared === true ? 'tenant' : 'private');
      const getMe = server.getMe;
      if (getMe != null) {
        try {
          // Identity is fixed for the server's lifetime; fetch it once.
          const me = await queryClient.fetchQuery({
            queryKey: queryKeys.me(),
            queryFn: () => getMe.call(server),
            staleTime: Infinity,
          });
          if (me.tenantId.length > 0) setTenantId(me.tenantId);
        } catch {
          // Keep the generic tenant label when identity is unavailable.
        }
      }
    } catch (caught) {
      toaster?.showError(caught);
    } finally {
      setLoading(false);
    }
  }, [queryClient, server, sessionId, toaster]);

  const changePermission = useCallback(
    async (next: SessionSharePermission) => {
      if (!canManage || next === permission) return;
      const previous = permission;
      setPermission(next);
      if (sessionId == null || sessionId.length === 0 || server == null) return;
      try {
        await server.updateSession({ sessionId, shared: next === 'tenant' });
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });
      } catch (caught) {
        setPermission(previous);
        toaster?.showError(caught);
      }
    },
    [canManage, permission, queryClient, server, sessionId, toaster],
  );

  return {
    permission,
    canManage,
    loading,
    shareUrl,
    copied,
    tenantId,
    load,
    changePermission,
    copySharedSessionLink,
  };
}
