import { describe, expect, it } from 'vitest';

import {
  canReuseMutableShell,
  formatRelativeShort,
  lastTurnStatusDotClass,
  readThreadAgentName,
  readThreadIsMutable,
  readThreadLastTurnStatus,
  threadCustomWithLastTurnStatus,
  threadListIndicesByRecency,
  threadListItemIsMutable,
} from '@/atoms/lib/threadListMeta.js';

describe('formatRelativeShort', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');

  it('formats minutes, hours, and days', () => {
    expect(formatRelativeShort(new Date('2026-08-06T11:30:00.000Z'), now)).toBe('30m');
    expect(formatRelativeShort(new Date('2026-08-05T14:00:00.000Z'), now)).toBe('22h');
    expect(formatRelativeShort(new Date('2026-08-05T12:00:00.000Z'), now)).toBe('1d');
  });
});

describe('readThreadAgentName', () => {
  it('reads agentName from custom metadata', () => {
    expect(readThreadAgentName({ agentName: 'from-sdk' })).toBe('from-sdk');
    expect(readThreadAgentName({})).toBeUndefined();
    expect(readThreadAgentName(null)).toBeUndefined();
    expect(readThreadAgentName({ agentName: 1 })).toBeUndefined();
  });
});

describe('readThreadLastTurnStatus', () => {
  it('reads a valid lastTurnStatus from custom metadata', () => {
    expect(readThreadLastTurnStatus({ lastTurnStatus: 'running' })).toBe('running');
    expect(readThreadLastTurnStatus({ lastTurnStatus: 'paused' })).toBe('paused');
    expect(readThreadLastTurnStatus({})).toBeUndefined();
    expect(readThreadLastTurnStatus({ lastTurnStatus: 'nope' })).toBeUndefined();
  });
});

describe('lastTurnStatusDotClass', () => {
  it('maps statuses to dot colors and hides done', () => {
    expect(lastTurnStatusDotClass('running')).toBe('bg-indigo-500');
    expect(lastTurnStatusDotClass('paused')).toBe('bg-amber-500');
    expect(lastTurnStatusDotClass('error')).toBe('bg-failure-bg');
    expect(lastTurnStatusDotClass('cancelled')).toBe('bg-failure-bg');
    expect(lastTurnStatusDotClass('done')).toBeUndefined();
    expect(lastTurnStatusDotClass(null)).toBeUndefined();
  });
});

describe('threadCustomWithLastTurnStatus', () => {
  it('sets and clears lastTurnStatus without dropping other custom keys', () => {
    expect(threadCustomWithLastTurnStatus({ isMutable: true, agentName: 'x' }, 'running')).toEqual({
      isMutable: true,
      agentName: 'x',
      lastTurnStatus: 'running',
    });
    expect(threadCustomWithLastTurnStatus({ isMutable: true, lastTurnStatus: 'running' }, null)).toEqual({
      isMutable: true,
    });
  });
});

describe('threadListItemIsMutable', () => {
  it('prefers custom.isMutable over agentName presence', () => {
    expect(readThreadIsMutable({ isMutable: false })).toBe(false);
    expect(threadListItemIsMutable({ isMutable: false })).toBe(false);
    // Orphaned named ref: no agentName, but still immutable on the wire.
    expect(threadListItemIsMutable({ isMutable: false })).toBe(false);
    expect(threadListItemIsMutable({ isMutable: true, agentName: 'x' })).toBe(true);
  });

  it('falls back to agentName heuristic when isMutable is absent', () => {
    expect(threadListItemIsMutable({ agentName: 'from-sdk' })).toBe(false);
    expect(threadListItemIsMutable({})).toBe(true);
    expect(threadListItemIsMutable(null)).toBe(true);
  });
});

describe('threadListIndicesByRecency', () => {
  it('orders by lastMessageAt newest-first even when ids were appended', () => {
    const older = new Date('2026-08-06T11:00:00.000Z');
    const newer = new Date('2026-08-06T12:00:00.000Z');
    // Selected session appended at end (assistant-ui switchToThread fetch race).
    expect(
      threadListIndicesByRecency({
        threadIds: ['older', 'newer-appended'],
        threadItems: [
          { id: 'older', remoteId: 'older', lastMessageAt: older },
          { id: 'newer-appended', remoteId: 'newer-appended', lastMessageAt: newer },
        ],
      }),
    ).toEqual([1, 0]);
  });

  it('pins threads without lastMessageAt above dated history (empty New Chat)', () => {
    const older = new Date('2026-08-06T11:00:00.000Z');
    const newer = new Date('2026-08-06T12:00:00.000Z');
    // Local new thread appended at end with no timestamp.
    expect(
      threadListIndicesByRecency({
        threadIds: ['older', 'newer', 'new-chat'],
        threadItems: [
          { id: 'older', remoteId: 'older', lastMessageAt: older },
          { id: 'newer', remoteId: 'newer', lastMessageAt: newer },
          { id: 'new-chat', remoteId: null, lastMessageAt: undefined },
        ],
      }),
    ).toEqual([2, 1, 0]);
  });
});

describe('canReuseMutableShell', () => {
  it('allows blank drafts to share the mutable shell', () => {
    expect(
      canReuseMutableShell({
        sessionMutable: true,
        shellMutable: true,
        remoteId: 'sess-b',
        pendingSessionId: 'sess-a',
      }),
    ).toBe(true);
  });

  it('blocks Edit-bound shells from reusing chrome on a different session', () => {
    expect(
      canReuseMutableShell({
        sessionMutable: true,
        shellMutable: true,
        shellAgentName: 'writer',
        remoteId: 'sess-b',
        pendingSessionId: 'sess-a',
      }),
    ).toBe(false);
  });

  it('allows Edit-bound shells to switchToThread for their pending session', () => {
    expect(
      canReuseMutableShell({
        sessionMutable: true,
        shellMutable: true,
        shellAgentName: 'writer',
        remoteId: 'sess-a',
        pendingSessionId: 'sess-a',
      }),
    ).toBe(true);
  });
});
