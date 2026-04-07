import { describe, expect, it } from 'vitest';

import { createAppState } from './app-state';
import { defaultAppSettings, defaultMusicBrainzTagWorkerProgress } from './utils/settings-normalization';

describe('createAppState', () => {
    it('creates isolated default state containers', async () => {
        const first = createAppState();
        const second = createAppState();

        expect(first.tracks).toEqual([]);
        expect(first.textFiles).toEqual([]);
        expect(first.imageFiles).toEqual([]);
        expect(first.currentTrackIndex).toBe(-1);
        expect(first.currentSettings).toEqual(defaultAppSettings);
        expect(first.currentSettings).not.toBe(defaultAppSettings);
        expect(first.currentMusicBrainzTagWorkerProgress).toEqual(defaultMusicBrainzTagWorkerProgress);
        expect(first.currentMusicBrainzTagWorkerProgress).not.toBe(defaultMusicBrainzTagWorkerProgress);
        expect(first.queueConfirmResolver).toBeNull();
        expect(first.hideToTrayRetryTimer).toBeUndefined();
        expect(first.settingsController).toBeUndefined();
        expect(first.playlistController).toBeUndefined();
        expect(first.libraryController).toBeUndefined();
        await expect(first.trackNavigationChain).resolves.toBeUndefined();

        first.trackIndexByPath.set('/music/test.flac', 1);
        first.currentSettings.libraryPath = '/music';
        first.currentMusicBrainzTagWorkerProgress.progress = 0.5;

        expect(second.trackIndexByPath.size).toBe(0);
        expect(second.currentSettings.libraryPath).toBe('');
        expect(second.currentMusicBrainzTagWorkerProgress.progress).toBe(0);
    });
});