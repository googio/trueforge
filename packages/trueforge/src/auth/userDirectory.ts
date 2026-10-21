import type { DirectoryUser } from '../schemas/user';
import type { RequestContext } from './identity';

export interface ListDirectoryUsersInput {
  context: RequestContext;
  /** Case-insensitive substring on email or display name. */
  query: string | undefined;
  limit: number;
  offset: number;
}

export interface GetDirectoryUsersByIdsInput {
  context: RequestContext;
  ids: readonly string[];
}

/** Tenant users that sessions can be shared with. */
export interface UserDirectory {
  /** Searches first, then paginates; `total` counts all matches. */
  listUsers(input: ListDirectoryUsersInput): Promise<{ data: DirectoryUser[]; total: number }>;
  /** Active users among `ids`; unknown or inactive ids are absent. */
  getUsersByIds(input: GetDirectoryUsersByIdsInput): Promise<DirectoryUser[]>;
}

/** Standalone and OIDC have no directory, so user sharing is unavailable. */
export class EmptyUserDirectory implements UserDirectory {
  listUsers(): Promise<{ data: DirectoryUser[]; total: number }> {
    return Promise.resolve({ data: [], total: 0 });
  }

  getUsersByIds(): Promise<DirectoryUser[]> {
    return Promise.resolve([]);
  }
}
