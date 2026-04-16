import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMediaSessionController } from './media-session-controller';
import type { AudioPlaybackState } from '../types/app-types';

class FakeAudio {
    paused = true;
    currentTime = 0;
    loop = false;
    muted = false;
    volume = 1;
    preload = 'auto';
    src = '';

    constructor(src = '') {
        this.src = src;
    }

    async play(): Promise<void> {
        this.paused = false;
    }

    pause(): void {
        this.paused = true;
    }

    removeAttribute(name: string): void {
        void name;
    }

    load(): void {
        this.currentTime = 0;
    }
}

describe('createMediaSessionController', () => {
    const originalAudio = globalThis.Audio;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const originalMediaSession = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;

    beforeEach(() => {
        vi.stubGlobal('Audio', FakeAudio);
        URL.createObjectURL = vi.fn(() => 'blob:test-media-session');
        URL.revokeObjectURL = vi.fn();
        Object.defineProperty(navigator, 'mediaSession', {
            configurable: true,
            value: {
                metadata: null,
                playbackState: 'none',
                setActionHandler: vi.fn(),
                setPositionState: vi.fn(),
            } satisfies Pick<MediaSession, 'metadata' | 'playbackState' | 'setActionHandler' | 'setPositionState'>,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
        if (originalMediaSession === undefined) {
            Reflect.deleteProperty(navigator as object, 'mediaSession');
        } else {
            Object.defineProperty(navigator, 'mediaSession', {
                configurable: true,
                value: originalMediaSession,
            });
        }
        if (originalAudio) {
            globalThis.Audio = originalAudio;
        }
    });

    it('throttles repeated media session position updates within the same second', () => {
        let playbackState: AudioPlaybackState = {
            loaded: true,
            playing: true,
            currentTime: 12.1,
            duration: 300,
            volume: 0.8,
            sourcePath: '/music/track.flac',
            endEventId: 0,
        };

        const controller = createMediaSessionController({
            getPlaybackState: () => playbackState,
            getCurrentTrack: () => undefined,
            getCachedArtwork: () => undefined,
            getCoverArtPreview: () => ({ visible: false, src: '' }),
            playCurrentTrack: async () => undefined,
            pauseCurrentTrack: async () => undefined,
            toggleCurrentTrack: async () => undefined,
            goToTrack: () => undefined,
            stopCurrentTrack: async () => undefined,
            seekToTime: async () => undefined,
        });

        const mediaSession = (navigator as Navigator & {
            mediaSession: Pick<MediaSession, 'setPositionState'> & { setPositionState: ReturnType<typeof vi.fn> };
        }).mediaSession;

        controller.updatePositionState();
        playbackState = { ...playbackState, currentTime: 12.4 };
        controller.updatePositionState();
        playbackState = { ...playbackState, currentTime: 12.9 };
        controller.updatePositionState();

        expect(mediaSession.setPositionState).toHaveBeenCalledTimes(1);

        playbackState = { ...playbackState, currentTime: 13.0 };
        controller.updatePositionState();

        expect(mediaSession.setPositionState).toHaveBeenCalledTimes(2);
    });
});