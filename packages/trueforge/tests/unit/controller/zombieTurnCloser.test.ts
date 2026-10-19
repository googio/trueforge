import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import configuration from '../../../src/config';
import { internalTrueForgeClient } from '../../../src/controller/internalTrueForgeClient';
import { dispatchZombieTurns, zombieTurnCloserLoop } from '../../../src/controller/zombieTurnCloser';

function fakeLogger() {
  return { error: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
}

function zombie(n: number): { tenantId: string; sessionId: string; turnId: string } {
  return { tenantId: 't1', sessionId: `s-${String(n)}`, turnId: `turn-${String(n)}` };
}

describe('zombieTurnCloserLoop', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('closes each zombie from the internal API up to the batch limit', async () => {
    const batch = configuration.ZOMBIE_TURN_CLOSE_BATCH;
    const all = Array.from({ length: batch + 5 }, (_, i) => zombie(i));
    jest.spyOn(internalTrueForgeClient, 'listZombieTurns').mockResolvedValue(all);
    const close = jest.spyOn(internalTrueForgeClient, 'closeZombieTurn').mockResolvedValue(undefined);

    const logger = fakeLogger();
    const loop = zombieTurnCloserLoop({ logger: logger as never });
    await loop.tick(new AbortController().signal);

    expect(close).toHaveBeenCalledTimes(batch);
    expect(close).toHaveBeenNthCalledWith(1, zombie(0));
    expect(close).toHaveBeenNthCalledWith(batch, zombie(batch - 1));
  });

  it('skips NotFoundError and continues the tick', async () => {
    jest.spyOn(internalTrueForgeClient, 'listZombieTurns').mockResolvedValue([zombie(1), zombie(2)]);
    const close = jest.spyOn(internalTrueForgeClient, 'closeZombieTurn').mockImplementation(async input => {
      if (input.turnId === 'turn-1') {
        throw new TrueForgeApi.NotFoundError({ error: { message: 'not found' } });
      }
    });
    const logger = fakeLogger();

    await dispatchZombieTurns({ logger: logger as never });

    expect(close).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not tick when aborted', async () => {
    const list = jest.spyOn(internalTrueForgeClient, 'listZombieTurns');
    const controller = new AbortController();
    controller.abort();
    const loop = zombieTurnCloserLoop({ logger: fakeLogger() as never });
    await loop.tick(controller.signal);
    expect(list).not.toHaveBeenCalled();
  });
});
