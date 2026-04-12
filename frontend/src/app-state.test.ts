import { describe, expect, it } from 'vitest';

import { createAppState } from './app-state';
import { createPlaybackSequencingState } from './services/playback-sequencing-service';
import { createPlaybackSessionState } from './services/playback-state-service';
import { createScrobbleSessionState } from './services/scrobble-service';
import { createSettingsControllerState } from './controllers/settings-controller-types';
import { defaultAppSettings, defaultMusicBrainzTagWorkerProgress } from './utils/settings-normalization';

describe('createAppState', () => {
    it('creates isolated default state containers', async () => {
        const first = createAppState();
        const second = createAppState();

        expect(first.tracks).toEqual([]);
        expect(first.textFiles).toEqual([]);
        expect(first.imageFiles).toEqual([]);
        expect(first.currentTrackIndex).toBe(-1);
        expect(first.libraryControllerState).toEqual({
            sidebarOpen: false,
            libraryRootName: '',
            currentFolderPath: '',
            sidebarAutoFolderPath: '',
            libraryIndexTruncated: false,
            libraryLoading: false,
            libraryLoadingEtaSeconds: null,
            libraryLoadingStatusLabel: '',
            libraryBrowserSortMode: 'name',
            librarySearchQuery: '',
            librarySearchPending: false,
            activeSearchResult: null,
            expandedSearchFolders: new Set(),
        });
        expect(first.playlistControllerState).toEqual({
            loadedPlaylistTrackIndexes: null,
            loadedPlaylistName: '',
            loadedPlaylistPath: '',
            editableQueueTrackIndexes: null,
            selectedSource: 'queue',
            selectedFavoriteIndex: null,
            playbackSource: 'queue',
        });
        expect(first.settingsControllerState).toEqual(createSettingsControllerState());
        expect(first.playbackSequencingState).toEqual(createPlaybackSequencingState(defaultAppSettings.playbackOrder));
        expect(first.playbackSessionState).toEqual(createPlaybackSessionState());
        expect(first.scrobbleSessionState).toEqual(createScrobbleSessionState());
        expect(first.currentSettings).toEqual(defaultAppSettings);
        expect(first.currentSettings).not.toBe(defaultAppSettings);
        expect(first.currentMusicBrainzTagWorkerProgress).toEqual(defaultMusicBrainzTagWorkerProgress);
        expect(first.currentMusicBrainzTagWorkerProgress).not.toBe(defaultMusicBrainzTagWorkerProgress);
        expect(first.queueConfirmResolver).toBeNull();
        expect(first.hideToTrayRetryTimer).toBeUndefined();
        await expect(first.trackNavigationChain).resolves.toBeUndefined();

        first.trackIndexByPath.set('/music/test.flac', 1);
        first.libraryControllerState.libraryRootName = 'Library';
        first.playlistControllerState.loadedPlaylistName = 'demo.m3u8';
        first.settingsControllerState.favoritePlaylists.push('/playlists/demo.m3u8');
        first.playbackSequencingState.playbackOrderMode = 'shuffle-library';
        first.playbackSequencingState.shuffleHistory.push(3);
        first.playbackSessionState.backendReady = true;
        first.scrobbleSessionState.scrobbleSessionId = 4;
        first.scrobbleSessionState.activeSessionTrackKey = '/music/demo.flac';
        first.scrobbleSessionState.recentSinglesByProvider.lastFm.set('demo', 123);
        first.currentSettings.libraryPath = '/music';
        first.currentMusicBrainzTagWorkerProgress.progress = 0.5;

        expect(second.trackIndexByPath.size).toBe(0);
        expect(second.libraryControllerState.libraryRootName).toBe('');
        expect(second.playlistControllerState.loadedPlaylistName).toBe('');
        expect(second.settingsControllerState.favoritePlaylists).toEqual([]);
        expect(second.playbackSequencingState.playbackOrderMode).toBe(defaultAppSettings.playbackOrder);
        expect(second.playbackSequencingState.shuffleHistory).toEqual([]);
        expect(second.playbackSessionState.backendReady).toBe(false);
        expect(second.scrobbleSessionState.scrobbleSessionId).toBe(0);
        expect(second.scrobbleSessionState.activeSessionTrackKey).toBe('');
        expect(second.scrobbleSessionState.recentSinglesByProvider.lastFm.size).toBe(0);
        expect(second.currentSettings.libraryPath).toBe('');
        expect(second.currentMusicBrainzTagWorkerProgress.progress).toBe(0);
    });
});