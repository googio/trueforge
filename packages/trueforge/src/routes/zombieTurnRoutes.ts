/**
 * Internal zombie-turn closer routes (API-key auth).
 * Mounted at /api/internal/turns.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { CloseZombieTurnRequestSchema, ListZombieTurnsResponseSchema } from '../schemas/zombieTurn';
import { OpenApiTag } from './openapiTags';

export const listZombieTurnsRoute = createRoute({
  method: 'get',
  path: '/zombie',
  tags: [OpenApiTag.INTERNAL],
  summary: 'List stale running turns',
  description: 'Returns all running turns whose last activity is past the stale threshold.',
  'x-fern-sdk-group-name': ['internal', 'turns'],
  'x-fern-sdk-method-name': 'list_zombie',
  'x-excluded': true,
  responses: {
    200: {
      content: { 'application/json': { schema: ListZombieTurnsResponseSchema } },
      description: 'Stale running turns oldest-first.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid service credential.',
    },
  },
});

export const closeZombieTurnRoute = createRoute({
  method: 'post',
  path: '/close-zombie',
  tags: [OpenApiTag.INTERNAL],
  summary: 'Close a stale running turn',
  description: 'Cancels a zombie turn (turn.done with abandoned reason).',
  'x-fern-sdk-group-name': ['internal', 'turns'],
  'x-fern-sdk-method-name': 'close_zombie',
  'x-excluded': true,
  request: {
    body: {
      content: { 'application/json': { schema: CloseZombieTurnRequestSchema } },
      required: true,
    },
  },
  responses: {
    204: { description: 'Closed (or already terminal / missing turn).' },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid service credential.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session not found.',
    },
  },
});
