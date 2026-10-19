/**
 * Wire schemas for internal zombie-turn closer endpoints.
 */
import { z } from '@hono/zod-openapi';

export const ZombieTurnSchema = z
  .object({
    tenant_id: z.string().min(1).describe('Tenant that owns the session.'),
    session_id: z.string().min(1).describe('Session that owns the turn.'),
    turn_id: z.string().min(1).describe('Running turn with stale last activity.'),
  })
  .strict()
  .openapi('ZombieTurn');

export const ListZombieTurnsResponseSchema = z
  .object({
    data: z.array(ZombieTurnSchema),
  })
  .strict()
  .openapi('ListZombieTurnsResponse');

export const CloseZombieTurnRequestSchema = z
  .object({
    tenant_id: z.string().min(1).describe('Tenant that owns the session.'),
    session_id: z.string().min(1).describe('Session that owns the turn.'),
    turn_id: z.string().min(1).describe('Turn to close.'),
  })
  .strict()
  .openapi('CloseZombieTurnRequest');
