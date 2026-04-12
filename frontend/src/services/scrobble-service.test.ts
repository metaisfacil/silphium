import { describe, expect, it, vi } from 'vitest';

import type { AudioPlaybackState, Track } from '../types/app-types';
import { createScrobbleService, createScrobbleSessionState } from './scrobble-service';

const createTrack = (overrides: Partial<Track> = {}): Track => ({
    title: 'Fallback Title',
    name: 'Fallback Title',
    path: '/music/artist/album/fallback.flac',
    relativePath: 'artist/album/fallback.flac',
    folderPath: 'Library/Artist/Album',
    rootPath: '/music',
    rootName: 'Library',
    displayTitle: 'Resolved Title',
    displayAlbum: 'Resolved Album',
    displayArtist: 'Resolved Artist',
    displayTrackNumber: '',
    displayTrackTotal: '',
    displayTechnical: '',
    displayLyrics: '',
    tagsResolved: true,
    mbMetadataResolved: false,
    technicalDetails: {},
    allFileTags: {},
    mbIds: {},
    artistMbids: [],
    mbArtistCredits: [],
    ...overrides,
});

const createPlaybackState = (overrides: Partial<AudioPlaybackState> = {}): AudioPlaybackState => ({
    loaded: true,
    playing: true,
    currentTime: 200,
    duration: 300,
    volume: 1,
    sourcePath: '/music/artist/album/fallback.flac',
    endEventId: 0,
    ...overrides,
});

describe('createScrobbleService', () => {
    it('does not submit now-playing or scrobble events until tags are resolved', () => {
        const submitListenBrainz = vi.fn(async () => undefined);
        const service = createScrobbleService({ submitListenBrainz });
        service.startTrackSession();

        const state = createPlaybackState();
        const unresolvedTrack = createTrack({
            displayArtist: 'Unknown Artist',
            tagsResolved: false,
        });

        service.maybeSubmit(state, unresolvedTrack, { listenBrainz: true, lastFm: false });

        expect(submitListenBrainz).not.toHaveBeenCalled();

        const resolvedTrack = createTrack({ tagsResolved: true });
        service.maybeSubmit(state, resolvedTrack, { listenBrainz: true, lastFm: false });

        expect(submitListenBrainz).toHaveBeenCalledTimes(2);
        expect(submitListenBrainz).toHaveBeenNthCalledWith(
            1,
            'playing_now',
            expect.objectContaining({ artistName: 'Resolved Artist' }),
            0,
        );
        expect(submitListenBrainz).toHaveBeenNthCalledWith(
            2,
            'single',
            expect.objectContaining({ artistName: 'Resolved Artist' }),
            expect.any(Number),
        );
    });

    it('tracks submission state independently per provider', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const submitListenBrainz = vi.fn(async () => undefined);
        let lastFmAttemptCount = 0;
        const submitLastFm = vi.fn(async () => {
            lastFmAttemptCount += 1;
            if (lastFmAttemptCount === 1) {
                throw new Error('temporary failure');
            }
        });

        const service = createScrobbleService({ submitListenBrainz, submitLastFm });
        service.startTrackSession();

        const state = createPlaybackState({ currentTime: 1 });
        const track = createTrack();

        service.maybeSubmit(state, track, { listenBrainz: true, lastFm: true });
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        service.maybeSubmit(state, track, { listenBrainz: true, lastFm: true });

        expect(submitListenBrainz).toHaveBeenCalledTimes(1);
        expect(submitLastFm).toHaveBeenCalledTimes(2);
        consoleErrorSpy.mockRestore();
    });

    it('does not resubmit when the same track session is started again', async () => {
        const submitLastFm = vi.fn<[eventType: 'playing_now' | 'single', payload: unknown, listenedAt: number], Promise<void>>(async () => undefined);
        const service = createScrobbleService({ submitLastFm });

        const state = createPlaybackState({ currentTime: 200, duration: 300 });
        const track = createTrack({ path: '/music/artist/album/fallback.flac' });

        service.startTrackSession(track.path);
        service.maybeSubmit(state, track, { listenBrainz: false, lastFm: true });
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        service.startTrackSession(track.path);
        service.maybeSubmit(state, track, { listenBrainz: false, lastFm: true });

        const singleCalls = submitLastFm.mock.calls.filter((call) => call[0] === 'single');
        expect(singleCalls).toHaveLength(1);
    });

    it('treats slash-variant paths as the same session track', async () => {
        const submitLastFm = vi.fn<[eventType: 'playing_now' | 'single', payload: unknown, listenedAt: number], Promise<void>>(async () => undefined);
        const service = createScrobbleService({ submitLastFm });

        const state = createPlaybackState({ currentTime: 200, duration: 300 });
        const track = createTrack({ path: 'C:/Music/Artist/Album/track.flac' });

        service.startTrackSession('C:/Music/Artist/Album/track.flac');
        service.maybeSubmit(state, track, { listenBrainz: false, lastFm: true });
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        service.startTrackSession('C:\\Music\\Artist\\Album\\track.flac');
        service.maybeSubmit(state, track, { listenBrainz: false, lastFm: true });

        const singleCalls = submitLastFm.mock.calls.filter((call) => call[0] === 'single');
        expect(singleCalls).toHaveLength(1);
    });

    it('does not retry failed Last.fm single scrobbles within the same session', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const submitLastFm = vi.fn<[eventType: 'playing_now' | 'single', payload: unknown, listenedAt: number], Promise<void>>(async (eventType) => {
            if (eventType === 'single') {
                throw new Error('simulated network failure');
            }
        });
        const service = createScrobbleService({ submitLastFm });

        const state = createPlaybackState({ currentTime: 200, duration: 300 });
        const track = createTrack();

        service.startTrackSession(track.path);
        service.maybeSubmit(state, track, { listenBrainz: false, lastFm: true });
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        service.maybeSubmit(state, track, { listenBrainz: false, lastFm: true });

        const singleCalls = submitLastFm.mock.calls.filter((call) => call[0] === 'single');
        expect(singleCalls).toHaveLength(1);
        consoleErrorSpy.mockRestore();
    });

    it('dedupes Last.fm singles when artist label changes but track identity is the same', async () => {
        const submitLastFm = vi.fn<[eventType: 'playing_now' | 'single', payload: unknown, listenedAt: number], Promise<void>>(async () => undefined);
        const service = createScrobbleService({ submitLastFm });

        const state = createPlaybackState({ currentTime: 200, duration: 300 });
        const romanized = createTrack({
            displayArtist: 'Masato Kouda',
            displayTitle: 'コメディックスタイル',
            displayAlbum: '「魔法戦争」オリジナルサウンドトラック',
            mbIds: {},
        });
        const native = createTrack({
            displayArtist: '甲田雅人',
            displayTitle: 'コメディックスタイル',
            displayAlbum: '「魔法戦争」オリジナルサウンドトラック',
            mbIds: {},
        });

        service.startTrackSession(romanized.path);
        service.maybeSubmit(state, romanized, { listenBrainz: false, lastFm: true });
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        service.startTrackSession(native.path);
        service.maybeSubmit(state, native, { listenBrainz: false, lastFm: true });

        const singleCalls = submitLastFm.mock.calls.filter((call) => call[0] === 'single');
        expect(singleCalls).toHaveLength(1);
    });

    it('dedupes ListenBrainz singles when artist label changes but track identity is the same', async () => {
        const submitListenBrainz = vi.fn<[eventType: 'playing_now' | 'single', payload: unknown, listenedAt: number], Promise<void>>(async () => undefined);
        const service = createScrobbleService({ submitListenBrainz });

        const state = createPlaybackState({ currentTime: 200, duration: 300 });
        const romanized = createTrack({
            displayArtist: 'Masato Kouda',
            displayTitle: 'コメディックスタイル',
            displayAlbum: '「魔法戦争」オリジナルサウンドトラック',
            mbIds: {},
        });
        const native = createTrack({
            displayArtist: '甲田雅人',
            displayTitle: 'コメディックスタイル',
            displayAlbum: '「魔法戦争」オリジナルサウンドトラック',
            mbIds: {},
        });

        service.startTrackSession(romanized.path);
        service.maybeSubmit(state, romanized, { listenBrainz: true, lastFm: false });
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        service.startTrackSession(native.path);
        service.maybeSubmit(state, native, { listenBrainz: true, lastFm: false });

        const singleCalls = submitListenBrainz.mock.calls.filter((call) => call[0] === 'single');
        expect(singleCalls).toHaveLength(1);
    });

    it('defers Last.fm now-playing until metadata hydration completes', async () => {
        const submitListenBrainz = vi.fn(async () => undefined);
        const submitLastFm = vi.fn(async () => undefined);
        const service = createScrobbleService({ submitListenBrainz, submitLastFm });

        const state = createPlaybackState({ currentTime: 1, duration: 300 });
        const unresolvedMetadataTrack = createTrack({
            tagsResolved: true,
            mbMetadataResolved: false,
            mbIds: { releaseId: 'release-123' },
        });

        service.startTrackSession(unresolvedMetadataTrack.path);
        service.maybeSubmit(
            state,
            unresolvedMetadataTrack,
            { listenBrainz: true, lastFm: true },
            { deferLastFmNowPlaying: true },
        );

        expect(submitListenBrainz).toHaveBeenCalledTimes(1);
        expect(submitListenBrainz).toHaveBeenNthCalledWith(
            1,
            'playing_now',
            expect.any(Object),
            0,
        );
        expect(submitLastFm).not.toHaveBeenCalled();

        const hydratedMetadataTrack = createTrack({
            tagsResolved: true,
            mbMetadataResolved: true,
            mbIds: { releaseId: 'release-123' },
        });

        service.maybeSubmit(
            state,
            hydratedMetadataTrack,
            { listenBrainz: true, lastFm: true },
            { deferLastFmNowPlaying: false },
        );

        expect(submitLastFm).toHaveBeenCalledTimes(1);
        expect(submitLastFm).toHaveBeenNthCalledWith(
            1,
            'playing_now',
            expect.any(Object),
            0,
        );
    });

    it('mutates injected scrobble session state instead of closure-local session data', async () => {
        const submitListenBrainz = vi.fn(async () => undefined);
        const state = createScrobbleSessionState();
        const service = createScrobbleService({ submitListenBrainz }, state);

        const track = createTrack();
        const playbackState = createPlaybackState({ currentTime: 200, duration: 300 });

        service.startTrackSession(track.path);
        expect(state.scrobbleSessionId).toBe(1);
        expect(state.activeSessionTrackKey).toBe('/music/artist/album/fallback.flac');

        service.maybeSubmit(playbackState, track, { listenBrainz: true, lastFm: false });
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        expect(submitListenBrainz).toHaveBeenCalledTimes(2);
        expect(state.nowPlayingSubmittedSessionId.listenBrainz).toBe(1);
        expect(state.scrobbleSubmittedSessionId.listenBrainz).toBe(1);
        expect(state.localHistorySubmittedSessionId).toBe(-1);
        expect(state.scrobbleSessionStartedAt).toBeGreaterThan(0);
        expect(state.recentSinglesByProvider.listenBrainz.size).toBe(1);

        service.reset();
        expect(state.scrobbleSessionId).toBe(0);
        expect(state.activeSessionTrackKey).toBe('');
        expect(state.nowPlayingSubmittedSessionId.listenBrainz).toBe(-1);
        expect(state.scrobbleSubmittedSessionId.listenBrainz).toBe(-1);
        expect(state.localHistorySubmittedSessionId).toBe(-1);
        expect(state.recentSinglesByProvider.listenBrainz.size).toBe(1);
    });

    it('stores local listen history even when no external scrobble provider is configured', async () => {
        const submitListenHistory = vi.fn(async () => undefined);
        const state = createScrobbleSessionState();
        const service = createScrobbleService({
            submitListenHistory,
            hasListenHistoryEnabled: () => true,
        }, state);

        const track = createTrack();
        const playbackState = createPlaybackState({ currentTime: 200, duration: 300 });

        service.startTrackSession(track.path);
        service.maybeSubmit(playbackState, track, { listenBrainz: false, lastFm: false });
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        expect(submitListenHistory).toHaveBeenCalledTimes(1);
        expect(submitListenHistory).toHaveBeenCalledWith(
            track.path,
            expect.objectContaining({
                artistName: 'Resolved Artist',
                trackName: 'Resolved Title',
                releaseName: 'Resolved Album',
            }),
            expect.any(Number),
        );
        expect(state.localHistorySubmittedSessionId).toBe(1);

        service.maybeSubmit(playbackState, track, { listenBrainz: false, lastFm: false });
        expect(submitListenHistory).toHaveBeenCalledTimes(1);
    });
});
