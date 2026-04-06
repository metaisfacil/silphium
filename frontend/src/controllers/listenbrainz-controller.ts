import type { MediaControlsElements } from '../components/media-controls';
import type { Track } from '../types/app-types';

export type ListenBrainzFeedbackScore = -1 | 0 | 1;

type ListenBrainzControllerOptions = {
    elements: Pick<MediaControlsElements, 'playerCard' | 'listenBrainzLoveBtn' | 'listenBrainzFeedbackMenu' | 'listenBrainzFeedbackLoveBtn' | 'listenBrainzFeedbackHateBtn'>;
    getToken: () => string;
    getTracks: () => Track[];
    getCurrentTrackIndex: () => number;
    ensureTrackTagsResolved: (index: number) => Promise<void>;
    fetchRecordingFeedback: (recordingMbid: string) => Promise<number>;
    submitRecordingFeedback: (recordingMbid: string, score: ListenBrainzFeedbackScore) => Promise<unknown>;
    onFeedbackSubmitted?: (track: Track, score: ListenBrainzFeedbackScore) => Promise<void> | void;
    beforeOpenMenu?: () => void;
};

export type ListenBrainzController = ReturnType<typeof createListenBrainzController>;

const normalizeListenBrainzFeedbackScore = (value: number): ListenBrainzFeedbackScore => {
    if (value === 1 || value === -1) {
        return value;
    }

    return 0;
};

export const createListenBrainzController = (options: ListenBrainzControllerOptions) => {
    const {
        playerCard,
        listenBrainzLoveBtn,
        listenBrainzFeedbackMenu,
        listenBrainzFeedbackLoveBtn,
        listenBrainzFeedbackHateBtn,
    } = options.elements;

    const listenBrainzFeedbackScoreByRecordingMbid = new Map<string, ListenBrainzFeedbackScore>();
    let listenBrainzFeedbackFetchKey = '';
    let listenBrainzFeedbackFetchVersion = 0;
    let listenBrainzFeedbackFetchInFlight = false;
    let listenBrainzFeedbackSubmitInFlight = false;
    let currentListenBrainzFeedbackScore: ListenBrainzFeedbackScore = 0;

    const canScrobble = (): boolean => options.getToken().trim() !== '';

    const currentTrackRecordingMbid = (): string => {
        const currentTrackIndex = options.getCurrentTrackIndex();
        const tracks = options.getTracks();
        if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
            return '';
        }

        return (tracks[currentTrackIndex].mbIds.recordingId || '').trim();
    };

    const updateLoveButton = (): void => {
        const hasToken = canScrobble();
        const recordingMbid = currentTrackRecordingMbid();
        const isLoading = listenBrainzFeedbackSubmitInFlight || listenBrainzFeedbackFetchInFlight;
        const canUseButton = hasToken && recordingMbid !== '' && !isLoading;

        listenBrainzLoveBtn.disabled = false;
        listenBrainzLoveBtn.classList.toggle('is-disabled', !canUseButton);
        listenBrainzLoveBtn.classList.toggle('is-loading', isLoading);
        listenBrainzLoveBtn.setAttribute('aria-disabled', canUseButton ? 'false' : 'true');
        listenBrainzLoveBtn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
        listenBrainzLoveBtn.classList.toggle('is-loved', currentListenBrainzFeedbackScore === 1);
        listenBrainzLoveBtn.classList.toggle('is-hated', currentListenBrainzFeedbackScore === -1);
        listenBrainzLoveBtn.setAttribute('aria-pressed', currentListenBrainzFeedbackScore === 1 ? 'true' : 'false');

        if (isLoading) {
            listenBrainzLoveBtn.title = 'Syncing ListenBrainz feedback...';
        } else if (!hasToken) {
            listenBrainzLoveBtn.title = 'Set a ListenBrainz token in Settings to enable this button.';
        } else if (recordingMbid === '') {
            listenBrainzLoveBtn.title = 'No recording MBID found for this track.';
        } else if (currentListenBrainzFeedbackScore === 1) {
            listenBrainzLoveBtn.title = 'Loved on ListenBrainz. Click to un-love, or right-click for Love/Hate options.';
        } else if (currentListenBrainzFeedbackScore === -1) {
            listenBrainzLoveBtn.title = 'Marked as hated on ListenBrainz. Left-click to submit Love. Right-click for options.';
        } else {
            listenBrainzLoveBtn.title = 'Submit Love on ListenBrainz. Right-click for Love/Hate options.';
        }
    };

    const closeMenu = (): void => {
        listenBrainzFeedbackMenu.hidden = true;
    };

    const openMenu = (clientX: number, clientY: number): void => {
        const canSubmitFeedback = canScrobble() && currentTrackRecordingMbid() !== '' && !listenBrainzFeedbackSubmitInFlight;
        listenBrainzFeedbackLoveBtn.disabled = !canSubmitFeedback;
        listenBrainzFeedbackHateBtn.disabled = !canSubmitFeedback;

        listenBrainzFeedbackMenu.hidden = false;

        const margin = 10;
        const menuRect = listenBrainzFeedbackMenu.getBoundingClientRect();
        const cardRect = playerCard.getBoundingClientRect();

        const relativeX = clientX - cardRect.left;
        const relativeY = clientY - cardRect.top;

        const maxX = Math.max(margin, cardRect.width - menuRect.width - margin);
        const maxY = Math.max(margin, cardRect.height - menuRect.height - margin);

        const clampedX = Math.max(margin, Math.min(relativeX, maxX));
        const clampedY = Math.max(margin, Math.min(relativeY, maxY));

        listenBrainzFeedbackMenu.style.left = `${clampedX}px`;
        listenBrainzFeedbackMenu.style.top = `${clampedY}px`;
    };

    const resetFeedbackState = (): void => {
        listenBrainzFeedbackFetchVersion += 1;
        listenBrainzFeedbackFetchKey = '';
        listenBrainzFeedbackFetchInFlight = false;
        listenBrainzFeedbackSubmitInFlight = false;
        currentListenBrainzFeedbackScore = 0;
        updateLoveButton();
    };

    const refreshFeedbackForCurrentTrack = async (force = false): Promise<void> => {
        const token = options.getToken().trim();
        const recordingMbid = currentTrackRecordingMbid();
        const normalizedRecordingMbid = recordingMbid.toLowerCase();
        const fetchKey = `${token.toLowerCase()}|${normalizedRecordingMbid}`;

        if (!token || recordingMbid === '') {
            listenBrainzFeedbackFetchKey = fetchKey;
            listenBrainzFeedbackFetchInFlight = false;
            currentListenBrainzFeedbackScore = 0;
            updateLoveButton();
            return;
        }

        if (!force && fetchKey === listenBrainzFeedbackFetchKey) {
            listenBrainzFeedbackFetchInFlight = false;
            const cachedScore = listenBrainzFeedbackScoreByRecordingMbid.get(normalizedRecordingMbid);
            if (cachedScore !== undefined) {
                currentListenBrainzFeedbackScore = cachedScore;
                updateLoveButton();
            }
            return;
        }

        listenBrainzFeedbackFetchKey = fetchKey;
        const requestVersion = ++listenBrainzFeedbackFetchVersion;
        const cachedScore = listenBrainzFeedbackScoreByRecordingMbid.get(normalizedRecordingMbid);
        if (cachedScore !== undefined) {
            currentListenBrainzFeedbackScore = cachedScore;
        } else {
            currentListenBrainzFeedbackScore = 0;
        }

        listenBrainzFeedbackFetchInFlight = true;
        updateLoveButton();

        try {
            const score = await options.fetchRecordingFeedback(recordingMbid);
            if (requestVersion !== listenBrainzFeedbackFetchVersion) {
                return;
            }

            const normalizedScore = normalizeListenBrainzFeedbackScore(score);
            listenBrainzFeedbackScoreByRecordingMbid.set(normalizedRecordingMbid, normalizedScore);
            currentListenBrainzFeedbackScore = normalizedScore;
        } catch (error) {
            console.error(error);
        } finally {
            if (requestVersion === listenBrainzFeedbackFetchVersion) {
                listenBrainzFeedbackFetchInFlight = false;
                updateLoveButton();
            }
        }
    };

    const submitFeedbackForTrack = async (trackIndex: number, score: ListenBrainzFeedbackScore): Promise<void> => {
        if (score !== 1 && score !== -1 && score !== 0) {
            return;
        }

        const tracks = options.getTracks();
        if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= tracks.length) {
            updateLoveButton();
            return;
        }

        const token = options.getToken().trim();
        await options.ensureTrackTagsResolved(trackIndex);
        const latestTrack = options.getTracks()[trackIndex];
        const recordingMbid = latestTrack ? (latestTrack.mbIds.recordingId || '').trim() : '';
        if (!token || recordingMbid === '' || listenBrainzFeedbackSubmitInFlight) {
            updateLoveButton();
            return;
        }

        listenBrainzFeedbackSubmitInFlight = true;
        updateLoveButton();

        try {
            await options.submitRecordingFeedback(recordingMbid, score);
            const normalizedRecordingMbid = recordingMbid.toLowerCase();
            listenBrainzFeedbackScoreByRecordingMbid.set(normalizedRecordingMbid, score);
            if (normalizedRecordingMbid === currentTrackRecordingMbid().toLowerCase()) {
                currentListenBrainzFeedbackScore = score;
            }

            if (latestTrack && options.onFeedbackSubmitted) {
                try {
                    await options.onFeedbackSubmitted(latestTrack, score);
                } catch (error) {
                    console.error(error);
                }
            }
        } catch (error) {
            console.error(error);
        } finally {
            listenBrainzFeedbackSubmitInFlight = false;
            updateLoveButton();
        }
    };

    const submitFeedbackForCurrentTrack = async (score: ListenBrainzFeedbackScore): Promise<void> => {
        const currentTrackIndex = options.getCurrentTrackIndex();
        const tracks = options.getTracks();
        if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
            updateLoveButton();
            return;
        }

        await submitFeedbackForTrack(currentTrackIndex, score);
    };

    listenBrainzLoveBtn.addEventListener('click', () => {
        if (listenBrainzLoveBtn.getAttribute('aria-disabled') === 'true') {
            return;
        }

        closeMenu();
        const nextScore: ListenBrainzFeedbackScore = currentListenBrainzFeedbackScore === 1 ? 0 : 1;
        void submitFeedbackForCurrentTrack(nextScore);
    });

    listenBrainzLoveBtn.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (options.beforeOpenMenu) {
            options.beforeOpenMenu();
        }
        openMenu(event.clientX, event.clientY);
    });

    listenBrainzFeedbackLoveBtn.addEventListener('click', () => {
        closeMenu();
        void submitFeedbackForCurrentTrack(1);
    });

    listenBrainzFeedbackHateBtn.addEventListener('click', () => {
        closeMenu();
        void submitFeedbackForCurrentTrack(-1);
    });

    updateLoveButton();

    return {
        canScrobble,
        closeMenu,
        currentTrackRecordingMbid,
        isSubmitInFlight: (): boolean => listenBrainzFeedbackSubmitInFlight,
        openMenu,
        refreshFeedbackForCurrentTrack,
        resetFeedbackState,
        submitFeedbackForCurrentTrack,
        submitFeedbackForTrack,
    };
};