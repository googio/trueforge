import { sql, type Kysely } from 'kysely';
import { SESSION_TFG_SOURCE_UI_LIST_IDX } from '../../indexes';

/**
 * Chat History lists a caller's `tfg.source = ui` sessions in `(updated_at, session_id)` keyset
 * order. The planner only uses this partial index when the query's metadata filter is exactly
 * `{"tfg.source": "ui"}`; extra filter keys fall back to the GIN index.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    CREATE INDEX ${sql.raw(SESSION_TFG_SOURCE_UI_LIST_IDX)}
      ON session (tenant_id, (created_by_subject->>'subject_id'), updated_at, session_id)
      WHERE metadata @> '{"tfg.source": "ui"}'::jsonb
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_TFG_SOURCE_UI_LIST_IDX)}`.execute(db);
}
