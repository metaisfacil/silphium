import type { AudioPlaybackState, Track } from '../types/app-types';

export type ExternalPlaybackAction = 'play' | 'pause' | 'playpause' | 'next' | 'previous' | 'stop';

type MediaArtwork = {
    src: string;
    type: string;
};

type MediaSessionControllerOptions = {
    getPlaybackState: () => AudioPlaybackState;
    getCurrentTrack: () => Track | undefined;
    getCachedArtwork: (track: Track) => MediaArtwork | undefined;
    getCoverArtPreview: () => { visible: boolean; src: string };
    playCurrentTrack: () => Promise<void>;
    pauseCurrentTrack: () => Promise<void>;
    toggleCurrentTrack: () => Promise<void>;
    goToTrack: (direction: -1 | 1) => void;
    stopCurrentTrack: () => Promise<void>;
    seekToTime: (targetSeconds: number) => Promise<void>;
};

const mediaSessionSeekStepSeconds = 10;
const externalPlaybackActionDedupWindowMs = 220;

const createSilentWavObjectUrl = (): string => {
    const sampleRate = 8000;
    const durationSeconds = 2;
    const sampleCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
    const bytesPerSample = 2;
    const dataSize = sampleCount * bytesPerSample;
    const wavBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(wavBuffer);
    let offset = 0;

    const writeAscii = (value: string): void => {
        for (let index = 0; index < value.length; index += 1) {
            view.setUint8(offset, value.charCodeAt(index));
            offset += 1;
        }
    };

    writeAscii('RIFF');
    view.setUint32(offset, 36 + dataSize, true);
    offset += 4;
    writeAscii('WAVE');
    writeAscii('fmt ');
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint32(offset, sampleRate, true);
    offset += 4;
    view.setUint32(offset, sampleRate * bytesPerSample, true);
    offset += 4;
    view.setUint16(offset, bytesPerSample, true);
    offset += 2;
    view.setUint16(offset, 16, true);
    offset += 2;
    writeAscii('data');
    view.setUint32(offset, dataSize, true);

    return URL.createObjectURL(new Blob([wavBuffer], { type: 'audio/wav' }));
};

export type MediaSessionController = ReturnType<typeof createMediaSessionController>;

export const createMediaSessionController = (options: MediaSessionControllerOptions) => {
    const supportsMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
    const mediaSessionAnchorUrl = supportsMediaSession ? createSilentWavObjectUrl() : '';
    const mediaSessionAnchorAudio = supportsMediaSession
        ? new Audio(mediaSessionAnchorUrl)
        : null;
    let lastMetadataSignature = '';
    let lastPlaybackStateValue: MediaSessionPlaybackState | '' = '';
    let lastPositionStateKey = '';
    let mediaSessionAnchorPlayPending = false;
    let mediaSessionAnchorUnlockPending = false;
    let mediaSessionAnchorUnlocked = false;
    let lastExternalPlaybackActionGroup: 'playpause' | 'next' | 'previous' | 'stop' | '' = '';
    let lastExternalPlaybackActionAt = 0;

    if (mediaSessionAnchorAudio) {
        mediaSessionAnchorAudio.loop = true;
        mediaSessionAnchorAudio.muted = false;
        mediaSessionAnchorAudio.volume = 1;
        mediaSessionAnchorAudio.preload = 'auto';
    }

    const unlockFromUserGesture = (): void => {
        if (!mediaSessionAnchorAudio || mediaSessionAnchorUnlocked || mediaSessionAnchorUnlockPending) {
            return;
        }

        mediaSessionAnchorUnlockPending = true;
        void mediaSessionAnchorAudio.play().then(() => {
            mediaSessionAnchorUnlocked = true;
            const playbackState = options.getPlaybackState();
            if (!playbackState.loaded || !playbackState.playing) {
                mediaSessionAnchorAudio.pause();
                mediaSessionAnchorAudio.currentTime = 0;
            }
        }).catch((error) => {
            console.debug(error);
        }).finally(() => {
            mediaSessionAnchorUnlockPending = false;
        });
    };

    const externalPlaybackActionGroup = (action: ExternalPlaybackAction): 'playpause' | 'next' | 'previous' | 'stop' => {
        if (action === 'next') {
            return 'next';
        }

        if (action === 'previous') {
            return 'previous';
        }

        if (action === 'stop') {
            return 'stop';
        }

        return 'playpause';
    };

    const shouldSuppressDuplicateExternalPlaybackAction = (action: ExternalPlaybackAction): boolean => {
        const actionGroup = externalPlaybackActionGroup(action);
        const now = performance.now();
        const duplicate = lastExternalPlaybackActionGroup === actionGroup
            && (now - lastExternalPlaybackActionAt) < externalPlaybackActionDedupWindowMs;

        lastExternalPlaybackActionGroup = actionGroup;
        lastExternalPlaybackActionAt = now;
        return duplicate;
    };

    const dispatchExternalPlaybackAction = (action: ExternalPlaybackAction): void => {
        if (shouldSuppressDuplicateExternalPlaybackAction(action)) {
            return;
        }

        if (action === 'play') {
            void options.playCurrentTrack();
            return;
        }

        if (action === 'pause') {
            void options.pauseCurrentTrack();
            return;
        }

        if (action === 'playpause') {
            void options.toggleCurrentTrack();
            return;
        }

        if (action === 'next') {
            options.goToTrack(1);
            return;
        }

        if (action === 'previous') {
            options.goToTrack(-1);
            return;
        }

        void options.stopCurrentTrack();
    };

    const setMediaSessionActionHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
        if (!supportsMediaSession) {
            return;
        }

        try {
            navigator.mediaSession.setActionHandler(action, handler);
        } catch (error) {
            console.debug(error);
        }
    };

    const updateMetadata = (): void => {
        if (!supportsMediaSession) {
            return;
        }

        const playbackState = options.getPlaybackState();
        const activeTrack = options.getCurrentTrack();
        if (!playbackState.loaded || !activeTrack) {
            if (lastMetadataSignature === 'none') {
                return;
            }

            navigator.mediaSession.metadata = null;
            lastMetadataSignature = 'none';
            return;
        }

        const metadataInit: MediaMetadataInit = {
            title: activeTrack.displayTitle || activeTrack.title || activeTrack.name,
            artist: activeTrack.displayArtist || 'Unknown Artist',
            album: activeTrack.displayAlbum || 'Unknown Album',
        };

        const cachedArtwork = options.getCachedArtwork(activeTrack);
        if (cachedArtwork) {
            metadataInit.artwork = [{
                src: cachedArtwork.src,
                type: cachedArtwork.type,
            }];
        }

        const preview = options.getCoverArtPreview();
        if (!cachedArtwork && preview.visible && preview.src && !preview.src.startsWith('blob:')) {
            metadataInit.artwork = [{ src: preview.src }];
        }

        const artworkSignature = metadataInit.artwork
            ? metadataInit.artwork.map((artwork) => `${artwork.src || ''}|${artwork.type || ''}`).join('\n')
            : '';
        const nextMetadataSignature = [
            metadataInit.title || '',
            metadataInit.artist || '',
            metadataInit.album || '',
            artworkSignature,
        ].join('\n');
        if (nextMetadataSignature === lastMetadataSignature) {
            return;
        }

        navigator.mediaSession.metadata = new MediaMetadata(metadataInit);
        lastMetadataSignature = nextMetadataSignature;
    };

    const updatePlaybackState = (): void => {
        if (!supportsMediaSession) {
            return;
        }

        const playbackState = options.getPlaybackState();
        const nextPlaybackState = playbackState.loaded
            ? (playbackState.playing ? 'playing' : 'paused')
            : 'none';
        if (nextPlaybackState !== lastPlaybackStateValue) {
            navigator.mediaSession.playbackState = nextPlaybackState;
            lastPlaybackStateValue = nextPlaybackState;
        }

        if (!mediaSessionAnchorAudio) {
            return;
        }

        const shouldPlayAnchor = playbackState.loaded && playbackState.playing;
        if (shouldPlayAnchor) {
            if (mediaSessionAnchorAudio.paused && !mediaSessionAnchorPlayPending && !mediaSessionAnchorUnlockPending) {
                mediaSessionAnchorPlayPending = true;
                void mediaSessionAnchorAudio.play().then(() => {
                    mediaSessionAnchorUnlocked = true;
                }).catch((error) => {
                    console.debug(error);
                }).finally(() => {
                    mediaSessionAnchorPlayPending = false;
                });
            }
            return;
        }

        if (!mediaSessionAnchorAudio.paused) {
            mediaSessionAnchorAudio.pause();
            mediaSessionAnchorAudio.currentTime = 0;
        }
    };

    const updatePositionState = (): void => {
        if (!supportsMediaSession || typeof navigator.mediaSession.setPositionState !== 'function') {
            return;
        }

        const playbackState = options.getPlaybackState();
        if (!playbackState.loaded || !Number.isFinite(playbackState.duration) || playbackState.duration <= 0 || !Number.isFinite(playbackState.currentTime)) {
            if (lastPositionStateKey === 'unloaded') {
                return;
            }

            try {
                navigator.mediaSession.setPositionState(undefined);
                lastPositionStateKey = 'unloaded';
            } catch (error) {
                console.debug(error);
            }
            return;
        }

        const boundedPosition = Math.min(Math.max(0, playbackState.currentTime), playbackState.duration);
        const quantizedPositionSeconds = Math.floor(boundedPosition);
        const nextPositionStateKey = `${playbackState.duration.toFixed(3)}|${quantizedPositionSeconds}`;
        if (nextPositionStateKey === lastPositionStateKey) {
            return;
        }

        try {
            navigator.mediaSession.setPositionState({
                duration: playbackState.duration,
                position: boundedPosition,
                playbackRate: 1,
            });
            lastPositionStateKey = nextPositionStateKey;
        } catch (error) {
            console.debug(error);
        }
    };

    const initialize = (): void => {
        if (!supportsMediaSession) {
            return;
        }

        setMediaSessionActionHandler('play', () => {
            dispatchExternalPlaybackAction('play');
        });
        setMediaSessionActionHandler('pause', () => {
            dispatchExternalPlaybackAction('pause');
        });
        setMediaSessionActionHandler('previoustrack', () => {
            dispatchExternalPlaybackAction('previous');
        });
        setMediaSessionActionHandler('nexttrack', () => {
            dispatchExternalPlaybackAction('next');
        });
        setMediaSessionActionHandler('stop', () => {
            dispatchExternalPlaybackAction('stop');
        });
        setMediaSessionActionHandler('seekto', (details) => {
            if (details.seekTime === undefined || !Number.isFinite(details.seekTime)) {
                return;
            }

            void options.seekToTime(Math.max(0, details.seekTime));
        });
        setMediaSessionActionHandler('seekbackward', (details) => {
            const currentState = options.getPlaybackState();
            const seekOffset = (details.seekOffset !== undefined && Number.isFinite(details.seekOffset))
                ? details.seekOffset
                : mediaSessionSeekStepSeconds;
            void options.seekToTime(Math.max(0, currentState.currentTime - seekOffset));
        });
        setMediaSessionActionHandler('seekforward', (details) => {
            const currentState = options.getPlaybackState();
            const seekOffset = (details.seekOffset !== undefined && Number.isFinite(details.seekOffset))
                ? details.seekOffset
                : mediaSessionSeekStepSeconds;
            const maxDuration = Number.isFinite(currentState.duration) && currentState.duration > 0
                ? currentState.duration
                : Number.POSITIVE_INFINITY;
            void options.seekToTime(Math.min(maxDuration, currentState.currentTime + seekOffset));
        });

        updatePlaybackState();
        updatePositionState();
        updateMetadata();
    };

    const handleHardwareMediaKey = (event: KeyboardEvent): boolean => {
        const mediaKey = event.code || event.key;
        if (mediaKey === 'MediaPlayPause') {
            dispatchExternalPlaybackAction('playpause');
            return true;
        }

        if (mediaKey === 'MediaTrackNext') {
            dispatchExternalPlaybackAction('next');
            return true;
        }

        if (mediaKey === 'MediaTrackPrevious') {
            dispatchExternalPlaybackAction('previous');
            return true;
        }

        if (mediaKey === 'MediaStop') {
            dispatchExternalPlaybackAction('stop');
            return true;
        }

        return false;
    };

    const dispose = (): void => {
        if (mediaSessionAnchorAudio) {
            mediaSessionAnchorAudio.pause();
            mediaSessionAnchorAudio.removeAttribute('src');
            mediaSessionAnchorAudio.load();
        }

        if (mediaSessionAnchorUrl) {
            URL.revokeObjectURL(mediaSessionAnchorUrl);
        }
    };

    return {
        dispatchExternalPlaybackAction,
        dispose,
        handleHardwareMediaKey,
        initialize,
        unlockFromUserGesture,
        updateMetadata,
        updatePlaybackState,
        updatePositionState,
    };
};