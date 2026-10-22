import { up } from '../../../../src/db/postgres/migrations/20261022_000001_session_tfy_source_backfill';
import { PostgresSessionStore } from '../../../../src/db/postgres/session-store/PostgresSessionStore';
import { runSessionTfySourceBackfillSuite } from '../../sessionTfySourceBackfillSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const PREVIOUS_MIGRATION = '20261018_000001_session_last_turn_details';

describePg('Postgres session tfy.source backfill migration', () => {
  let env: PostgresTestDatabase | undefined;

  beforeEach(async () => {
    env = await createPostgresTestDatabase(PREVIOUS_MIGRATION);
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  function requireEnv(): PostgresTestDatabase {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return env;
  }

  runSessionTfySourceBackfillSuite({
    getStore: () => new PostgresSessionStore(requireEnv().db),
    runUp: () =>
      requireEnv()
        .db.transaction()
        .execute(trx => up(trx)),
  });
});
