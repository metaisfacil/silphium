import type { AudioPlaybackState, Track } from '../types/app-types';
import { matchesSilenceTitleHeuristic } from '../utils/display-helpers';
import { defaultListenHistoryThresholdSeconds } from '../utils/settings-normalization';

type ScrobblePayload = {
    artistName: string;
    trackName: string;
    releaseName: string;
    albumArtist?: string;
    trackNumber?: string;
    durationSeconds?: number;
    recordingMbid?: string;
    releaseMbid?: string;
    artistMbids?: string[];
};

export type ScrobbleProvider = 'listenBrainz' | 'lastFm';

type ScrobbleProviderAvailability = Record<ScrobbleProvider, boolean>;

type ScrobbleSubmissionOptions = {
    deferLastFmNowPlaying?: boolean;
};

type ScrobbleServiceOptions = {
    submitListenBrainz?: (eventType: 'playing_now' | 'single', payload: ScrobblePayload, listenedAt: number) => Promise<unknown>;
    submitLastFm?: (eventType: 'playing_now' | 'single', payload: ScrobblePayload, listenedAt: number) => Promise<unknown>;
    submitListenHistory?: (trackPath: string, payload: ScrobblePayload, listenedAt: number, playedPercent: number) => Promise<unknown>;
    hasListenHistoryEnabled?: () => boolean;
    getListenHistoryThresholdSeconds?: () => number;
};

const createProviderRecord = <T>(initial: T): Record<ScrobbleProvider, T> => ({
    listenBrainz: initial,
    lastFm: initial,
});

export type ScrobbleSessionState = {
    scrobbleSessionId: number;
    nowPlayingSubmittedSessionId: Record<ScrobbleProvider, number>;
    scrobbleSubmittedSessionId: Record<ScrobbleProvider, number>;
    nowPlayingInFlight: Record<ScrobbleProvider, boolean>;
    scrobbleInFlight: Record<ScrobbleProvider, boolean>;
    localHistorySubmittedSessionId: number;
    localHistoryInFlight: boolean;
    localHistorySubmittedPercent: number;
    scrobbleSessionStartedAt: number;
    activeSessionTrackKey: string;
    recentSinglesByProvider: Record<ScrobbleProvider, Map<string, number>>;
};

export const createScrobbleSessionState = (): ScrobbleSessionState => ({
    scrobbleSessionId: 0,
    nowPlayingSubmittedSessionId: createProviderRecord(-1),
    scrobbleSubmittedSessionId: createProviderRecord(-1),
    nowPlayingInFlight: createProviderRecord(false),
    scrobbleInFlight: createProviderRecord(false),
    localHistorySubmittedSessionId: -1,
    localHistoryInFlight: false,
    localHistorySubmittedPercent: 0,
    scrobbleSessionStartedAt: 0,
    activeSessionTrackKey: '',
    recentSinglesByProvider: {
        listenBrainz: new Map<string, number>(),
        lastFm: new Map<string, number>(),
    },
});

export type ScrobbleService = ReturnType<typeof createScrobbleService>;

export const createScrobbleService = (
    options: ScrobbleServiceOptions,
    state: ScrobbleSessionState = createScrobbleSessionState(),
) => {
    const providers: ScrobbleProvider[] = ['listenBrainz', 'lastFm'];
    const singleDedupWindowSeconds = 15 * 60;
    let sessionSerial = 0;

    const sessionTrackKey = (trackPath: string | undefined): string => {
        return (trackPath || '')
            .trim()
            .replace(/\\/g, '/')
            .toLowerCase();
    };

    const providerSubmitters: Record<ScrobbleProvider, ScrobbleServiceOptions['submitListenBrainz']> = {
        listenBrainz: options.submitListenBrainz,
        lastFm: options.submitLastFm,
    };

    const localHistoryThresholdSeconds = (): number => {
        const configuredThreshold = options.getListenHistoryThresholdSeconds?.();
        if (!Number.isFinite(configuredThreshold) || (configuredThreshold || 0) < 1) {
            return defaultListenHistoryThresholdSeconds;
        }

        return Math.floor(configuredThreshold as number);
    };

    const canTrackBeStoredInLocalHistory = (track: Track): boolean => !matchesSilenceTitleHeuristic(track);

    const localHistoryThreshold = (duration: number | undefined): number => {
        if (!Number.isFinite(duration || 0) || (duration || 0) <= 0) {
            return Number.POSITIVE_INFINITY;
        }

        const totalDuration = duration as number;
        const configuredThresholdSeconds = localHistoryThresholdSeconds();
        if (totalDuration < configuredThresholdSeconds) {
            return totalDuration;
        }

        return Math.max(totalDuration * 0.1, configuredThresholdSeconds);
    };

    const submitListenHistory = (trackPath: string, payload: ScrobblePayload, listenedAt: number, playedPercent: number): void => {
        const submit = options.submitListenHistory;
        if (!submit || trackPath.trim() === '') {
            return;
        }

        const requestSessionSerial = sessionSerial;
        state.localHistoryInFlight = true;

        void submit(trackPath, payload, listenedAt, playedPercent)
            .then(() => {
                if (requestSessionSerial !== sessionSerial) {
                    return;
                }

                state.localHistorySubmittedSessionId = state.scrobbleSessionId;
                state.localHistorySubmittedPercent = Math.max(0, Math.min(100, Math.round(playedPercent)));
            })
            .catch((error) => {
                console.error(error);
            })
            .finally(() => {
                if (requestSessionSerial !== sessionSerial) {
                    return;
                }

                state.localHistoryInFlight = false;
            });
    };

    const completeLocalHistory = (track: Track | undefined, stateDuration: number): void => {
        if (!track || options.hasListenHistoryEnabled?.() !== true || !options.submitListenHistory) {
            return;
        }

        if (!canTrackBeStoredInLocalHistory(track)) {
            return;
        }

        if (state.localHistoryInFlight || state.localHistorySubmittedPercent >= 100) {
            return;
        }

        const payload = buildScrobbleMetadata(track, stateDuration);
        const listenedAt = state.scrobbleSessionStartedAt > 0 ? state.scrobbleSessionStartedAt : Math.floor(Date.now() / 1000);
        submitListenHistory(track.path || '', payload, listenedAt, 100);
    };

    const firstTagValue = (track: Track, ...keys: string[]): string => {
        for (const key of keys) {
            const normalizedKey = key.toLowerCase();
            for (const [tagName, values] of Object.entries(track.allFileTags || {})) {
                if (tagName.toLowerCase() !== normalizedKey) {
                    continue;
                }

                const firstValue = values.find((value) => value.trim() !== '');
                if (firstValue) {
                    return firstValue.trim();
                }
            }
        }

        return '';
    };

    const normalizedTrackNumber = (track: Track): string | undefined => {
        const candidate = (track.displayTrackNumber || firstTagValue(track, 'tracknumber', 'track number', 'track')).trim();
        if (candidate === '') {
            return undefined;
        }

        const normalized = candidate.split('/')[0]?.trim() || '';
        return /^\d+$/.test(normalized) ? normalized : undefined;
    };

    const durationSeconds = (track: Track, stateDuration: number): number | undefined => {
        if (Number.isFinite(stateDuration) && stateDuration > 0) {
            return Math.round(stateDuration);
        }

        if (Number.isFinite(track.technicalDetails.durationSeconds) && (track.technicalDetails.durationSeconds || 0) > 0) {
            return Math.round(track.technicalDetails.durationSeconds as number);
        }

        return undefined;
    };

    const scrobbleReleaseName = (track: Track): string => {
        return firstTagValue(track, 'album') || track.displayAlbum || '';
    };

    const buildScrobbleMetadata = (track: Track, stateDuration: number): ScrobblePayload => ({
        artistName: track.displayArtist || firstTagValue(track, 'artist') || 'Unknown Artist',
        trackName: track.displayTitle || track.title || track.name,
        releaseName: scrobbleReleaseName(track),
        albumArtist: firstTagValue(track, 'albumartist', 'album artist', 'album_artist') || undefined,
        trackNumber: normalizedTrackNumber(track),
        durationSeconds: durationSeconds(track, stateDuration),
        recordingMbid: track.mbIds.recordingId || undefined,
        releaseMbid: track.mbIds.releaseId || undefined,
        artistMbids: track.artistMbids.length > 0 ? track.artistMbids : undefined,
    });

    const scrobbleThreshold = (duration: number): number => {
        if (!Number.isFinite(duration) || duration <= 0) {
            return Number.POSITIVE_INFINITY;
        }

        return Math.min(duration / 2, 240);
    };

    const playedPercent = (currentTime: number, totalDuration: number | undefined): number => {
        if (!Number.isFinite(currentTime) || currentTime <= 0 || !Number.isFinite(totalDuration || 0) || (totalDuration || 0) <= 0) {
            return 0;
        }

        return Math.max(0, Math.min(100, Math.round((currentTime / (totalDuration || 1)) * 100)));
    };

    const singleDedupKey = (payload: ScrobblePayload): string => {
        const recordingMbid = (payload.recordingMbid || '').trim().toLowerCase();
        if (recordingMbid !== '') {
            return `mbid:${recordingMbid}`;
        }

        const trackNumber = (payload.trackNumber || '').trim().toLowerCase();
        const durationSeconds = Number.isFinite(payload.durationSeconds) ? String(payload.durationSeconds) : '';
        return [
            `track:${(payload.trackName || '').trim().toLowerCase()}`,
            `release:${(payload.releaseName || '').trim().toLowerCase()}`,
            `number:${trackNumber}`,
            `duration:${durationSeconds}`,
        ].join('\x1f');
    };

    const shouldSkipProviderSingle = (provider: ScrobbleProvider, payload: ScrobblePayload, listenedAt: number): boolean => {
        if (!Number.isFinite(listenedAt) || listenedAt <= 0) {
            return false;
        }

        const dedupKey = singleDedupKey(payload);
        if (dedupKey.replace(/\x1f/g, '') === '') {
            return false;
        }

        const recentSingles = state.recentSinglesByProvider[provider];

        const cutoff = listenedAt - singleDedupWindowSeconds;
        for (const [key, previousListenedAt] of recentSingles.entries()) {
            if (previousListenedAt < cutoff) {
                recentSingles.delete(key);
            }
        }

        const previousListenedAt = recentSingles.get(dedupKey);
        if (previousListenedAt !== undefined && Math.abs(previousListenedAt - listenedAt) <= singleDedupWindowSeconds) {
            return true;
        }

        recentSingles.set(dedupKey, listenedAt);
        return false;
    };

    const submitForProvider = (
        provider: ScrobbleProvider,
        eventType: 'playing_now' | 'single',
        payload: ScrobblePayload,
        listenedAt: number,
    ): void => {
        const submit = providerSubmitters[provider];
        if (!submit) {
            return;
        }

        const requestSessionSerial = sessionSerial;

        if (eventType === 'playing_now') {
            state.nowPlayingInFlight[provider] = true;
        } else {
            state.scrobbleInFlight[provider] = true;
            if (provider === 'lastFm') {
                // Last.fm can occasionally accept a scrobble even when the client sees an error.
                // Mark this session submitted before awaiting the response to avoid duplicates.
                state.scrobbleSubmittedSessionId[provider] = state.scrobbleSessionId;
            }
        }

        void submit(eventType, payload, listenedAt)
            .then(() => {
                if (requestSessionSerial !== sessionSerial) {
                    return;
                }

                if (eventType === 'playing_now') {
                    state.nowPlayingSubmittedSessionId[provider] = state.scrobbleSessionId;
                    return;
                }

                if (provider !== 'lastFm') {
                    state.scrobbleSubmittedSessionId[provider] = state.scrobbleSessionId;
                }
            })
            .catch((error) => {
                console.error(error);
            })
            .finally(() => {
                if (requestSessionSerial !== sessionSerial) {
                    return;
                }

                if (eventType === 'playing_now') {
                    state.nowPlayingInFlight[provider] = false;
                    return;
                }

                state.scrobbleInFlight[provider] = false;
            });
    };

    return {
        maybeSubmit: (
            playbackState: AudioPlaybackState,
            track: Track | undefined,
            availability: ScrobbleProviderAvailability,
            submissionOptions?: ScrobbleSubmissionOptions,
        ): void => {
            if (!track) {
                return;
            }

            const enabledProviders = providers.filter((provider) => availability[provider]);
            const localHistoryEnabled = options.hasListenHistoryEnabled?.() === true && !!options.submitListenHistory;
            if (enabledProviders.length === 0 && !localHistoryEnabled) {
                return;
            }

            if (playbackState.playing && state.scrobbleSessionStartedAt <= 0) {
                state.scrobbleSessionStartedAt = Math.floor(Date.now() / 1000);
            }

            if (!track.tagsResolved) {
                return;
            }

            const payload = buildScrobbleMetadata(track, playbackState.duration);

            if (playbackState.playing) {
                for (const provider of enabledProviders) {
                    if (state.nowPlayingSubmittedSessionId[provider] === state.scrobbleSessionId || state.nowPlayingInFlight[provider]) {
                        continue;
                    }

                    if (provider === 'lastFm' && submissionOptions?.deferLastFmNowPlaying) {
                        continue;
                    }

                    submitForProvider(provider, 'playing_now', payload, 0);
                }
            }

            const threshold = scrobbleThreshold(playbackState.duration);
            const listenedAt = state.scrobbleSessionStartedAt > 0 ? state.scrobbleSessionStartedAt : Math.floor(Date.now() / 1000);
            const currentPlayedPercent = playedPercent(playbackState.currentTime, payload.durationSeconds);
            if (localHistoryEnabled
                && canTrackBeStoredInLocalHistory(track)
                && !state.localHistoryInFlight
                && currentPlayedPercent > 0
                && playbackState.currentTime >= localHistoryThreshold(payload.durationSeconds)
                && (state.localHistorySubmittedSessionId !== state.scrobbleSessionId
                    || currentPlayedPercent > state.localHistorySubmittedPercent)) {
                submitListenHistory(track.path || '', payload, listenedAt, currentPlayedPercent);
            }

            if (playbackState.currentTime < threshold) {
                return;
            }

            for (const provider of enabledProviders) {
                if (state.scrobbleSubmittedSessionId[provider] === state.scrobbleSessionId || state.scrobbleInFlight[provider]) {
                    continue;
                }

                if (shouldSkipProviderSingle(provider, payload, listenedAt)) {
                    state.scrobbleSubmittedSessionId[provider] = state.scrobbleSessionId;
                    continue;
                }

                submitForProvider(provider, 'single', payload, listenedAt);
            }
        },
        reset: (): void => {
            sessionSerial += 1;
            state.scrobbleSessionId = 0;
            state.nowPlayingSubmittedSessionId = createProviderRecord(-1);
            state.scrobbleSubmittedSessionId = createProviderRecord(-1);
            state.nowPlayingInFlight = createProviderRecord(false);
            state.scrobbleInFlight = createProviderRecord(false);
            state.localHistorySubmittedSessionId = -1;
            state.localHistoryInFlight = false;
            state.localHistorySubmittedPercent = 0;
            state.scrobbleSessionStartedAt = 0;
            state.activeSessionTrackKey = '';
        },
        startTrackSession: (trackPath?: string): void => {
            const nextTrackKey = sessionTrackKey(trackPath);
            if (nextTrackKey !== '' && nextTrackKey === state.activeSessionTrackKey) {
                return;
            }

            sessionSerial += 1;
            state.scrobbleSessionId += 1;
            state.nowPlayingSubmittedSessionId = createProviderRecord(-1);
            state.scrobbleSubmittedSessionId = createProviderRecord(-1);
            state.localHistorySubmittedSessionId = -1;
            state.localHistoryInFlight = false;
            state.localHistorySubmittedPercent = 0;
            state.scrobbleSessionStartedAt = 0;
            state.activeSessionTrackKey = nextTrackKey;
        },
        completeLocalHistory,
    };
};