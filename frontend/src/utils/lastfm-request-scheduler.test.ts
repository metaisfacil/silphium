import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadScheduler = async () => {
    vi.resetModules();
    return import('./lastfm-request-scheduler');
};

describe('scheduleLastFmRequest', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does not queue requests in direct mode', async () => {
        const { scheduleLastFmRequest } = await loadScheduler();
        const callOrder: string[] = [];
        let resolveFirstRequest!: (value: string) => void;

        const firstRequest = scheduleLastFmRequest(async () => {
            callOrder.push('first');
            return await new Promise<string>((resolve) => {
                resolveFirstRequest = resolve;
            });
        });

        const secondRequest = scheduleLastFmRequest(async () => {
            callOrder.push('second');
            return 'second';
        });

        await Promise.resolve();
        expect(callOrder).toEqual(['first', 'second']);

        resolveFirstRequest('first');
        await expect(firstRequest).resolves.toBe('first');
        await expect(secondRequest).resolves.toBe('second');
    });

    it('logs Last.fm requests in direct mode', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const { scheduleLastFmRequest } = await loadScheduler();

        await expect(scheduleLastFmRequest(async () => 'first', {
            server: 'https://ws.audioscrobbler.com/2.0',
            path: 'track.scrobble',
        })).resolves.toBe('first');

        await expect(scheduleLastFmRequest(async () => 'second')).resolves.toBe('second');

        expect(infoSpy).toHaveBeenCalledTimes(2);
        expect(infoSpy.mock.calls[0]?.[0]).toContain('[LFM] network request:');
        expect(infoSpy.mock.calls[0]?.[0]).toContain('server=https://ws.audioscrobbler.com/2.0');
        expect(infoSpy.mock.calls[0]?.[0]).toContain('path=track.scrobble');
        expect(infoSpy.mock.calls[1]?.[0]).toContain('[LFM] network request:');
    });
});
