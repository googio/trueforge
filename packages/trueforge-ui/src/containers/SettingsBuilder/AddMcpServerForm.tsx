'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';
import type { ConnectorAuth, ConnectorAuthType, ConnectorBase } from '../../server/types.js';

export type McpAuthType = ConnectorAuthType;

export type AddMcpServerDraft = {
  name: string;
  url: string;
  description: string;
  auth: ConnectorAuth;
  additionalHeaders?: Record<string, string>;
};

type HeaderRow = { key: string; value: string };

type AddMcpServerFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: AddMcpServerDraft) => void | Promise<void>;
  connector?: ConnectorBase;
  busy?: boolean;
  error?: string | null;
};

const AUTH_OPTIONS: Array<{ value: McpAuthType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'header', label: 'API Key' },
  { value: 'dcr', label: 'OAuth' },
  { value: 'passthrough', label: 'Passthrough' },
];

const inputClassName = auiInputClass('h-11 shadow-sm');

const RequiredMark = () => (
  <span className="ml-0.5 text-failure-bg" aria-hidden>
    *
  </span>
);

function rowsFromHeaders(headers: Record<string, string> | undefined): HeaderRow[] {
  if (headers === undefined) {
    return [];
  }
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
}

function headersFromRows(rows: HeaderRow[]): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key.length === 0) {
      continue;
    }
    headers[key] = row.value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

const AddMcpServerForm = ({ open, onOpenChange, onSubmit, connector, busy = false, error }: AddMcpServerFormProps) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [authType, setAuthType] = useState<McpAuthType>('dcr');
  const [apiKey, setApiKey] = useState('');
  const [headerName, setHeaderName] = useState('');
  const [additionalHeaderRows, setAdditionalHeaderRows] = useState<HeaderRow[]>([]);
  const isEditing = connector !== undefined;
  const nameInputClassName = auiInputClass(
    `h-11 shadow-sm ${isEditing ? 'cursor-not-allowed bg-secondary-bg/60 text-text-secondary opacity-40' : ''}`,
  );

  const resetForm = () => {
    setName('');
    setUrl('');
    setDescription('');
    setAuthType('dcr');
    setApiKey('');
    setHeaderName('');
    setAdditionalHeaderRows([]);
  };

  useEffect(() => {
    if (!open) return;
    setName(connector?.name ?? '');
    setUrl(connector?.url ?? '');
    setDescription(connector?.description ?? '');
    setAuthType(connector?.auth.type ?? 'dcr');
    setApiKey('');
    setHeaderName(connector?.auth.type === 'header' ? (connector.auth.headerName ?? '') : '');
    setAdditionalHeaderRows(rowsFromHeaders(connector?.additionalHeaders));
  }, [connector, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const hasApiKey = !!apiKey.trim() || connector?.auth.type === 'header';
  const isValid = !!name.trim() && !!description.trim() && !!url.trim() && (authType !== 'header' || hasApiKey);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid || busy) return;

    const auth: ConnectorAuth =
      authType === 'header'
        ? {
            type: 'header',
            apiKey: apiKey.trim(),
            ...(headerName.trim() ? { headerName: headerName.trim() } : {}),
          }
        : { type: authType };
    const additionalHeaders = headersFromRows(additionalHeaderRows);

    try {
      await onSubmit({
        name: name.trim(),
        url: url.trim(),
        description: description.trim(),
        auth,
        ...(additionalHeaders === undefined ? {} : { additionalHeaders }),
      });
      resetForm();
      onOpenChange(false);
    } catch {
      // Parent surfaces error; keep form open.
    }
  };

  return (
    <CenteredModal
      open={open}
      onOpenChange={handleOpenChange}
      title={isEditing ? 'Edit MCP server' : 'Add MCP server'}
      description={
        isEditing
          ? 'Update how this connector authenticates.'
          : 'Point at a remote MCP endpoint. It then behaves like any other connector.'
      }
      contentSized
      headerIcon={
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary"
          aria-hidden
        >
          <Icon name="mcp-server" className="size-6" />
        </span>
      }
    >
      <form className="flex flex-col overflow-y-auto p-5 md:p-6" onSubmit={e => void handleSubmit(e)}>
        <div className="space-y-4">
          <div>
            <label htmlFor="mcp-server-name" className="mb-1.5 block text-sm font-medium text-text-primary">
              Name
              <RequiredMark />
            </label>
            <input
              id="mcp-server-name"
              type="text"
              required
              value={name}
              readOnly={isEditing}
              aria-disabled={isEditing}
              onChange={event => {
                setName(event.target.value);
              }}
              placeholder="analytics-postgres-mcp"
              autoFocus={!isEditing}
              className={nameInputClassName}
            />
          </div>

          <div>
            <label htmlFor="mcp-server-description" className="mb-1.5 block text-sm font-medium text-text-primary">
              Description
              <RequiredMark />
            </label>
            <textarea
              id="mcp-server-description"
              value={description}
              onChange={event => {
                setDescription(event.target.value);
              }}
              placeholder="Query analytics from Postgres"
              required
              rows={3}
              className={auiInputClass('resize-y py-2.5 shadow-sm')}
            />
          </div>

          <div>
            <label htmlFor="mcp-server-url" className="mb-1.5 block text-sm font-medium text-text-primary">
              URL
              <RequiredMark />
            </label>
            <input
              id="mcp-server-url"
              type="url"
              required
              value={url}
              onChange={event => {
                setUrl(event.target.value);
              }}
              placeholder="https://mcp.example.com/mcp"
              className={inputClassName}
            />
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-text-primary">
              Auth type
              <RequiredMark />
            </legend>
            <div className="flex w-full flex-row rounded-md border border-border bg-secondary-bg/40 p-1">
              {AUTH_OPTIONS.map(option => (
                <label
                  key={option.value}
                  className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-sm text-sm font-medium transition-colors ${
                    authType === option.value
                      ? 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <input
                    type="radio"
                    name="mcp-auth-type"
                    value={option.value}
                    checked={authType === option.value}
                    onChange={() => {
                      setAuthType(option.value);
                    }}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {authType === 'dcr' ? (
            <div className="flex gap-1.5 bg-secondary-bg/40 p-2 rounded-md">
              <Icon name="info" className="size-3.5 mt-1 text-text-secondary" />
              <div className="text-xs text-text-secondary leading-5.5">
                Sign-in only — the server must support dynamic client registration. Manual OAuth (client ID / secret)
                isn't supported yet.
              </div>
            </div>
          ) : null}

          {authType === 'passthrough' ? (
            <div className="flex gap-1.5 bg-secondary-bg/40 p-2 rounded-md">
              <Icon name="info" className="size-3.5 mt-1 text-text-secondary" />
              <div className="text-xs text-text-secondary leading-5.5">
                Forward the signed-in user&apos;s auth token directly to this MCP server. Use only for servers you
                trust. Scheduled runs with no caller token will fail.
              </div>
            </div>
          ) : null}

          {authType === 'header' ? (
            <>
              <div>
                <label htmlFor="mcp-server-api-key" className="mb-1.5 block text-sm font-medium text-text-primary">
                  API key
                  {connector?.auth.type === 'header' ? (
                    <span className="font-normal text-text-secondary"> (leave blank to keep current)</span>
                  ) : (
                    <RequiredMark />
                  )}
                </label>
                <input
                  id="mcp-server-api-key"
                  type="password"
                  required={connector?.auth.type !== 'header'}
                  value={apiKey}
                  onChange={event => {
                    setApiKey(event.target.value);
                  }}
                  placeholder="Bearer <Paste the token from the provider>"
                  aria-describedby="mcp-server-api-key-hint"
                  className={inputClassName}
                />
                <p id="mcp-server-api-key-hint" className="mt-1.5 text-xs text-text-secondary">
                  {`This is the value for the "${headerName.trim() || 'Authorization'}" header.`}
                </p>
              </div>

              <div>
                <label htmlFor="mcp-server-header-name" className="mb-1.5 block text-sm font-medium text-text-primary">
                  Header name <span className="font-normal text-text-secondary">(optional)</span>
                </label>
                <input
                  id="mcp-server-header-name"
                  type="text"
                  value={headerName}
                  onChange={event => {
                    setHeaderName(event.target.value);
                  }}
                  placeholder="Authorization"
                  className={inputClassName}
                />
              </div>
            </>
          ) : null}

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-text-primary">
                Additional headers <span className="font-normal text-text-secondary">(optional)</span>
              </label>
              <Button.Secondary
                type="button"
                size="small"
                onClick={() => {
                  setAdditionalHeaderRows(rows => [...rows, { key: '', value: '' }]);
                }}
              >
                Add header
              </Button.Secondary>
            </div>
            <p className="mb-2 text-xs text-text-secondary">
              Sent on each request. If the same header is set in auth, the auth value wins.
            </p>
            {additionalHeaderRows.length > 0 ? (
              <div className="space-y-2">
                {additionalHeaderRows.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.key}
                      onChange={event => {
                        const key = event.target.value;
                        setAdditionalHeaderRows(rows => rows.map((item, i) => (i === index ? { ...item, key } : item)));
                      }}
                      placeholder="Header name"
                      className={inputClassName}
                      aria-label={`Additional header ${index + 1} name`}
                    />
                    <input
                      type="text"
                      value={row.value}
                      onChange={event => {
                        const value = event.target.value;
                        setAdditionalHeaderRows(rows =>
                          rows.map((item, i) => (i === index ? { ...item, value } : item)),
                        );
                      }}
                      placeholder="Value"
                      className={inputClassName}
                      aria-label={`Additional header ${index + 1} value`}
                    />
                    <Button.Secondary
                      type="button"
                      size="small"
                      aria-label={`Remove additional header ${index + 1}`}
                      onClick={() => {
                        setAdditionalHeaderRows(rows => rows.filter((_, i) => i !== index));
                      }}
                    >
                      <Icon name="trash" className="size-3.5" />
                    </Button.Secondary>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {error ? <p className="text-failure-bg text-sm">{error}</p> : null}
          <Button.Primary type="submit" size="large" disabled={!isValid || busy} className="w-full shrink-0">
            {isEditing ? 'Save' : 'Add'}
          </Button.Primary>
        </div>
      </form>
    </CenteredModal>
  );
};

export default AddMcpServerForm;
