import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from './queryKeys.js';
import type { AgentUIServer, ListSessionsParams } from './types.js';

// `startTimestamp` is a rolling "now − 1 year" that differs on every call;
// keying on it would make each request unique and defeat the cache.
function listKeyParams(request: ListSessionsParams | undefined): ListSessionsParams {
  const rest: ListSessionsParams = { ...request };
  delete rest.startTimestamp;
  return rest;
}

/** Reads one session through the shared cache; pass `staleTime: 0` when the caller needs fresh server state. */
export function fetchSessionDetail({
  queryClient,
  server,
  sessionId,
  staleTime,
}: {
  queryClient: QueryClient;
  server: Pick<AgentUIServer, 'getSession'>;
  sessionId: string;
  staleTime?: number;
}): ReturnType<AgentUIServer['getSession']> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.sessions.detail(sessionId),
    queryFn: () => server.getSession({ sessionId }),
    ...(staleTime === undefined ? {} : { staleTime }),
  });
}

/** Chat history stays cached long enough that switching back to a recent chat skips `listEvents`. */
const SESSION_HISTORY_GC_TIME_MS = 30 * 60_000;
/** History loads call `getSession` right before `listEvents`; older versions are not trusted. */
const SESSION_VERSION_MAX_AGE_MS = 30_000;

type SessionEventsPage = Awaited<ReturnType<AgentUIServer['listEvents']>>;

/**
 * Session `updatedAt` moves when a turn starts or the session changes, but not while a running
 * turn appends events, so it versions the newest history page only once the session is idle.
 */
function sessionHistoryVersion({
  queryClient,
  sessionId,
}: {
  queryClient: QueryClient;
  sessionId: string;
}): string | undefined {
  const state = queryClient.getQueryState<Awaited<ReturnType<AgentUIServer['getSession']>>>(
    queryKeys.sessions.detail(sessionId),
  );
  if (state?.data == null || state.isInvalidated) return undefined;
  if (Date.now() - state.dataUpdatedAt > SESSION_VERSION_MAX_AGE_MS) return undefined;
  return state.data.updatedAt;
}

/** A running turn keeps appending events without bumping `updatedAt`; only an idle tip is stable. */
function endsIdle(page: SessionEventsPage): boolean {
  return page.data[0]?.event.type === 'turn.done';
}

/**
 * Caches session lists and chat history for the runtime, and drops a session's cached
 * history whenever this client changes it.
 */
export function withSessionCache({
  server,
  queryClient,
}: {
  server: AgentUIServer;
  queryClient: QueryClient;
}): AgentUIServer {
  const { deleteSession, renameSession } = server;
  const invalidateSessions = () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });
  const forgetSession = (sessionId: string) => {
    queryClient.removeQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
    queryClient.removeQueries({ queryKey: queryKeys.sessionHistory.session(sessionId) });
  };
  return {
    ...server,
    listSessions(request) {
      return queryClient.fetchQuery({
        queryKey: queryKeys.sessions.list(listKeyParams(request)),
        queryFn: () => server.listSessions(request),
      });
    },
    // Always fresh: its `updatedAt` decides whether cached history is still valid.
    getSession(request) {
      return fetchSessionDetail({ queryClient, server, sessionId: request.sessionId, staleTime: 0 });
    },
    async listEvents(request) {
      const { sessionId, pageToken, lastTurnId, limit } = request;
      const isOlderPage = pageToken != null && pageToken !== '';
      // Older pages are immutable; the newest page is valid only for the session version just read.
      const version = isOlderPage ? undefined : sessionHistoryVersion({ queryClient, sessionId });
      if (!isOlderPage && version === undefined) return server.listEvents(request);
      const queryKey = queryKeys.sessionHistory.page({
        sessionId,
        ...(isOlderPage ? { pageToken } : {}),
        ...(lastTurnId === undefined ? {} : { lastTurnId }),
        ...(limit === undefined ? {} : { limit }),
        ...(version === undefined ? {} : { version }),
      });
      const page = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => server.listEvents(request),
        staleTime: Infinity,
        gcTime: SESSION_HISTORY_GC_TIME_MS,
      });
      if (!isOlderPage && !endsIdle(page)) queryClient.removeQueries({ queryKey, exact: true });
      return page;
    },
    createTurn(request) {
      forgetSession(request.sessionId);
      return server.createTurn(request);
    },
    async cancelSession(request) {
      forgetSession(request.sessionId);
      await server.cancelSession(request);
    },
    async createSession(request) {
      const result = await server.createSession(request);
      void invalidateSessions();
      return result;
    },
    async updateSession(request) {
      forgetSession(request.sessionId);
      const result = await server.updateSession(request);
      void invalidateSessions();
      return result;
    },
    ...(deleteSession != null
      ? {
          deleteSession: async (request: { sessionId: string }) => {
            await deleteSession.call(server, request);
            forgetSession(request.sessionId);
            void invalidateSessions();
          },
        }
      : {}),
    ...(renameSession != null
      ? {
          renameSession: async (request: { sessionId: string; title: string }) => {
            await renameSession.call(server, request);
            forgetSession(request.sessionId);
            void invalidateSessions();
          },
        }
      : {}),
  };
}
