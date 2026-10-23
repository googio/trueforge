'use client';

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useServerQueryClient } from '../server/queryClient.js';
import { queryKeys } from '../server/queryKeys.js';
import { useOptionalPermissionsServer } from '../server/ServerContext.js';
import type { PermissionResourceType, PermissionsServer, ResourcePermission } from '../server/types.js';

const PERMISSIONS_BATCH_SIZE = 100;

export type UseResourcePermissionsOptions = {
  resourceType: PermissionResourceType;
  resourceIds: readonly string[];
};

export type UseResourcePermissionsResult = {
  loading: boolean;
  error: unknown | null;
  allows: (resourceId: string | null | undefined, permission: ResourcePermission) => boolean;
};

function parseResourceIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((resourceId): resourceId is string => typeof resourceId === 'string');
}

function permissionBatches(resourceIds: string[]): string[][] {
  const batches: string[][] = [];
  for (let offset = 0; offset < resourceIds.length; offset += PERMISSIONS_BATCH_SIZE) {
    batches.push(resourceIds.slice(offset, offset + PERMISSIONS_BATCH_SIZE));
  }
  return batches;
}

/** Grants per resource id, shared by every reader of the same id set. */
export function resourcePermissionsQuery({
  server,
  resourceType,
  resourceIds,
}: {
  server: PermissionsServer | null;
  resourceType: PermissionResourceType;
  resourceIds: string[];
}) {
  return queryOptions({
    queryKey: queryKeys.permissions.list({ resourceType, resourceIds }),
    queryFn: async () => {
      if (server == null) throw new Error('Permissions server is not configured.');
      const responses = await Promise.all(
        permissionBatches(resourceIds).map(resourceIdsBatch =>
          server.listPermissions({ resourceType, resourceIds: resourceIdsBatch }),
        ),
      );
      const permissions: Record<string, ResourcePermission[]> = {};
      for (const response of responses) Object.assign(permissions, response.data.permissions);
      return permissions;
    },
  });
}

export function useResourcePermissions({
  resourceType,
  resourceIds,
}: UseResourcePermissionsOptions): UseResourcePermissionsResult {
  const server = useOptionalPermissionsServer();
  const idsKey = JSON.stringify([...new Set(resourceIds.filter(resourceId => resourceId.length > 0))]);
  const hasResourceIds = idsKey !== '[]';
  const requestedIds = useMemo(() => parseResourceIds(idsKey), [idsKey]);
  const requestedIdSet = useMemo(() => new Set(requestedIds), [requestedIds]);
  const queryClient = useServerQueryClient();
  const enabled = server != null && hasResourceIds;
  const permissionsQuery = useQuery(
    {
      ...resourcePermissionsQuery({ server, resourceType, resourceIds: requestedIds }),
      enabled,
      // Keep prior grants on screen while a new id set loads; `allows` still gates by requested ids.
      placeholderData: keepPreviousData,
    },
    queryClient,
  );

  const loading = enabled && (permissionsQuery.isPending || permissionsQuery.isFetching);
  const error: unknown = enabled && !permissionsQuery.isPlaceholderData ? permissionsQuery.error : null;
  // A failed wider request keeps the grants already known for this resource type.
  const [lastGrants, setLastGrants] = useState<{
    resourceType: PermissionResourceType;
    data: Record<string, ResourcePermission[]>;
  } | null>(null);
  const settledData = permissionsQuery.isPlaceholderData ? undefined : permissionsQuery.data;
  useEffect(() => {
    if (settledData != null) setLastGrants({ resourceType, data: settledData });
  }, [resourceType, settledData]);
  const data = permissionsQuery.data ?? (lastGrants?.resourceType === resourceType ? lastGrants.data : undefined);

  const allows = useCallback(
    (resourceId: string | null | undefined, permission: ResourcePermission) => {
      if (server == null || resourceId == null || resourceId === '') return true;
      if (!requestedIdSet.has(resourceId) || data == null) return false;
      return (data[resourceId] ?? []).includes(permission);
    },
    [data, requestedIdSet, server],
  );

  return { loading, error, allows };
}

const ActiveSessionManageContext = createContext(true);

export function ActiveSessionPermissionsProvider({
  sessionId,
  assumeManage = false,
  children,
}: {
  sessionId: string | null | undefined;
  assumeManage?: boolean;
  children: ReactNode;
}) {
  const resourceIds = useMemo(() => (sessionId == null ? [] : [sessionId]), [sessionId]);
  const { allows } = useResourcePermissions({ resourceType: 'session', resourceIds });
  return createElement(
    ActiveSessionManageContext.Provider,
    { value: assumeManage || allows(sessionId, 'MANAGE') },
    children,
  );
}

export function useActiveSessionCanManage(): boolean {
  return useContext(ActiveSessionManageContext);
}
