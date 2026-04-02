import type { AudioPlaybackState, Track } from '../types/app-types';

type ListenBrainzPayload = {
    artistName: string;
    trackName: string;
    releaseName: string;
    recordingMbid?: string;
    releaseMbid?: string;
    artistMbids?: string[];
};

type ScrobbleServiceOptions = {
    submitListenBrainz: (eventType: 'playing_now' | 'single', payload: ListenBrainzPayload, listenedAt: number) => Promise<unknown>;
};

export type ScrobbleService = ReturnType<typeof createScrobbleService>;

export const createScrobbleService = (options: ScrobbleServiceOptions) => {
    let scrobbleSessionId = 0;
    let nowPlayingSubmittedSessionId = -1;
    let scrobbleSubmittedSessionId = -1;
    let nowPlayingInFlight = false;
    let scrobbleInFlight = false;
    let scrobbleSessionStartedAt = 0;

    const buildListenBrainzMetadata = (track: Track): ListenBrainzPayload => ({
        artistName: track.displayArtist || 'Unknown Artist',
        trackName: track.displayTitle || track.title,
        releaseName: track.displayAlbum || 'Unknown Album',
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

    return {
        maybeSubmit: (state: AudioPlaybackState, track: Track | undefined, canScrobble: boolean): void => {
            if (!canScrobble || !track) {
                return;
            }

            if (state.playing && scrobbleSessionStartedAt <= 0) {
                scrobbleSessionStartedAt = Math.floor(Date.now() / 1000);
            }

            if (state.playing && nowPlayingSubmittedSessionId !== scrobbleSessionId && !nowPlayingInFlight) {
                nowPlayingInFlight = true;
                void options.submitListenBrainz('playing_now', buildListenBrainzMetadata(track), 0)
                    .then(() => {
                        nowPlayingSubmittedSessionId = scrobbleSessionId;
                    })
                    .catch((error) => {
                        console.error(error);
                    })
                    .finally(() => {
                        nowPlayingInFlight = false;
                    });
            }

            if (scrobbleSubmittedSessionId === scrobbleSessionId || scrobbleInFlight) {
                return;
            }

            const threshold = scrobbleThreshold(state.duration);
            if (state.currentTime < threshold) {
                return;
            }

            const listenedAt = scrobbleSessionStartedAt > 0 ? scrobbleSessionStartedAt : Math.floor(Date.now() / 1000);
            scrobbleInFlight = true;
            void options.submitListenBrainz('single', buildListenBrainzMetadata(track), listenedAt)
                .then(() => {
                    scrobbleSubmittedSessionId = scrobbleSessionId;
                })
                .catch((error) => {
                    console.error(error);
                })
                .finally(() => {
                    scrobbleInFlight = false;
                });
        },
        reset: (): void => {
            scrobbleSessionId = 0;
            nowPlayingSubmittedSessionId = -1;
            scrobbleSubmittedSessionId = -1;
            nowPlayingInFlight = false;
            scrobbleInFlight = false;
            scrobbleSessionStartedAt = 0;
        },
        startTrackSession: (): void => {
            scrobbleSessionId += 1;
            nowPlayingSubmittedSessionId = -1;
            scrobbleSubmittedSessionId = -1;
            scrobbleSessionStartedAt = 0;
        },
    };
};