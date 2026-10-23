'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type FormEvent } from 'react';

import { useTrackAnalytics } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { cn } from '@/atoms/lib/cn.js';
import { auiInputClass } from '@/atoms/lib/inputClasses.js';
import { Button } from '@/atoms/primitives/Button.js';
import { CatalogLogo } from '@/atoms/primitives/CatalogLogo.js';
import { CenteredModal } from '@/atoms/primitives/CenteredModal.js';
import SearchInput from '@/atoms/primitives/SearchInput.js';
import { useMCPAuth } from '@/hooks/useMcpAuth.js';
import { Icon } from '@/icons/Icon.js';
import { CATALOG_STALE_TIME_MS, useServerQueryClient } from '@/server/queryClient.js';
import { queryKeys } from '@/server/queryKeys.js';
import { useCatalogServer } from '@/server/ServerContext.js';
import type { ConnectorAuth, ConnectorBase, ConnectorCatalogEntry } from '@/server/types.js';
import { getErrorMessage } from '@/utils/getErrorMessage.js';
import { useToasterOptional } from '../ToasterContainer.js';
import AddMcpServerForm, { type AddMcpServerDraft } from './AddMcpServerForm.js';
import { AUTH_TYPE_LABELS } from './authTypeLabels.js';
import ConfirmDeleteDialog from './ConfirmDeleteDialog.js';
import ConnectorDetails from './ConnectorDetails.js';

type ConnectorListItem =
  { connector: ConnectorBase; isConfigured: true } | { connector: ConnectorCatalogEntry; isConfigured: false };

const EMPTY_CONFIGURED: ConnectorBase[] = [];
const EMPTY_CATALOG: ConnectorCatalogEntry[] = [];

const ConnectorSettings = () => {
  const { connectorCatalog } = useCatalogServer();
  const queryClient = useServerQueryClient();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();
  const { handleAuthorize, isOAuthLoading } = useMCPAuth();

  const [query, setQuery] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [addMcpServerFormOpen, setAddMcpServerFormOpen] = useState(false);
  const [editingConnector, setEditingConnector] = useState<ConnectorBase | null>(null);
  const [connectorAwaitingKey, setConnectorAwaitingKey] = useState<ConnectorCatalogEntry | null>(null);
  // Track the id so the detail view always shows the latest cached connector.
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<ConnectorBase | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');

  const configuredQuery = useQuery(
    {
      queryKey: queryKeys.settings.connectors(),
      queryFn: () => connectorCatalog.listConnectors(),
      staleTime: CATALOG_STALE_TIME_MS,
    },
    queryClient,
  );
  const catalogQuery = useQuery(
    {
      queryKey: queryKeys.catalog.connectorCatalog(),
      queryFn: () => connectorCatalog.getConnectorCatalog(),
      staleTime: CATALOG_STALE_TIME_MS,
    },
    queryClient,
  );
  const configured = configuredQuery.data ?? EMPTY_CONFIGURED;
  const catalog = catalogQuery.data ?? EMPTY_CATALOG;
  const loading = configuredQuery.isPending || catalogQuery.isPending;
  const loadError = configuredQuery.error ?? catalogQuery.error;
  const error = loadError == null ? mutationError : getErrorMessage(loadError, 'Failed to load connectors');
  const selectedConnector =
    selectedConnectorId == null ? null : (configured.find(item => item.id === selectedConnectorId) ?? null);

  const connectorIconMap = useMemo(() => {
    return catalog.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.name] = entry.logo ?? '';
      return acc;
    }, {});
  }, [catalog]);

  const orderedConnectors = useMemo(() => {
    const seenIds = new Set(configured.map(connector => connector.id));
    return [
      ...configured.map<ConnectorListItem>(connector => ({ connector, isConfigured: true })),
      ...catalog
        .filter(connector => !seenIds.has(connector.id))
        .map<ConnectorListItem>(connector => ({ connector, isConfigured: false })),
    ];
  }, [catalog, configured]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.connectors() }),
      // Tool lists depend on the connector's auth state.
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.connectorToolsAll() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.mcpToolsAll() }),
      // Pickers and the config drawer read connector auth state from these.
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.mcp() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.mcpConnectors() }),
    ]);
  }, [queryClient]);

  const normalizedQuery = query.trim().toLowerCase();

  const matchingConnectors = useMemo(() => {
    if (!normalizedQuery) return orderedConnectors;
    return orderedConnectors.filter(({ connector }) => {
      return (
        connector.name.toLowerCase().includes(normalizedQuery) ||
        (connector.description?.toLowerCase().includes(normalizedQuery) ?? false) ||
        connector.url.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [orderedConnectors, normalizedQuery]);

  const matchingConnected = useMemo(() => {
    const result: ConnectorBase[] = [];
    for (const item of matchingConnectors) {
      if (item.isConfigured) result.push(item.connector);
    }
    return result;
  }, [matchingConnectors]);

  const availableConnectors = useMemo(() => {
    const result: ConnectorCatalogEntry[] = [];
    for (const item of matchingConnectors) {
      if (!item.isConfigured) result.push(item.connector);
    }
    return result;
  }, [matchingConnectors]);

  const runMutation = async (fn: () => Promise<void>, reportError = setMutationError) => {
    setBusy(true);
    setMutationError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      reportError(getErrorMessage(err, 'Request failed'));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const closeApiKeyModal = () => {
    setConnectorAwaitingKey(null);
    setApiKey('');
    setFormError(null);
  };

  const createFromCatalog = async (entry: ConnectorCatalogEntry, authOverride?: ConnectorAuth) => {
    const auth: ConnectorAuth =
      authOverride ??
      (entry.auth.type === 'header'
        ? {
            type: 'header',
            ...(entry.auth.headerName ? { headerName: entry.auth.headerName } : {}),
          }
        : entry.auth.type === 'dcr'
          ? { type: 'dcr' }
          : { type: 'none' });
    await connectorCatalog.createConnector({
      name: entry.name,
      description: entry.description ?? entry.url,
      url: entry.url,
      auth,
    });
  };

  const handleConnect = (entry: ConnectorCatalogEntry) => {
    if (entry.auth.type === 'header') {
      setApiKey('');
      setFormError(null);
      setConnectorAwaitingKey(entry);
      return;
    }

    void runMutation(async () => {
      await createFromCatalog(entry);
      track(AnalyticsEvents.Settings.CONNECTOR_SAVED, { connector_name: entry.name, mode: 'create' });
    }).catch(() => {});
  };

  const handleApiKeySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connectorAwaitingKey || !apiKey.trim()) return;

    const entry = connectorAwaitingKey;
    setFormError(null);
    void runMutation(async () => {
      const auth: ConnectorAuth = {
        type: 'header',
        apiKey: apiKey.trim(),
        ...(entry.auth.type === 'header' && entry.auth.headerName ? { headerName: entry.auth.headerName } : {}),
      };
      await createFromCatalog(entry, auth);
      closeApiKeyModal();
      setTimeout(() => {
        toaster?.showSuccess({
          title: `${entry.name} connected`,
        });
        track(AnalyticsEvents.Settings.CONNECTOR_SAVED, { connector_name: entry.name, mode: 'create' });
      }, 100);
    }, setFormError).catch(() => {});
  };

  const handleMcpServerSubmit = async (draft: AddMcpServerDraft) => {
    setFormError(null);
    await runMutation(async () => {
      if (editingConnector) {
        await connectorCatalog.updateConnector({ id: editingConnector.id, ...draft });
      } else {
        await connectorCatalog.createConnector({ ...draft });
      }
    }, setFormError);
    setTimeout(() => {
      toaster?.showSuccess({ title: `${draft.name} ${editingConnector ? 'updated' : 'added'}` });
      track(AnalyticsEvents.Settings.CONNECTOR_SAVED, {
        connector_name: draft.name,
        mode: editingConnector ? 'update' : 'create',
      });
    }, 0);
  };

  const handleDisconnect = (connector: ConnectorBase) => {
    void runMutation(async () => {
      await connectorCatalog.disconnectConnector({ id: connector.id });
      track(AnalyticsEvents.Settings.CONNECTOR_DISCONNECTED, { connector_name: connector.name });
      setSelectedConnectorId(null);
    }).catch(() => {});
  };

  const closeRemoveDialog = () => {
    if (busy) return;
    setPendingRemoval(null);
    setRemoveError(null);
  };

  const handleRemove = (connector: ConnectorBase) => {
    const deleteConnector = connectorCatalog.deleteConnector;
    if (!deleteConnector) return;
    setRemoveError(null);
    void runMutation(async () => {
      await deleteConnector({ id: connector.id });
      track(AnalyticsEvents.Settings.CONNECTOR_DELETED, { connector_name: connector.name });
      setPendingRemoval(null);
      setSelectedConnectorId(null);
    }, setRemoveError).catch(() => {});
  };

  const handleConnectorRefreshed = (refreshedConnector: ConnectorBase) => {
    queryClient.setQueryData(queryKeys.settings.connectors(), (current: ConnectorBase[] | undefined) =>
      current?.map(item => (item.id === refreshedConnector.id ? refreshedConnector : item)),
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.mcp() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.mcpConnectors() });
  };

  const renderConnector = (connector: ConnectorBase, isConnected: boolean) => {
    const logoSrc = connectorIconMap[connector.name];
    const content = (
      <>
        <span
          className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary-bg"
          aria-hidden
        >
          {logoSrc ? (
            <CatalogLogo src={logoSrc} alt={connector.name} className="size-4.5" />
          ) : (
            <Icon name="mcp-server" className="size-4.5 text-text-primary" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h5 className="truncate text-sm font-medium text-text-primary">{connector.name}</h5>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-full border border-border bg-secondary-bg/40 px-2 py-0.5 text-xs font-medium',
                  connector.authenticated ? 'text-success-bg' : 'text-text-primary',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    connector.authenticated ? 'bg-success-bg' : 'bg-primary-button-bg',
                  )}
                ></span>
                {connector.authenticated ? 'Connected' : 'Added'}
              </span>
            </div>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-text-secondary sm:truncate">{connector.description}</p>
        </div>
      </>
    );

    const rowClassName = 'flex min-h-16 w-full items-center gap-3 border-b border-border p-3 text-left last:border-b-0';
    // OAuth servers land here unauthenticated, so the list offers the same Connect as the detail view.
    const needsAuthorization = connector.auth.type === 'dcr' && !connector.authenticated;
    const connecting = isOAuthLoading && authorizingId === connector.id;

    if (isConnected) {
      return (
        <article
          key={connector.id}
          className={`${rowClassName} cursor-pointer transition-colors hover:bg-ghost-button-hover/60`}
          onClick={() => {
            setSelectedConnectorId(connector.id);
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>

          <div className="flex items-center gap-2">
            {needsAuthorization ? (
              <Button.Secondary
                size="small"
                type="button"
                disabled={busy || connecting}
                onClick={event => {
                  event.stopPropagation();
                  setAuthorizingId(connector.id);
                  void handleAuthorize(connector.id, isSuccess => {
                    setAuthorizingId(null);
                    if (isSuccess) void refresh();
                  });
                }}
              >
                {connecting ? 'Connecting…' : 'Connect'}
              </Button.Secondary>
            ) : null}
            <Button.Secondary
              size="small"
              type="button"
              disabled={busy}
              onClick={event => {
                event.stopPropagation();
                setFormError(null);
                setEditingConnector(connector);
                setAddMcpServerFormOpen(true);
              }}
            >
              <Icon name="pencil" className="size-3" />
              Edit
            </Button.Secondary>
            {connectorCatalog.deleteConnector ? (
              <Button.Secondary
                size="small"
                className="transition-colors hover:bg-failure-bg/10 hover:text-failure-bg"
                type="button"
                disabled={busy}
                aria-label={`Remove ${connector.name}`}
                onClick={event => {
                  event.stopPropagation();
                  setRemoveError(null);
                  setPendingRemoval(connector);
                }}
              >
                Remove
              </Button.Secondary>
            ) : null}
            <Icon name="chevron-right" className="size-4" />
          </div>
        </article>
      );
    }

    return (
      <article key={connector.id} className={rowClassName}>
        {content}
      </article>
    );
  };

  const renderCatalogEntry = (entry: ConnectorCatalogEntry) => {
    const logoSrc = connectorIconMap[entry.name];
    return (
      <article
        key={entry.id}
        className="flex min-h-16 w-full items-center gap-3 border-b border-border p-3 text-left last:border-b-0"
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary-bg"
          aria-hidden
        >
          {logoSrc ? (
            <CatalogLogo src={logoSrc} alt={entry.name} className="size-4.5" />
          ) : (
            <Icon name="mcp-server" className="size-4.5 text-text-primary" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h5 className="truncate text-sm font-medium text-text-primary">{entry.name}</h5>
          <p className="mt-0.5 line-clamp-2 text-sm text-text-secondary sm:truncate">
            {entry.description ?? entry.url}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-text-secondary sm:inline">
            {AUTH_TYPE_LABELS[entry.auth.type] ?? AUTH_TYPE_LABELS.none}
          </span>
          <Button.Secondary
            size="small"
            type="button"
            disabled={busy}
            onClick={() => {
              handleConnect(entry);
            }}
          >
            {entry.auth.type === 'dcr' ? 'Add' : 'Connect'}
          </Button.Secondary>
        </div>
      </article>
    );
  };

  const confirmDeleteDialog = pendingRemoval ? (
    <ConfirmDeleteDialog
      title="Remove connector?"
      description={`“${pendingRemoval.name}” will no longer be available to your agents.`}
      busy={busy}
      error={removeError}
      onCancel={closeRemoveDialog}
      onConfirm={() => {
        handleRemove(pendingRemoval);
      }}
    />
  ) : null;

  if (selectedConnector) {
    return (
      <>
        <ConnectorDetails
          connector={selectedConnector}
          busy={busy}
          onBack={() => {
            setSelectedConnectorId(null);
          }}
          onConnectorRefreshed={handleConnectorRefreshed}
          onEdit={() => {
            setFormError(null);
            setEditingConnector(selectedConnector);
            setAddMcpServerFormOpen(true);
          }}
          onDisconnect={() => {
            handleDisconnect(selectedConnector);
          }}
          onRemove={
            connectorCatalog.deleteConnector
              ? () => {
                  setRemoveError(null);
                  setPendingRemoval(selectedConnector);
                }
              : undefined
          }
        />
        <AddMcpServerForm
          open={addMcpServerFormOpen}
          onOpenChange={open => {
            setAddMcpServerFormOpen(open);
            if (!open) {
              setEditingConnector(null);
              setFormError(null);
            }
          }}
          onSubmit={handleMcpServerSubmit}
          connector={editingConnector ?? undefined}
          busy={busy}
          error={formError}
        />
        {confirmDeleteDialog}
      </>
    );
  }

  const hasMatches = matchingConnected.length > 0 || availableConnectors.length > 0;

  return (
    <>
      <h3 className="text-xl font-semibold tracking-tight text-text-primary">Connectors</h3>
      <p className="mt-1 text-sm text-text-secondary">Connect tools your agents can use.</p>

      {error ? (
        <p className="mt-3 rounded-md border border-failure-bg/30 bg-failure-bg/10 px-3 py-2 text-sm text-failure-bg">
          {error}
        </p>
      ) : null}

      <div className="mt-4 min-h-0 min-w-0 flex-1 overflow-y-hidden">
        <div className="flex h-full min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <SearchInput query={query} setQuery={setQuery} placeholder="Search connectors" />
            </div>
            <Button.Secondary
              type="button"
              className="shrink-0"
              onClick={() => {
                setFormError(null);
                setEditingConnector(null);
                setAddMcpServerFormOpen(true);
              }}
            >
              <Icon name="plus" size="1rem" className="mr-1" />
              Add MCP Server
            </Button.Secondary>
          </div>

          <div className="flex flex-1 flex-col gap-5 overflow-y-auto pb-1">
            {loading ? <p className="py-8 text-center text-sm text-text-secondary">Loading…</p> : null}

            {!loading && matchingConnected.length > 0 ? (
              <section aria-labelledby="connected-connectors-heading">
                <h4
                  id="connected-connectors-heading"
                  className="mb-2 text-[0.8125rem] font-semibold uppercase text-text-secondary"
                >
                  Configured · {matchingConnected.length}
                </h4>
                <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
                  {matchingConnected.map(connector => renderConnector(connector, true))}
                </div>
              </section>
            ) : null}

            {!loading && availableConnectors.length > 0 ? (
              <section aria-labelledby="available-connectors-heading">
                <h4
                  id="available-connectors-heading"
                  className="mb-2 text-[0.8125rem] font-semibold uppercase text-text-secondary"
                >
                  Available · {availableConnectors.length}
                </h4>
                <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
                  {availableConnectors.map(entry => renderCatalogEntry(entry))}
                </div>
              </section>
            ) : null}

            {!loading && !hasMatches ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-secondary">
                {query.trim() ? `No connectors match “${query.trim()}”.` : 'No connectors yet.'}
              </div>
            ) : null}
          </div>

          <CenteredModal
            open={connectorAwaitingKey !== null}
            onOpenChange={open => {
              if (!open) closeApiKeyModal();
            }}
            title={`Connect ${connectorAwaitingKey?.name ?? 'connector'}`}
            description={connectorAwaitingKey?.url}
            contentSized
            className="md:max-w-xl"
          >
            <form onSubmit={handleApiKeySubmit}>
              <div className="space-y-5 px-5 py-5">
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary-bg"
                    aria-hidden
                  >
                    <Icon name="mcp-server" className="size-6 text-text-primary" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary">{connectorAwaitingKey?.name}</p>
                    <p className="truncate text-sm text-text-secondary">{connectorAwaitingKey?.description}</p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="connector-api-key"
                    className="mb-2 block text-xs font-semibold uppercase tracking-wide text-text-secondary"
                  >
                    API key / token
                  </label>
                  <input
                    id="connector-api-key"
                    type="password"
                    value={apiKey}
                    onChange={event => {
                      setApiKey(event.target.value);
                    }}
                    placeholder={`Bearer <Paste the token from ${connectorAwaitingKey?.name ?? 'the provider'}>`}
                    autoFocus
                    required
                    className={auiInputClass('h-11')}
                  />
                </div>
                {formError ? <p className="text-failure-bg text-sm">{formError}</p> : null}
              </div>

              <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">
                <Button.Ghost type="button" onClick={closeApiKeyModal} disabled={busy}>
                  Cancel
                </Button.Ghost>
                <Button.Primary type="submit" disabled={!apiKey.trim() || busy}>
                  Connect
                </Button.Primary>
              </footer>
            </form>
          </CenteredModal>

          <AddMcpServerForm
            open={addMcpServerFormOpen}
            onOpenChange={open => {
              setAddMcpServerFormOpen(open);
              if (!open) {
                setEditingConnector(null);
                setFormError(null);
              }
            }}
            onSubmit={handleMcpServerSubmit}
            connector={editingConnector ?? undefined}
            busy={busy}
            error={formError}
          />
          {confirmDeleteDialog}
        </div>
      </div>
    </>
  );
};

export default ConnectorSettings;
