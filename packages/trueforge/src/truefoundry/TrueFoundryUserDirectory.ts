import type { GetDirectoryUsersByIdsInput, ListDirectoryUsersInput, UserDirectory } from '../auth/userDirectory';
import type { DirectoryUser } from '../schemas/user';
import { requireUserCredential } from './accessToken';
import type { SfyPeekUser, TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

/** Ids travel in the `filter` query param; chunk so the URL stays well under server header limits. */
const PEEK_IDS_CHUNK_SIZE = 50;

function toDirectoryUser(user: SfyPeekUser): DirectoryUser {
  return {
    id: user.id,
    display_name: user.name ?? user.email ?? user.id,
    email: user.email ?? null,
  };
}

/** Tenant users from ServiceFoundry, looked up with the caller's token. */
export class TrueFoundryUserDirectory implements UserDirectory {
  readonly #client: Pick<TrueFoundryServiceFoundryServerClient, 'peekUsers'>;

  constructor(client: Pick<TrueFoundryServiceFoundryServerClient, 'peekUsers'>) {
    this.#client = client;
  }

  async listUsers(input: ListDirectoryUsersInput): Promise<{ data: DirectoryUser[]; total: number }> {
    const { users, totalUsers } = await this.#client.peekUsers({
      accessToken: requireUserCredential(input.context),
      ...(input.query === undefined ? {} : { name: input.query }),
      limit: input.limit,
      offset: input.offset,
    });
    return { data: users.map(toDirectoryUser), total: totalUsers };
  }

  async getUsersByIds(input: GetDirectoryUsersByIdsInput): Promise<DirectoryUser[]> {
    const ids = [...new Set(input.ids)];
    if (ids.length === 0) {
      return [];
    }
    const accessToken = requireUserCredential(input.context);
    const found: DirectoryUser[] = [];
    for (let i = 0; i < ids.length; i += PEEK_IDS_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + PEEK_IDS_CHUNK_SIZE);
      const { users } = await this.#client.peekUsers({ accessToken, ids: chunk, limit: chunk.length, offset: 0 });
      found.push(...users.map(toDirectoryUser));
    }
    return found;
  }
}
