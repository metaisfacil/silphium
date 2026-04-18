import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    noteSlowBackgroundBridgeCall,
    resetBridgeLoadGateForTests,
    runBackgroundBridgeCall,
    runInteractiveBridgeCall,
    shouldDeferBackgroundBridgeCall,
} from './bridge-load-gate';

describe('bridge-load-gate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetBridgeLoadGateForTests();
    });

    afterEach(() => {
        resetBridgeLoadGateForTests();
        vi.useRealTimers();
    });

    it('waits for interactive bridge work before running a background call', async () => {
        let releaseInteractive!: () => void;
        const interactivePromise = runInteractiveBridgeCall(async () => {
            await new Promise<void>((resolve) => {
                releaseInteractive = resolve;
            });
        });

        let ranBackgroundCall = false;
        const backgroundPromise = runBackgroundBridgeCall(async () => {
            ranBackgroundCall = true;
            return 'background-result';
        }, { maxWaitMs: 250 });

        await vi.advanceTimersByTimeAsync(64);
        expect(ranBackgroundCall).toBe(false);

        releaseInteractive();
        await interactivePromise;
        await vi.advanceTimersByTimeAsync(200);

        await expect(backgroundPromise).resolves.toBe('background-result');
        expect(ranBackgroundCall).toBe(true);
    });

    it('uses the timeout fallback when background work stays blocked', async () => {
        void runInteractiveBridgeCall(async () => {
            await new Promise<void>(() => undefined);
        });

        const callback = vi.fn(async () => 'callback-result');
        const timeoutFallback = vi.fn(() => 'timeout-result');

        const resultPromise = runBackgroundBridgeCall(callback, {
            maxWaitMs: 50,
            onTimeout: timeoutFallback,
        });

        await vi.advanceTimersByTimeAsync(60);

        await expect(resultPromise).resolves.toBe('timeout-result');
        expect(callback).not.toHaveBeenCalled();
        expect(timeoutFallback).toHaveBeenCalledTimes(1);
    });

    it('defers background work during the slow-bridge cooldown window', async () => {
        expect(shouldDeferBackgroundBridgeCall()).toBe(false);

        noteSlowBackgroundBridgeCall(120);
        expect(shouldDeferBackgroundBridgeCall()).toBe(true);

        await vi.advanceTimersByTimeAsync(121);
        expect(shouldDeferBackgroundBridgeCall()).toBe(false);
    });
});