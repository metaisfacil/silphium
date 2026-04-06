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

    it('logs each queued MusicBrainz request', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const { scheduleMusicBrainzRequest } = await loadScheduler();

        await expect(scheduleMusicBrainzRequest(async () => 'first', {
            server: 'https://musicbrainz.org',
            path: '/ws/2/recording/abc?fmt=json&inc=artists+releases',
        })).resolves.toBe('first');
        const secondRequest = scheduleMusicBrainzRequest(async () => 'second');
        await vi.advanceTimersByTimeAsync(1000);
        await expect(secondRequest).resolves.toBe('second');

        expect(infoSpy).toHaveBeenCalledTimes(2);
        expect(infoSpy.mock.calls[0]?.[0]).toContain('[MBZ] network request:');
        expect(infoSpy.mock.calls[0]?.[0]).toContain('server=https://musicbrainz.org');
        expect(infoSpy.mock.calls[0]?.[0]).toContain('path=/ws/2/recording/abc?fmt=json&inc=artists+releases');
        expect(infoSpy.mock.calls[1]?.[0]).toContain('[MBZ] network request:');
    });
});

describe('scheduleListenBrainzRequest', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does not queue requests when no override is set', async () => {
        const { scheduleListenBrainzRequest } = await loadScheduler();
        const callOrder: string[] = [];
        let resolveFirstRequest!: (value: string) => void;

        const firstRequest = scheduleListenBrainzRequest(async () => {
            callOrder.push('first');
            return await new Promise<string>((resolve) => {
                resolveFirstRequest = resolve;
            });
        });
        const secondRequest = scheduleListenBrainzRequest(async () => {
            callOrder.push('second');
            return 'second';
        });

        await Promise.resolve();
        expect(callOrder).toEqual(['first', 'second']);

        resolveFirstRequest('first');
        await expect(firstRequest).resolves.toBe('first');
        await expect(secondRequest).resolves.toBe('second');
    });

    it('logs each ListenBrainz request in direct mode', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const { scheduleListenBrainzRequest } = await loadScheduler();

        await expect(scheduleListenBrainzRequest(async () => 'first', {
            server: 'https://api.listenbrainz.org',
            path: '/1/submit-listens',
        })).resolves.toBe('first');
        await expect(scheduleListenBrainzRequest(async () => 'second')).resolves.toBe('second');

        expect(infoSpy).toHaveBeenCalledTimes(2);
        expect(infoSpy.mock.calls[0]?.[0]).toContain('[LBZ] network request:');
        expect(infoSpy.mock.calls[0]?.[0]).toContain('server=https://api.listenbrainz.org');
        expect(infoSpy.mock.calls[0]?.[0]).toContain('path=/1/submit-listens');
        expect(infoSpy.mock.calls[1]?.[0]).toContain('[LBZ] network request:');
    });
});