import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from './queryKeys.js';
import type { AgentUIServer, ListSessionsParams, TurnStreamData } from './types.js';

// `startTimestamp` is a rolling "now − 1 year" that differs on every call;
// keying on it would make each request unique and defeat the cache.
function listKeyParams(request: ListSessionsParams | undefined): ListSessionsParams {
  const rest: ListSessionsParams = { ...request };
  delete rest.startTimestamp;
  return rest;
}

/** Chat history stays cached long enough that switching back to a recent chat skips `listEvents`. */
const SESSION_HISTORY_GC_TIME_MS = 30 * 60_000;

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
    // Kept as long as history: its version locates the cached history to paint on reopen.
    gcTime: SESSION_HISTORY_GC_TIME_MS,
    ...(staleTime === undefined ? {} : { staleTime }),
  });
}

/** History loads call `getSession` right before `listEvents`; older versions are not trusted. */
const SESSION_VERSION_MAX_AGE_MS = 30_000;

type SessionEventsPage = Awaited<ReturnType<AgentUIServer['listEvents']>>;

type SessionDetail = Awaited<ReturnType<AgentUIServer['getSession']>>;

/** Older pages are keyed by token alone; the newest page also by the session version it was read against. */
function historyPageKey({
  request,
  version,
}: {
  request: Parameters<AgentUIServer['listEvents']>[0];
  version: string | undefined;
}) {
  const { sessionId, pageToken, lastTurnId, limit } = request;
  return queryKeys.sessionHistory.page({
    sessionId,
    ...(pageToken == null || pageToken === '' ? {} : { pageToken }),
    ...(lastTurnId === undefined ? {} : { lastTurnId }),
    ...(limit === undefined ? {} : { limit }),
    ...(version === undefined ? {} : { version }),
  });
}

/**
 * Session `updatedAt` moves when a turn starts or the session changes, but not while a running
 * turn appends events, so it versions the newest history page only once the session is idle.
 */
function confirmedSession({
  queryClient,
  sessionId,
}: {
  queryClient: QueryClient;
  sessionId: string;
}): SessionDetail | undefined {
  const state = queryClient.getQueryState<SessionDetail>(queryKeys.sessions.detail(sessionId));
  if (state?.data == null || state.isInvalidated) return undefined;
  if (Date.now() - state.dataUpdatedAt > SESSION_VERSION_MAX_AGE_MS) return undefined;
  return state.data;
}

/**
 * Only a finished tip is stable. A new turn becomes the session's last turn before it writes
 * `turn.created`, so a page ending on an earlier turn may be missing it.
 */
function endsOnFinishedLastTurn({ page, session }: { page: SessionEventsPage; session: SessionDetail }): boolean {
  const newest = page.data[0];
  return newest?.event.type === 'turn.done' && newest.turnId === session.lastTurnId;
}

/**
 * Older-page tokens are offsets from the newest turn they were paged from, so they only hold
 * still once that turn finished, which is true for tokens minted by an already cached page.
 */
function isStablePageToken({
  queryClient,
  sessionId,
  pageToken,
}: {
  queryClient: QueryClient;
  sessionId: string;
  pageToken: string;
}): boolean {
  return queryClient
    .getQueriesData<SessionEventsPage>({ queryKey: queryKeys.sessionHistory.session(sessionId) })
    .some(([, page]) => page?.nextPageToken === pageToken);
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
  const { deleteSession, renameSession, subscribeToTurn } = server;
  const invalidateSessions = () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });
  // A turn reorders session lists when it starts and updates titles and metrics when it ends.
  async function* refreshSessionsAround(stream: AsyncIterable<TurnStreamData>): AsyncIterable<TurnStreamData> {
    let started = false;
    try {
      for await (const data of stream) {
        if (!started) {
          started = true;
          void invalidateSessions();
        }
        yield data;
      }
    } finally {
      void invalidateSessions();
    }
  }
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
      const { sessionId, pageToken } = request;
      const olderPageToken = pageToken != null && pageToken !== '' ? pageToken : undefined;
      // The newest page is valid only for the session version just read.
      const session = olderPageToken === undefined ? confirmedSession({ queryClient, sessionId }) : undefined;
      const version = session?.updatedAt;
      const cacheable =
        olderPageToken === undefined
          ? session !== undefined
          : isStablePageToken({ queryClient, sessionId, pageToken: olderPageToken });
      if (!cacheable) return server.listEvents(request);
      const queryKey = historyPageKey({ request, version });
      const page = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => server.listEvents(request),
        staleTime: Infinity,
        gcTime: SESSION_HISTORY_GC_TIME_MS,
      });
      if (session !== undefined && !endsOnFinishedLastTurn({ page, session })) {
        queryClient.removeQueries({ queryKey, exact: true });
      }
      return page;
    },
    // Any version this client last confirmed locates the page; the runtime still reloads it.
    peekEvents(request) {
      const isOlderPage = request.pageToken != null && request.pageToken !== '';
      const version = isOlderPage
        ? undefined
        : queryClient.getQueryData<SessionDetail>(queryKeys.sessions.detail(request.sessionId))?.updatedAt;
      if (!isOlderPage && version === undefined) return undefined;
      return queryClient.getQueryData<SessionEventsPage>(historyPageKey({ request, version }));
    },
    createTurn(request) {
      forgetSession(request.sessionId);
      return refreshSessionsAround(server.createTurn(request));
    },
    ...(subscribeToTurn != null
      ? {
          subscribeToTurn: (request: Parameters<NonNullable<AgentUIServer['subscribeToTurn']>>[0]) =>
            refreshSessionsAround(subscribeToTurn.call(server, request)),
        }
      : {}),
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
