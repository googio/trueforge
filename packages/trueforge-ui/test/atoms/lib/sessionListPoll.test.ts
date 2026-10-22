import { describe, expect, it } from 'vitest';

import {
  isNonTerminalTurnStatus,
  mergeSessionListFirstPage,
  SESSION_LIST_FIRST_PAGE_LIMIT,
} from '@/atoms/lib/sessionListPoll.js';

describe('isNonTerminalTurnStatus', () => {
  it('treats running and paused as live', () => {
    expect(isNonTerminalTurnStatus('running')).toBe(true);
    expect(isNonTerminalTurnStatus('paused')).toBe(true);
    expect(isNonTerminalTurnStatus('done')).toBe(false);
    expect(isNonTerminalTurnStatus('error')).toBe(false);
    expect(isNonTerminalTurnStatus(null)).toBe(false);
  });
});

describe('mergeSessionListFirstPage', () => {
  it('patches matching ids and leaves later pages untouched', () => {
    const current = [
      { id: 'a', status: 'running' },
      { id: 'b', status: 'running' },
      { id: 'c', status: 'running' },
    ];
    const merged = mergeSessionListFirstPage({
      current,
      firstPage: [
        { id: 'a', status: 'done' },
        { id: 'b', status: 'paused' },
      ],
      mergeItem: (prev, next) => (prev.status === next.status ? prev : { ...prev, status: next.status }),
    });

    expect(SESSION_LIST_FIRST_PAGE_LIMIT).toBe(20);
    expect(merged).toEqual([
      { id: 'a', status: 'done' },
      { id: 'b', status: 'paused' },
      { id: 'c', status: 'running' },
    ]);
    expect(merged[2]).toBe(current[2]);
  });

  it('returns the same array reference when nothing changed', () => {
    const current = [{ id: 'a', status: 'done' }];
    const merged = mergeSessionListFirstPage({
      current,
      firstPage: [{ id: 'a', status: 'done' }],
      mergeItem: (prev, next) => (prev.status === next.status ? prev : { ...prev, status: next.status }),
    });
    expect(merged).toBe(current);
  });
});
