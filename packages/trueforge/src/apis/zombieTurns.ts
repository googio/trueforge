/**
 * Internal API for the zombie-turn closer controller.
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { CancellationReason, type ISessionStore, type Sessions } from '@truefoundry/trueforge-core/agent-session';
import type { RedisClient } from '@truefoundry/trueforge-core/request-reply';
import type { Logger } from 'winston';
import configuration from '../config';
import { closeZombieTurnRoute, listZombieTurnsRoute } from '../routes/zombieTurnRoutes';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';
import { cancelSessionTurn } from './sessions';

export interface ZombieTurnsRouterDeps {
  sessionStore: ISessionStore;
  sessions: Sessions;
  activeTurns: ActiveTurnRegistry;
  redis?: RedisClient | undefined;
  logger: Logger;
}

export function createZombieTurnsRouter(deps: ZombieTurnsRouterDeps) {
  const listHandler: RouteHandler<typeof listZombieTurnsRoute> = async c => {
    const olderThan = new Date(Date.now() - configuration.ZOMBIE_TURN_STALE_MS);
    const stale = await deps.sessionStore.listStaleRunningTurns({ older_than: olderThan });
    return c.json(
      {
        data: stale.map(row => ({
          tenant_id: row.tenant_id,
          session_id: row.session_id,
          turn_id: row.turn_id,
        })),
      },
      200,
    );
  };

  const closeHandler: RouteHandler<typeof closeZombieTurnRoute> = async c => {
    const body = c.req.valid('json');
    const session = await deps.sessions.get({
      tenant_id: body.tenant_id,
      session_id: body.session_id,
    });
    if (!session) {
      return c.json({ error: { message: `Session not found: ${body.session_id}` } }, 404);
    }
    await cancelSessionTurn(
      {
        activeTurns: deps.activeTurns,
        session,
        sessionStore: deps.sessionStore,
        redis: deps.redis,
        logger: deps.logger,
      },
      { turnId: body.turn_id, reason: CancellationReason.Abandoned },
    );
    return c.body(null, 204);
  };

  const router = new OpenAPIHono();
  router.openapi(listZombieTurnsRoute, listHandler);
  router.openapi(closeZombieTurnRoute, closeHandler);
  return router;
}
