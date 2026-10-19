/**
 * Control loop: list stale running turns and close them over HTTP (batch per tick).
 */
import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { Logger } from 'winston';
import configuration from '../config';
import { captureCriticalException } from '../sentry';
import type { ControlLoop } from './Controller';
import { internalTrueForgeClient } from './internalTrueForgeClient';

const ZOMBIE_TURN_CLOSER_LOOP_NAME = 'zombie-turn-closer';

export async function dispatchZombieTurns({ logger }: { logger: Logger }): Promise<void> {
  const zombies = await internalTrueForgeClient.listZombieTurns();
  const batch = zombies.slice(0, configuration.ZOMBIE_TURN_CLOSE_BATCH);
  logger.debug('Zombie turn closer tick', {
    zombie_count: zombies.length,
    close_batch: batch.length,
  });
  for (const zombie of batch) {
    logger.debug('Closing zombie turn', {
      tenant_id: zombie.tenantId,
      session_id: zombie.sessionId,
      turn_id: zombie.turnId,
    });
    try {
      await internalTrueForgeClient.closeZombieTurn(zombie);
      logger.debug('Zombie turn closed', {
        tenant_id: zombie.tenantId,
        session_id: zombie.sessionId,
        turn_id: zombie.turnId,
      });
    } catch (error) {
      if (error instanceof TrueForgeApi.NotFoundError) {
        logger.warn('Zombie turn session not found; skipping', {
          tenant_id: zombie.tenantId,
          session_id: zombie.sessionId,
          turn_id: zombie.turnId,
        });
        captureCriticalException(error, {
          tags: { module: 'zombieTurnCloser', operation: 'closeNotFound' },
          extra: {
            tenant_id: zombie.tenantId,
            session_id: zombie.sessionId,
            turn_id: zombie.turnId,
          },
        });
        continue;
      }
      logger.error('Zombie turn close failed', {
        tenant_id: zombie.tenantId,
        session_id: zombie.sessionId,
        turn_id: zombie.turnId,
        error: error instanceof Error ? error.message : String(error),
      });
      captureCriticalException(error, {
        tags: { module: 'zombieTurnCloser', operation: 'close' },
        extra: {
          tenant_id: zombie.tenantId,
          session_id: zombie.sessionId,
          turn_id: zombie.turnId,
        },
      });
    }
  }
}

export function zombieTurnCloserLoop(params: { logger: Logger }): ControlLoop {
  return {
    name: ZOMBIE_TURN_CLOSER_LOOP_NAME,
    intervalMs: configuration.ZOMBIE_TURN_CLOSER_INTERVAL_MS,
    async tick(signal) {
      if (signal.aborted) {
        return;
      }
      await dispatchZombieTurns({ logger: params.logger });
    },
  };
}
