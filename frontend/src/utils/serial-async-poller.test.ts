import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSerialAsyncPoller } from './serial-async-poller';

describe('createSerialAsyncPoller', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('does not overlap async runs when the work exceeds the interval', async () => {
        let resolveRun: (() => void) | undefined;
        const run = vi.fn(() => new Promise<void>((resolve) => {
            resolveRun = resolve;
        }));

        const poller = createSerialAsyncPoller({
            run,
            getDelayMs: () => 250,
        });

        poller.start();
        await vi.advanceTimersByTimeAsync(250);
        expect(run).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(2000);
        expect(run).toHaveBeenCalledTimes(1);

        resolveRun?.();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(249);
        expect(run).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('supports unscheduled idle states until explicitly poked', async () => {
        let enabled = false;
        const run = vi.fn();

        const poller = createSerialAsyncPoller({
            run,
            getDelayMs: () => (enabled ? 250 : null),
        });

        poller.start();
        await vi.advanceTimersByTimeAsync(2000);
        expect(run).not.toHaveBeenCalled();

        enabled = true;
        poller.poke();
        await vi.advanceTimersByTimeAsync(249);
        expect(run).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(run).toHaveBeenCalledTimes(1);
    });
});