/** Session access grant wire schemas. */
import { z } from '@hono/zod-openapi';
import { CreatedBySubjectSchema } from '@truefoundry/trueforge-core/agent-session';

const SESSION_ACCESS_MAX_SUBJECTS_PER_REQUEST = 100;

export const SessionAccessSubjectTypeSchema = z
  .enum(['user'])
  .describe('Kind of subject the session is shared with.')
  .openapi('SessionAccessSubjectType');

export const SessionAccessSubjectSchema = z
  .object({
    subject_type: SessionAccessSubjectTypeSchema,
    subject_id: z.string().min(1).max(255).describe('Subject identifier, as returned by `GET /api/v1/users`.'),
  })
  .strict()
  .openapi('SessionAccessSubject');

export const SessionAccessGrantSchema = z
  .object({
    subject_type: SessionAccessSubjectTypeSchema,
    subject_id: z.string().describe('Subject identifier.'),
    subject_display_name: z
      .string()
      .nullable()
      .describe('Display name of the subject; null when the subject can no longer be resolved.'),
    subject_email: z
      .string()
      .nullable()
      .describe('Email of the subject; null when unknown or the subject can no longer be resolved.'),
    granted_by_subject: CreatedBySubjectSchema,
    created_at: z.string().describe('When access was granted (ISO-8601 UTC).'),
  })
  .strict()
  .openapi('SessionAccessGrant');

export const ListSessionAccessResponseSchema = z
  .object({ data: z.array(SessionAccessGrantSchema) })
  .openapi('ListSessionAccessResponse');

export const CreateSessionAccessRequestSchema = z
  .object({
    subjects: z
      .array(SessionAccessSubjectSchema)
      .min(1)
      .max(SESSION_ACCESS_MAX_SUBJECTS_PER_REQUEST)
      .describe(`Subjects to share the session with (1–${String(SESSION_ACCESS_MAX_SUBJECTS_PER_REQUEST)}).`),
  })
  .strict()
  .openapi('CreateSessionAccessRequest');

export const DeleteSessionAccessResponseSchema = z.object({}).strict().openapi('DeleteSessionAccessResponse');

export type SessionAccessSubjectType = z.infer<typeof SessionAccessSubjectTypeSchema>;
export type SessionAccessSubject = z.infer<typeof SessionAccessSubjectSchema>;
export type SessionAccessGrant = z.infer<typeof SessionAccessGrantSchema>;
