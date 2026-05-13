import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../wailsjs/go/main/App', () => ({
    ReserveBridgeTraceRequestID: vi.fn(async () => 41),
}));

import { traceBridgeCall } from './bridge-trace';
import * as appBindings from '../../wailsjs/go/main/App';

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

        expect(vi.mocked(appBindings.ReserveBridgeTraceRequestID)).toHaveBeenCalledWith('transport', 'AudioPlay');
        expect(warnSpy).toHaveBeenCalledTimes(2);
        expect(warnSpy.mock.calls[0][0]).toContain('START requestId=41 path="/music/track.flac"');
        expect(warnSpy.mock.calls[1][0]).toContain('END requestId=41 bridgeElapsed=12.3ms result="ok"');
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
        expect(warnSpy.mock.calls[1][0]).toContain('ERROR requestId=41 bridgeElapsed=6.8ms error="backend unavailable"');
        expect(warnSpy.mock.calls[1][0]).not.toContain('ERROR elapsed=6.8ms');
    });
});