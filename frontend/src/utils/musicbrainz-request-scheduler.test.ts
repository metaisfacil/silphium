import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadScheduler = async () => {
    vi.resetModules();
    return import('./musicbrainz-request-scheduler');
};

describe('scheduleMusicBrainzRequest', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('spaces queued requests one second apart', async () => {
        const { scheduleMusicBrainzRequest } = await loadScheduler();
        const callTimes: number[] = [];

        await expect(scheduleMusicBrainzRequest(async () => {
            callTimes.push(Date.now());
            return 'first';
        })).resolves.toBe('first');

        const secondRequest = scheduleMusicBrainzRequest(async () => {
            callTimes.push(Date.now());
            return 'second';
        });

        await Promise.resolve();
        expect(callTimes).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1000);
        await expect(secondRequest).resolves.toBe('second');

        expect(callTimes[1] - callTimes[0]).toBe(1000);
    });

    it('continues the queue after a rejected request', async () => {
        const { scheduleMusicBrainzRequest } = await loadScheduler();

        await expect(scheduleMusicBrainzRequest(async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');

        const secondRequest = scheduleMusicBrainzRequest(async () => 'recovered');
        await vi.advanceTimersByTimeAsync(1000);

        await expect(secondRequest).resolves.toBe('recovered');
    });
});