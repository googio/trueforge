'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { useOptionalCurrentUser } from '../../contexts/CurrentUserContext.js';
import { Icon } from '../../icons/Icon.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useSandboxEnvironmentServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { SandboxEnvironment } from '../../server/types.js';
import {
  ENVIRONMENT_SHARE_CHANGE_EVENT,
  readEnvironmentShareSearch,
  replaceEnvironmentShareSearch,
} from '../../utils/environmentShareUrl.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { EmptyScreen, EmptyScreenQueryHighlight } from '../EmptyScreen.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { formatRelativeTime } from '../lib/dateFormat.js';
import { PageHeader } from '../PageHeader.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../primitives/Dialog.js';
import SearchInput from '../primitives/SearchInput.js';
import { Skeleton } from '../primitives/Skeleton.js';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableTokenPagination,
} from '../primitives/Table.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { formatNetworkingSummary, formatResourcesSummary, isEnvironmentReadOnly } from './environmentDisplay.js';
import { EnvironmentFormDrawer } from './EnvironmentFormDrawer.js';
import { EnvironmentStatusBadge } from './EnvironmentStatusBadge.js';
import { useInvalidateEnvironments } from './useInvalidateEnvironments.js';

type DrawerState = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; environment: SandboxEnvironment };

const ENVIRONMENTS_PAGE_SIZE_OPTIONS = [10, 25] as const;
export const PENDING_ENVIRONMENTS_POLL_INTERVAL_MS = 10_000;

function clampPageSize(size: number): number {
  return Math.min(Math.max(size, 1), 25);
}

function initialDrawerState(): DrawerState {
  return readEnvironmentShareSearch(window.location.search).isNew ? { kind: 'create' } : { kind: 'closed' };
}

export type EnvironmentsPageProps = Record<string, never>;

export function EnvironmentsPage(_props: EnvironmentsPageProps) {
  const environmentServer = useSandboxEnvironmentServer();
  const shell = useOptionalShellMode();
  const currentUser = useOptionalCurrentUser();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();

  const queryClient = useServerQueryClient();
  const invalidateEnvironments = useInvalidateEnvironments();
  const [nameQuery, setNameQuery] = useState(() => readEnvironmentShareSearch(window.location.search).q ?? '');
  const [drawer, setDrawer] = useState<DrawerState>(() => initialDrawerState());
  const [pendingDelete, setPendingDelete] = useState<SandboxEnvironment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pageSize, setPageSize] = useState(() => clampPageSize(DEFAULT_TABLE_PAGE_SIZE));
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const didConsumeIsNewRef = useRef(false);
  const wasSettingsOpenRef = useRef(shell?.settingsOpen ?? false);
  const settingsOpen = shell?.settingsOpen ?? false;

  const listQuery = useQuery(
    {
      queryKey: queryKeys.environments.list({
        limit: pageSize,
        ...(pageToken === undefined || pageToken === '' ? {} : { pageToken }),
      }),
      queryFn: () =>
        environmentServer.listEnvironments({
          limit: pageSize,
          ...(pageToken === undefined || pageToken === '' ? {} : { pageToken }),
        }),
    },
    queryClient,
  );
  const page = listQuery.isError ? undefined : listQuery.data;
  const loading = listQuery.isPending;
  const error = listQuery.isError ? getErrorMessage(listQuery.error, 'Check your connection and try again.') : null;
  const nextPageToken = page?.nextPageToken;
  const previousPageToken = page?.previousPageToken;

  // Poll pending environments individually; the list row seeds each detail so polling starts after one interval.
  const pendingListed = useMemo(() => (page?.data ?? []).filter(env => env.status === 'pending'), [page]);
  const pendingQueries = useQueries(
    {
      queries: pendingListed.map(env => ({
        queryKey: queryKeys.environments.detail(env.name),
        queryFn: () => environmentServer.getEnvironment({ name: env.name }),
        initialData: env,
        initialDataUpdatedAt: listQuery.dataUpdatedAt,
        staleTime: PENDING_ENVIRONMENTS_POLL_INTERVAL_MS,
        refetchInterval: PENDING_ENVIRONMENTS_POLL_INTERVAL_MS,
      })),
    },
    queryClient,
  );
  const polledByName = useMemo(() => {
    const byName = new Map<string, SandboxEnvironment>();
    for (const query of pendingQueries) {
      if (query.data != null) byName.set(query.data.name, query.data);
    }
    return byName;
  }, [pendingQueries]);
  const environments = useMemo(
    () => (page?.data ?? []).map(item => (item.status === 'pending' ? (polledByName.get(item.name) ?? item) : item)),
    [page, polledByName],
  );
  const settledPendingKey = pendingListed
    .filter(env => (polledByName.get(env.name)?.status ?? 'pending') !== 'pending')
    .map(env => env.name)
    .join('\n');

  // Pending envs becoming ready (or failed) must refresh the list and still-mounted pickers.
  useEffect(() => {
    if (settledPendingKey.length > 0) invalidateEnvironments();
  }, [invalidateEnvironments, settledPendingKey]);

  useEffect(() => {
    replaceEnvironmentShareSearch({
      q: nameQuery.trim().length === 0 ? null : nameQuery,
    });
  }, [nameQuery]);

  useEffect(() => {
    if (wasSettingsOpenRef.current && !settingsOpen) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all() });
    }
    wasSettingsOpenRef.current = settingsOpen;
  }, [queryClient, settingsOpen]);

  useEffect(() => {
    if (didConsumeIsNewRef.current) return;
    if (!readEnvironmentShareSearch(window.location.search).isNew) return;
    didConsumeIsNewRef.current = true;
    setDrawer({ kind: 'create' });
    replaceEnvironmentShareSearch({ isNew: null });
  }, []);

  useEffect(() => {
    const onShareChange = () => {
      const share = readEnvironmentShareSearch(window.location.search);
      setNameQuery(share.q ?? '');
      if (share.isNew) setDrawer({ kind: 'create' });
    };
    window.addEventListener(ENVIRONMENT_SHARE_CHANGE_EVENT, onShareChange);
    return () => window.removeEventListener(ENVIRONMENT_SHARE_CHANGE_EVENT, onShareChange);
  }, []);

  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (q.length === 0) return environments;
    return environments.filter(env => env.name.toLowerCase().includes(q) || env.description.toLowerCase().includes(q));
  }, [environments, nameQuery]);

  const hasPageNav = nextPageToken != null || previousPageToken != null || environments.length > 0;

  const openCreate = () => {
    setDrawer({ kind: 'create' });
  };

  const handleDelete = async () => {
    if (pendingDelete == null) return;
    setDeleting(true);
    try {
      await environmentServer.deleteEnvironment({ name: pendingDelete.name });
      track(AnalyticsEvents.Environment.DELETED, {
        environment_name: pendingDelete.name,
        environment_id: pendingDelete.id,
      });
      toaster?.showSuccess({ title: 'Environment deleted' });
      setPendingDelete(null);
      setPageToken(undefined);
      invalidateEnvironments();
    } catch (caught) {
      toaster?.showError(caught);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <PageHeader
        title="Environments"
        end={
          <>
            <div className="w-64">
              <SearchInput query={nameQuery} setQuery={setNameQuery} placeholder="Search environments by name" />
            </div>
            <Button.Primary type="button" onClick={openCreate}>
              <Icon name="plus" className="size-3.5" />
              New Environment
            </Button.Primary>
          </>
        }
      />

      <div className={cn('min-h-0 flex-1 overflow-auto px-4 py-4', error != null ? 'flex flex-col' : undefined)}>
        {error != null ? (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center">
            <EmptyScreen
              title="Couldn't load environments"
              description={error}
              className="h-auto min-h-0 flex-none py-0"
            />
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading environments">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : environments.length === 0 ? (
          <EmptyScreen
            title="No environments yet"
            description="Create an environment to customize sandbox images, resources, and networking."
            className="min-h-full"
          />
        ) : filtered.length === 0 ? (
          <EmptyScreen
            title="No environments found"
            description={
              <>
                No environments match <EmptyScreenQueryHighlight>{nameQuery.trim()}</EmptyScreenQueryHighlight>.
              </>
            }
            className="min-h-full"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table className="min-w-240">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-96 max-w-96">Name</TableHead>
                  <TableHead>Build Status</TableHead>
                  <TableHead>Resources</TableHead>
                  <TableHead>Networking</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(env => {
                  const readOnly = isEnvironmentReadOnly(env, currentUser?.subjectId);
                  return (
                    <TableRow
                      key={env.id}
                      className={readOnly ? undefined : 'cursor-pointer'}
                      onClick={() => {
                        if (!readOnly) setDrawer({ kind: 'edit', environment: env });
                      }}
                    >
                      <TableCell className="w-96 max-w-96">
                        <div className="flex flex-col gap-0.5">
                          <span className="truncate font-medium text-text-primary">{env.name}</span>
                          {env.description.length > 0 ? (
                            <Tooltip
                              content={env.description}
                              className="max-w-sm whitespace-normal text-left"
                              triggerClassName="block min-w-0 w-full max-w-full"
                            >
                              <span className="block truncate text-xs text-text-secondary">{env.description}</span>
                            </Tooltip>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <EnvironmentStatusBadge status={env.status} statusReason={env.statusReason} />
                      </TableCell>
                      <TableCell className="text-sm text-text-secondary">
                        {formatResourcesSummary(env.manifest.resources)}
                      </TableCell>
                      <TableCell className="text-sm text-text-secondary">
                        {formatNetworkingSummary(env.manifest.networking)}
                      </TableCell>
                      <TableCell className="text-sm text-text-secondary">
                        {readOnly ? '—' : formatRelativeTime(env.updatedAt)}
                      </TableCell>
                      <TableCell>
                        {!readOnly ? (
                          <button
                            type="button"
                            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                            aria-label={`Delete ${env.name}`}
                            onClick={event => {
                              event.stopPropagation();
                              setPendingDelete(env);
                            }}
                          >
                            <Icon name="trash" className="size-3.5 text-failure-bg" />
                          </button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {hasPageNav ? (
              <TableTokenPagination
                pageSize={pageSize}
                rowCount={filtered.length}
                canPrev={previousPageToken != null}
                canNext={nextPageToken != null}
                onPrev={() => setPageToken(previousPageToken)}
                onNext={() => setPageToken(nextPageToken)}
                pageSizeOptions={ENVIRONMENTS_PAGE_SIZE_OPTIONS}
                onPageSizeChange={size => {
                  setPageSize(clampPageSize(size));
                  setPageToken(undefined);
                }}
              />
            ) : null}
          </div>
        )}
      </div>

      <EnvironmentFormDrawer
        open={drawer.kind !== 'closed'}
        mode={drawer.kind === 'edit' ? 'edit' : 'create'}
        {...(drawer.kind === 'edit' ? { environment: drawer.environment } : {})}
        onOpenChange={open => {
          if (!open) setDrawer({ kind: 'closed' });
        }}
        onSaved={() => {
          setPageToken(undefined);
        }}
      />

      <Dialog open={pendingDelete != null} onOpenChange={open => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete environment</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            Delete <span className="font-medium text-text-primary">{pendingDelete?.name}</span>? This cannot be undone.
            Delete fails if any agent still references the environment.
          </p>
          <DialogFooter>
            <Button.Secondary type="button" disabled={deleting} onClick={() => setPendingDelete(null)}>
              Cancel
            </Button.Secondary>
            <Button.Primary type="button" disabled={deleting} onClick={() => void handleDelete()}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button.Primary>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    EnvironmentsPage: ComponentType<EnvironmentsPageProps>;
  }
}
