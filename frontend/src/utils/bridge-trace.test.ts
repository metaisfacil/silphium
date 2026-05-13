import { afterEach, describe, expect, it, vi } from 'vitest';

import { traceBridgeCall } from './bridge-trace';

describe('traceBridgeCall', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('labels successful round-trip timing as bridgeElapsed', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(performance, 'now')
            .mockReturnValueOnce(10)
            .mockReturnValueOnce(22.34);

        await expect(traceBridgeCall('transport', 'AudioPlay', async () => 'ok', {
            details: { path: '/music/track.flac' },
            summarizeResult: (result) => ({ result }),
        })).resolves.toBe('ok');

        expect(warnSpy).toHaveBeenCalledTimes(2);
        expect(warnSpy.mock.calls[0][0]).toContain('START path="/music/track.flac"');
        expect(warnSpy.mock.calls[1][0]).toContain('END bridgeElapsed=12.3ms result="ok"');
        expect(warnSpy.mock.calls[1][0]).not.toContain('END elapsed=12.3ms');
    });

    it('labels failed round-trip timing as bridgeElapsed', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(performance, 'now')
            .mockReturnValueOnce(25)
            .mockReturnValueOnce(31.78);

        await expect(traceBridgeCall('library', 'SearchLibrary', async () => {
            throw new Error('backend unavailable');
        })).rejects.toThrow('backend unavailable');

        expect(warnSpy).toHaveBeenCalledTimes(2);
        expect(warnSpy.mock.calls[1][0]).toContain('ERROR bridgeElapsed=6.8ms error="backend unavailable"');
        expect(warnSpy.mock.calls[1][0]).not.toContain('ERROR elapsed=6.8ms');
    });
});