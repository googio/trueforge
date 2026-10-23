'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useEffect, useRef } from 'react';

import { useAui, useAuiState } from '../assistant-ui.js';
import { useServerQueryClient } from '../server/queryClient.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { fetchSessionDetail } from '../server/sessionQueries.js';

/**
 * After a turn ends, read `session.title` from GET /sessions/{id} and rename the
 * thread-list row. Initialize only stores `remoteId`, so first chats stay
 * "New Chat" until this runs.
 */
export function useSyncSessionTitle(): void {
  const server = useOptionalServer();
  const queryClient = useServerQueryClient();
  const aui = useAui();
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const title = useAuiState(s => s.threadListItem.title);
  const isRunning = useThreadIsRunning();
  const wasRunningRef = useRef(false);
  const syncedRemoteIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    syncedRemoteIdRef.current = undefined;
  }, [remoteId]);

  useEffect(() => {
    const finishedTurn = wasRunningRef.current && !isRunning;
    wasRunningRef.current = isRunning;

    if (!finishedTurn || server == null || remoteId == null) {
      return;
    }
    if (syncedRemoteIdRef.current === remoteId) {
      return;
    }
    // History rows already carry a title; only fill blank / "new" local rows.
    if (title != null && title.trim() !== '') {
      syncedRemoteIdRef.current = remoteId;
      return;
    }

    let cancelled = false;
    // The title is generated during the turn, so bypass any cached copy.
    void fetchSessionDetail({ queryClient, server, sessionId: remoteId, staleTime: 0 })
      .then(session => {
        if (cancelled) return;
        const nextTitle = typeof session.title === 'string' ? session.title.trim() : '';
        if (nextTitle.length === 0) return;
        syncedRemoteIdRef.current = remoteId;
        return aui.threadListItem().rename(nextTitle);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [aui, isRunning, queryClient, remoteId, server, title]);
}
