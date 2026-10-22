import type { TurnStatus } from '../../server/types.js';

/** Matches thread-list / AgentSessions first-page `limit`. */
export const SESSION_LIST_FIRST_PAGE_LIMIT = 20;

/** Same cadence as pending sandbox environment polls. */
export const SESSION_LIST_POLL_INTERVAL_MS = 10_000;

/** Rolling window start for sidebar history polls (mirrors thread-list adapters). */
export function sessionListPollStartTimestamp(): string {
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  return start.toISOString();
}

/** Statuses that still need live updates from the list API. */
export function isNonTerminalTurnStatus(status: TurnStatus | undefined | null): boolean {
  return status === 'running' || status === 'paused';
}

/**
 * Patch items that appear on a first-page poll into the full loaded list by id.
 * Later pages from load-more are left in place; unknown first-page ids are ignored.
 */
export function mergeSessionListFirstPage<T extends { id: string }>({
  current,
  firstPage,
  mergeItem,
}: {
  current: T[];
  firstPage: readonly T[];
  mergeItem: (prev: T, next: T) => T;
}): T[] {
  if (firstPage.length === 0) return current;
  const byId = new Map(firstPage.map(item => [item.id, item] as const));
  let changed = false;
  const next = current.map(item => {
    const pageItem = byId.get(item.id);
    if (pageItem == null) return item;
    const merged = mergeItem(item, pageItem);
    if (merged !== item) changed = true;
    return merged;
  });
  return changed ? next : current;
}
