import type { CreatedBySubject, SessionMetadata, SessionSource } from '@truefoundry/trueforge-core/agent-session';
import type { ISessionStore } from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';

const TENANT = 'default';
const USER_SUBJECT: CreatedBySubject = {
  subject_id: 'user-1',
  subject_type: 'user',
  subject_display_name: 'user-1',
};

/** Shared cases for the `tfy.source` backfill; each backend supplies its store and `up`. */
export function runSessionTfySourceBackfillSuite(deps: {
  getStore: () => ISessionStore;
  runUp: () => Promise<void>;
}): void {
  async function seed(input: {
    session_id: string;
    metadata: SessionMetadata;
    external_id: string | null;
    source: SessionSource | null;
  }): Promise<void> {
    await deps.getStore().createSession({
      tenant_id: TENANT,
      created_by_subject: USER_SUBJECT,
      agent: { type: 'reference', id: 'agent-abc', name: null },
      custom: null,
      ...input,
    });
  }

  async function metadataOf(sessionId: string): Promise<SessionMetadata | undefined> {
    const session = await deps.getStore().getSession({ tenant_id: TENANT, session_id: sessionId });
    return session?.metadata;
  }

  it('stamps interactive sessions and preserves their existing metadata', async () => {
    await seed({ session_id: 'chat', metadata: {}, external_id: null, source: null });
    await seed({
      session_id: 'builder',
      metadata: { is_create_agent: 'true' },
      external_id: null,
      source: null,
    });

    await deps.runUp();

    expect(await metadataOf('chat')).toEqual({ 'tfy.source': 'ui' });
    expect(await metadataOf('builder')).toEqual({ is_create_agent: 'true', 'tfy.source': 'ui' });
  });

  it('leaves schedule runs untouched, including ones created before source existed', async () => {
    await seed({
      session_id: 'scheduled',
      metadata: {},
      external_id: 'run-1',
      source: { type: 'schedule', id: 'schedule-1', run_id: 'run-1' },
    });
    await seed({ session_id: 'legacy-scheduled', metadata: {}, external_id: 'run-0', source: null });

    await deps.runUp();

    expect(await metadataOf('scheduled')).toEqual({});
    expect(await metadataOf('legacy-scheduled')).toEqual({});
  });

  it('does not overwrite an existing tfy.source value', async () => {
    await seed({ session_id: 'stamped', metadata: { 'tfy.source': 'other' }, external_id: null, source: null });

    await deps.runUp();

    expect(await metadataOf('stamped')).toEqual({ 'tfy.source': 'other' });
  });

  it('does not change updated_at', async () => {
    await seed({ session_id: 'ordered', metadata: {}, external_id: null, source: null });
    const before = await deps.getStore().getSession({ tenant_id: TENANT, session_id: 'ordered' });

    await deps.runUp();

    const after = await deps.getStore().getSession({ tenant_id: TENANT, session_id: 'ordered' });
    expect(after?.updated_at).toEqual(before?.updated_at);
  });
}
