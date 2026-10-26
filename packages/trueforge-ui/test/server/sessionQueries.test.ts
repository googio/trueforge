import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServerQueryClient } from '@/server/queryClient.js';
import { withSessionCache } from '@/server/sessionQueries.js';

import { createMockAgentUIServer } from './mockServer.js';

const emptyPage = { data: [] };

function cachedServer(overrides: Parameters<typeof createMockAgentUIServer>[0] = {}) {
  const server = withSessionCache({
    server: createMockAgentUIServer(overrides),
    queryClient: createServerQueryClient(),
  });
  return server;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('withSessionCache', () => {
  it('reuses a page when requests differ only by startTimestamp', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    const first = await server.listSessions({ limit: 20, startTimestamp: '2025-09-09T00:00:00.000Z' });
    const second = await server.listSessions({ limit: 20, startTimestamp: '2025-09-09T00:00:00.001Z' });

    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('fetches separately per pageToken and agentId', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    await server.listSessions({ limit: 20 });
    await server.listSessions({ limit: 20, pageToken: 'page-2' });
    await server.listSessions({ limit: 20, agentId: 'agent-x' });

    expect(listSessions).toHaveBeenCalledTimes(3);
  });

  it('deduplicates concurrent requests for the same page', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    await Promise.all([server.listSessions({ limit: 20 }), server.listSessions({ limit: 20 })]);

    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it('clears the cache after createSession, updateSession, renameSession, and deleteSession', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const session = { id: 's1' };
    const server = cachedServer({
      listSessions,
      createSession: vi.fn().mockResolvedValue(session),
      updateSession: vi.fn().mockResolvedValue(session),
      renameSession: vi.fn().mockResolvedValue(undefined),
      deleteSession: vi.fn().mockResolvedValue(undefined),
    });

    await server.listSessions({ limit: 20 });
    await server.createSession({});
    await server.listSessions({ limit: 20 });
    await server.updateSession({ sessionId: 's1' });
    await server.listSessions({ limit: 20 });
    await server.renameSession?.({ sessionId: 's1', title: 'Renamed' });
    await server.listSessions({ limit: 20 });
    await server.deleteSession?.({ sessionId: 's1' });
    await server.listSessions({ limit: 20 });

    expect(listSessions).toHaveBeenCalledTimes(5);
  });

  it('refreshes session lists when a turn stream starts and ends', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({
      listSessions,
      createTurn: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          const createdAt = '2026-01-01T00:00:00Z';
          yield { sequenceNumber: 1, event: { type: 'turn.created' as const, id: 'e1', turnId: 't1', createdAt } };
          yield { sequenceNumber: 2, event: { type: 'turn.created' as const, id: 'e2', turnId: 't1', createdAt } };
        },
      })),
    });

    await server.listSessions({ limit: 20 });
    const stream = server.createTurn({ sessionId: 's1' })[Symbol.asyncIterator]();
    await stream.next();
    await server.listSessions({ limit: 20 });
    while (!(await stream.next()).done) {
      // Drain the turn.
    }
    await server.listSessions({ limit: 20 });

    expect(listSessions).toHaveBeenCalledTimes(3);
  });

  it('refreshes session lists when a resumed turn ends', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({
      listSessions,
      subscribeToTurn: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
    });

    await server.listSessions({ limit: 20 });
    for await (const data of server.subscribeToTurn?.({ sessionId: 's1', turnId: 't1' }) ?? []) void data;
    await server.listSessions({ limit: 20 });

    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed page instead of replaying the rejection', async () => {
    const listSessions = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    await expect(server.listSessions({ limit: 20 })).rejects.toThrow('boom');
    await expect(server.listSessions({ limit: 20 })).resolves.toEqual(emptyPage);
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('expires entries after the TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    await server.listSessions({ limit: 20 });
    vi.setSystemTime(29_000);
    await server.listSessions({ limit: 20 });
    expect(listSessions).toHaveBeenCalledTimes(1);

    vi.setSystemTime(31_000);
    await server.listSessions({ limit: 20 });
    expect(listSessions).toHaveBeenCalledTimes(2);
  });
});

const idlePage = {
  data: [{ turnId: 't1', event: { type: 'turn.done' } }],
  nextPageToken: 'older',
};
const runningPage = {
  data: [{ turnId: 't2', event: { type: 'model.message' } }],
  nextPageToken: 'older',
};

function historyServer({ updatedAt = ['2026-01-01T00:00:00Z'], page = idlePage, lastTurnId = 't1' } = {}) {
  const versions = [...updatedAt];
  const getSession = vi.fn(async ({ sessionId }: { sessionId: string }) => ({
    id: sessionId,
    isMutable: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: versions.length > 1 ? (versions.shift() ?? '') : (versions[0] ?? ''),
    lastTurnId,
  }));
  const listEvents = vi.fn().mockResolvedValue(page);
  const createTurn = vi.fn(() => ({ async *[Symbol.asyncIterator]() {} }));
  const cancelSession = vi.fn().mockResolvedValue(undefined);
  const createSession = vi.fn().mockResolvedValue({ id: 's2' });
  const server = cachedServer({ getSession, listEvents, createTurn, cancelSession, createSession });
  return { server, getSession, listEvents, createTurn, cancelSession };
}

async function openSession(server: ReturnType<typeof cachedServer>, sessionId = 's1') {
  await server.getSession({ sessionId });
  return server.listEvents({ sessionId, limit: 50 });
}

describe('withSessionCache history', () => {
  it('reopens an idle session from cache after confirming its version', async () => {
    const { server, getSession, listEvents } = historyServer();

    await openSession(server);
    const reopened = await openSession(server);

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(reopened).toEqual(idlePage);
  });

  it('refetches when the session changed elsewhere', async () => {
    const { server, listEvents } = historyServer({
      updatedAt: ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'],
    });

    await openSession(server);
    await openSession(server);

    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('does not cache a newest page while a turn is running', async () => {
    const { server, listEvents } = historyServer({ page: runningPage });

    await openSession(server);
    await openSession(server);

    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('does not read history without a freshly confirmed session version', async () => {
    const { server, listEvents } = historyServer();

    await server.listEvents({ sessionId: 's1', limit: 50 });
    await server.listEvents({ sessionId: 's1', limit: 50 });

    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('drops cached history when this client starts a turn', async () => {
    const { server, listEvents } = historyServer();

    await openSession(server);
    server.createTurn({ sessionId: 's1' });
    await server.listEvents({ sessionId: 's1', limit: 50 });

    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('drops cached history when this client cancels a turn', async () => {
    const { server, listEvents } = historyServer();

    await openSession(server);
    await server.cancelSession({ sessionId: 's1' });
    await openSession(server);

    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('refetches a session that finished after it was opened mid-turn', async () => {
    const { server, listEvents } = historyServer();
    listEvents.mockResolvedValueOnce(runningPage);

    await openSession(server);
    const afterFinish = await openSession(server);
    await openSession(server);

    expect(afterFinish).toEqual(idlePage);
    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('does not cache an idle tip that is not the session last turn', async () => {
    // Turn t2 is already the last turn but has not written `turn.created` yet.
    const { server, listEvents } = historyServer({ lastTurnId: 't2' });

    await openSession(server);
    await openSession(server);

    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('keeps older pages cached across session versions', async () => {
    const { server, listEvents } = historyServer({
      updatedAt: ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'],
    });

    await openSession(server);
    await server.listEvents({ sessionId: 's1', limit: 50, pageToken: 'older' });
    await server.getSession({ sessionId: 's1' });
    await server.listEvents({ sessionId: 's1', limit: 50, pageToken: 'older' });

    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('does not cache older pages paged from a running tip', async () => {
    const { server, listEvents } = historyServer({ page: runningPage });

    await openSession(server);
    await server.listEvents({ sessionId: 's1', limit: 50, pageToken: 'older' });
    await server.listEvents({ sessionId: 's1', limit: 50, pageToken: 'older' });

    expect(listEvents).toHaveBeenCalledTimes(3);
  });

  it('keeps history across new chats', async () => {
    const { server, listEvents } = historyServer();

    await openSession(server);
    await server.createSession({});
    await openSession(server);

    expect(listEvents).toHaveBeenCalledTimes(1);
  });
});
