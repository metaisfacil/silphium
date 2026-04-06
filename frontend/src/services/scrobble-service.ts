import type { AudioPlaybackState, Track } from '../types/app-types';

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

type ScrobbleProvider = 'listenBrainz' | 'lastFm';

type ScrobbleProviderAvailability = Record<ScrobbleProvider, boolean>;

type ScrobbleServiceOptions = {
    submitListenBrainz?: (eventType: 'playing_now' | 'single', payload: ScrobblePayload, listenedAt: number) => Promise<unknown>;
    submitLastFm?: (eventType: 'playing_now' | 'single', payload: ScrobblePayload, listenedAt: number) => Promise<unknown>;
};

export type ScrobbleService = ReturnType<typeof createScrobbleService>;

export const createScrobbleService = (options: ScrobbleServiceOptions) => {
    const providers: ScrobbleProvider[] = ['listenBrainz', 'lastFm'];

    const createProviderRecord = <T>(initial: T): Record<ScrobbleProvider, T> => ({
        listenBrainz: initial,
        lastFm: initial,
    });

    let scrobbleSessionId = 0;
    let nowPlayingSubmittedSessionId = createProviderRecord(-1);
    let scrobbleSubmittedSessionId = createProviderRecord(-1);
    let nowPlayingInFlight = createProviderRecord(false);
    let scrobbleInFlight = createProviderRecord(false);
    let scrobbleSessionStartedAt = 0;
    let activeSessionTrackKey = '';
    const lastFmSingleDedupWindowSeconds = 15 * 60;
    const lastFmRecentSingles = new Map<string, number>();

    const sessionTrackKey = (trackPath: string | undefined): string => {
        return (trackPath || '')
            .trim()
            .replace(/\\/g, '/')
            .toLowerCase();
    };

    const providerSubmitters: Record<ScrobbleProvider, ScrobbleServiceOptions[keyof ScrobbleServiceOptions]> = {
        listenBrainz: options.submitListenBrainz,
        lastFm: options.submitLastFm,
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

    const buildScrobbleMetadata = (track: Track, stateDuration: number): ScrobblePayload => ({
        artistName: track.displayArtist || firstTagValue(track, 'artist') || 'Unknown Artist',
        trackName: track.displayTitle || track.title || track.name,
        releaseName: track.displayAlbum || firstTagValue(track, 'album') || '',
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

    const lastFmSingleDedupKey = (payload: ScrobblePayload): string => {
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

    const shouldSkipLastFmSingle = (payload: ScrobblePayload, listenedAt: number): boolean => {
        if (!Number.isFinite(listenedAt) || listenedAt <= 0) {
            return false;
        }

        const dedupKey = lastFmSingleDedupKey(payload);
        if (dedupKey.replace(/\x1f/g, '') === '') {
            return false;
        }

        const cutoff = listenedAt - lastFmSingleDedupWindowSeconds;
        for (const [key, previousListenedAt] of lastFmRecentSingles.entries()) {
            if (previousListenedAt < cutoff) {
                lastFmRecentSingles.delete(key);
            }
        }

        const previousListenedAt = lastFmRecentSingles.get(dedupKey);
        if (previousListenedAt !== undefined && Math.abs(previousListenedAt - listenedAt) <= lastFmSingleDedupWindowSeconds) {
            return true;
        }

        lastFmRecentSingles.set(dedupKey, listenedAt);
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

        if (eventType === 'playing_now') {
            nowPlayingInFlight[provider] = true;
        } else {
            scrobbleInFlight[provider] = true;
            if (provider === 'lastFm') {
                // Last.fm can occasionally accept a scrobble even when the client sees an error.
                // Mark this session submitted before awaiting the response to avoid duplicates.
                scrobbleSubmittedSessionId[provider] = scrobbleSessionId;
            }
        }

        void submit(eventType, payload, listenedAt)
            .then(() => {
                if (eventType === 'playing_now') {
                    nowPlayingSubmittedSessionId[provider] = scrobbleSessionId;
                    return;
                }

                if (provider !== 'lastFm') {
                    scrobbleSubmittedSessionId[provider] = scrobbleSessionId;
                }
            })
            .catch((error) => {
                console.error(error);
            })
            .finally(() => {
                if (eventType === 'playing_now') {
                    nowPlayingInFlight[provider] = false;
                    return;
                }

                scrobbleInFlight[provider] = false;
            });
    };

    return {
        maybeSubmit: (state: AudioPlaybackState, track: Track | undefined, availability: ScrobbleProviderAvailability): void => {
            if (!track) {
                return;
            }

            const enabledProviders = providers.filter((provider) => availability[provider]);
            if (enabledProviders.length === 0) {
                return;
            }

            if (state.playing && scrobbleSessionStartedAt <= 0) {
                scrobbleSessionStartedAt = Math.floor(Date.now() / 1000);
            }

            if (!track.tagsResolved) {
                return;
            }

            const payload = buildScrobbleMetadata(track, state.duration);

            if (state.playing) {
                for (const provider of enabledProviders) {
                    if (nowPlayingSubmittedSessionId[provider] === scrobbleSessionId || nowPlayingInFlight[provider]) {
                        continue;
                    }

                    submitForProvider(provider, 'playing_now', payload, 0);
                }
            }

            const threshold = scrobbleThreshold(state.duration);
            if (state.currentTime < threshold) {
                return;
            }

            const listenedAt = scrobbleSessionStartedAt > 0 ? scrobbleSessionStartedAt : Math.floor(Date.now() / 1000);
            for (const provider of enabledProviders) {
                if (scrobbleSubmittedSessionId[provider] === scrobbleSessionId || scrobbleInFlight[provider]) {
                    continue;
                }

                if (provider === 'lastFm' && shouldSkipLastFmSingle(payload, listenedAt)) {
                    scrobbleSubmittedSessionId[provider] = scrobbleSessionId;
                    continue;
                }

                submitForProvider(provider, 'single', payload, listenedAt);
            }
        },
        reset: (): void => {
            scrobbleSessionId = 0;
            nowPlayingSubmittedSessionId = createProviderRecord(-1);
            scrobbleSubmittedSessionId = createProviderRecord(-1);
            nowPlayingInFlight = createProviderRecord(false);
            scrobbleInFlight = createProviderRecord(false);
            scrobbleSessionStartedAt = 0;
            activeSessionTrackKey = '';
        },
        startTrackSession: (trackPath?: string): void => {
            const nextTrackKey = sessionTrackKey(trackPath);
            if (nextTrackKey !== '' && nextTrackKey === activeSessionTrackKey) {
                return;
            }

            scrobbleSessionId += 1;
            nowPlayingSubmittedSessionId = createProviderRecord(-1);
            scrobbleSubmittedSessionId = createProviderRecord(-1);
            scrobbleSessionStartedAt = 0;
            activeSessionTrackKey = nextTrackKey;
        },
    };
};