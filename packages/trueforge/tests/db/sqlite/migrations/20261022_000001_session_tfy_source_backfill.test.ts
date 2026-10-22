import { up } from '../../../../src/db/sqlite/migrations/20261022_000001_session_tfy_source_backfill';
import { SqliteSessionStore } from '../../../../src/db/sqlite/session-store/SqliteSessionStore';
import { runSessionTfySourceBackfillSuite } from '../../sessionTfySourceBackfillSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SQLite session tfy.source backfill migration', () => {
  let env: SqliteTestDatabase | undefined;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  function requireEnv(): SqliteTestDatabase {
    if (env === undefined) {
      throw new Error('SQLite test environment not initialized');
    }
    return env;
  }

  runSessionTfySourceBackfillSuite({
    getStore: () => new SqliteSessionStore(requireEnv().db),
    runUp: () => up(requireEnv().db),
  });
});
