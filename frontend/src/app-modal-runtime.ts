import { AudioWriteReplayGainTags, ReadTextFile } from '../wailsjs/go/main/App';
import type { AppModalRuntimeContext } from './app-runtime-setup';
import { renderTechnicalInfoContent } from './utils/main-helpers';
import {
    lookupMusicBrainzEntity,
    mbidForTrackEntity,
    renderMusicBrainzEntityContent,
} from './utils/musicbrainz-entity-helpers';
import type { MusicBrainzEntityType, TextLibraryFile } from './types/app-types';

export const createAppModalRuntime = (context: AppModalRuntimeContext) => {
    const replayGainTargetPathsForIndex = (trackIndex: number): string[] => {
        const track = context.tracks[trackIndex];
        if (!track) {
            return [];
        }

        const releasePaths = context.replayGainReleaseTrackPathsForIndex(trackIndex);
        if (releasePaths.length > 1) {
            return releasePaths;
        }

        return track.path.trim() ? [track.path] : [];
    };

    const renderTechnicalInfoModalContent = (
        trackIndex: number,
        options: {
            replayGainBusy?: boolean;
            replayGainStatus?: string;
            replayGainStatusTone?: 'pending' | 'success' | 'error';
        } = {},
    ): void => {
        const track = context.tracks[trackIndex];
        if (!track) {
            context.technicalInfoContent.innerHTML = '<p class="technical-info-empty">No technical information available for this track.</p>';
            return;
        }

        const targetPaths = replayGainTargetPathsForIndex(trackIndex);
        const content = document.createElement('div');
        renderTechnicalInfoContent(content, track);

        context.technicalInfoContent.innerHTML = '';

        if (targetPaths.length > 0) {
            const actionSection = document.createElement('section');
            actionSection.className = 'technical-info-action-section';

            const actionCopy = document.createElement('p');
            actionCopy.className = 'technical-info-action-copy';
            actionCopy.textContent = targetPaths.length > 1
                ? `Write track and album ReplayGain tags for this release (${targetPaths.length} files).`
                : 'Write ReplayGain tags for this file.';

            const actionButton = document.createElement('button');
            actionButton.className = 'technical-info-action-btn';
            actionButton.type = 'button';
            actionButton.disabled = !!options.replayGainBusy;
            actionButton.textContent = options.replayGainBusy ? 'Writing ReplayGain Tags…' : 'Write ReplayGain Tags';
            actionButton.addEventListener('click', () => {
                void writeReplayGainTags(trackIndex);
            });

            actionSection.append(actionCopy, actionButton);

            if (options.replayGainStatus) {
                const status = document.createElement('p');
                status.className = `technical-info-action-status is-${options.replayGainStatusTone || 'success'}`;
                status.textContent = options.replayGainStatus;
                actionSection.append(status);
            }

            context.technicalInfoContent.append(actionSection);
        }

        context.technicalInfoContent.append(content);
    };

    const writeReplayGainTags = async (trackIndex: number): Promise<void> => {
        const targetPaths = replayGainTargetPathsForIndex(trackIndex);
        if (targetPaths.length === 0) {
            return;
        }

        renderTechnicalInfoModalContent(trackIndex, {
            replayGainBusy: true,
            replayGainStatus: 'Writing ReplayGain tags…',
            replayGainStatusTone: 'pending',
        });

        try {
            await AudioWriteReplayGainTags(targetPaths);
            await context.trackMetadataService.refreshTrackTags(targetPaths);

            if (trackIndex === context.currentTrackIndex) {
                context.refreshNowPlayingLabel();
                context.libraryController.renderFolder('none');
            }

            renderTechnicalInfoModalContent(trackIndex, {
                replayGainStatus: targetPaths.length > 1
                    ? `ReplayGain tags written for ${targetPaths.length} files.`
                    : 'ReplayGain tags written for this file.',
                replayGainStatusTone: 'success',
            });
        } catch (error) {
            console.error(error);
            const message = error instanceof Error && error.message.trim() !== ''
                ? error.message.trim()
                : 'Unable to write ReplayGain tags.';

            renderTechnicalInfoModalContent(trackIndex, {
                replayGainStatus: message,
                replayGainStatusTone: 'error',
            });
            openErrorModal('ReplayGain Write Failed', message);
        }
    };

    const resetArtistInfoPanel = (): void => {
        context.artistInfoController.reset();
    };

    const hydrateCurrentArtistInfo = async (index: number): Promise<void> => {
        await context.artistInfoController.hydrate(index);
    };

    const setBackgroundCover = (coverSrc?: string): void => {
        const incomingLayer = context.activeBackgroundLayer === 0 ? context.bgLayerB : context.bgLayerA;
        const outgoingLayer = context.activeBackgroundLayer === 0 ? context.bgLayerA : context.bgLayerB;

        if (!coverSrc) {
            context.bgLayerA.classList.remove('is-visible');
            context.bgLayerB.classList.remove('is-visible');
            context.bgLayerA.style.backgroundImage = '';
            context.bgLayerB.style.backgroundImage = '';
            return;
        }

        incomingLayer.style.backgroundImage = `url("${coverSrc}")`;
        incomingLayer.classList.add('is-visible');
        outgoingLayer.classList.remove('is-visible');
        context.activeBackgroundLayer = context.activeBackgroundLayer === 0 ? 1 : 0;
    };

    const hydrateCurrentTrackTag = async (index: number, version: number): Promise<void> => {
        const result = await context.trackMetadataService.hydrateTrack(index, version);
        if (index !== context.currentTrackIndex) {
            return;
        }

        if (result.updatedTags || result.updatedMusicBrainz) {
            context.refreshNowPlayingLabel();
            context.libraryController.renderFolder('none');
            await context.applyCoverArtForTrack(index);
        }

        if (result.updatedTags) {
            context.artistInfoRequestVersion += 1;
            void hydrateCurrentArtistInfo(index);
        }
    };

    const closeTextFileModal = (): void => {
        context.textFileModal.hidden = true;
        context.textFileCode.textContent = '';
    };

    const openTextFileModal = async (textFile: TextLibraryFile): Promise<void> => {
        context.textFileTitle.textContent = textFile.relativePath || textFile.name;
        context.textFileCode.textContent = 'Loading…';
        context.textFileModal.hidden = false;

        try {
            const content = await ReadTextFile(textFile.path);
            context.textFileCode.textContent = content || 'File is empty.';
        } catch (error) {
            console.error(error);
            context.textFileCode.textContent = 'Unable to read this file.';
        }
    };

    const openCoverImageModal = (): void => {
        if (!context.coverArt.classList.contains('is-visible') || !context.coverArt.src) {
            return;
        }

        const activeTrack = context.tracks[context.currentTrackIndex];
        if (!activeTrack) {
            context.imageModalController.openPreview(context.coverArt.src, context.coverArt.src, context.coverArt);
            return;
        }

        const source = context.coverArtService.getResolvedSourceForTrack(activeTrack.path);
        if (source === 'musicbrainz') {
            context.imageModalController.openPreview(
                context.coverArt.src,
                context.coverArtService.getMusicBrainzCoverUrlForTrack(activeTrack) || context.coverArt.src,
                context.coverArt,
            );
            return;
        }

        if (source === 'embedded') {
            context.imageModalController.openPreview(context.coverArt.src, activeTrack.path || context.coverArt.src, context.coverArt);
            return;
        }

        const gallery = context.collectReleaseImageFiles(activeTrack);
        if (gallery.length === 0) {
            context.imageModalController.openPreview(context.coverArt.src, context.coverArt.src, context.coverArt);
            return;
        }

        const coverPath = context.coverArtService.getFolderCoverPath(activeTrack.folderPath || '');
        const selectedIndex = context.indexOfImageByPath(gallery, coverPath);
        void context.imageModalController.openGallery(gallery, selectedIndex >= 0 ? selectedIndex : 0, context.coverArt);
    };

    const closeAboutModal = (): void => {
        context.aboutModal.classList.remove('is-visible');

        if (context.aboutModalHideTimer !== undefined) {
            window.clearTimeout(context.aboutModalHideTimer);
        }

        context.aboutModalHideTimer = window.setTimeout(() => {
            context.aboutModal.hidden = true;
            context.aboutModalHideTimer = undefined;
        }, context.aboutModalTransitionMs);
    };

    const openAboutModal = (): void => {
        if (context.aboutModalHideTimer !== undefined) {
            window.clearTimeout(context.aboutModalHideTimer);
            context.aboutModalHideTimer = undefined;
        }

        context.aboutModal.hidden = false;
        window.requestAnimationFrame(() => {
            context.aboutModal.classList.add('is-visible');
        });
    };

    const closeErrorModal = (): void => {
        context.errorModal.classList.remove('is-visible');

        if (context.errorModalHideTimer !== undefined) {
            window.clearTimeout(context.errorModalHideTimer);
        }

        context.errorModalHideTimer = window.setTimeout(() => {
            context.errorModal.hidden = true;
            context.errorModalHideTimer = undefined;
        }, context.errorModalTransitionMs);
    };

    const openErrorModal = (title: string, message: string): void => {
        if (context.errorModalHideTimer !== undefined) {
            window.clearTimeout(context.errorModalHideTimer);
            context.errorModalHideTimer = undefined;
        }

        context.errorTitle.textContent = title.trim() || 'Error';
        context.errorModalMessage.textContent = message.trim() || 'An unexpected error occurred.';
        context.errorModal.hidden = false;
        window.requestAnimationFrame(() => {
            context.errorModal.classList.add('is-visible');
        });
    };

    const closeMusicBrainzEntityModal = (): void => {
        context.musicBrainzEntityModal.classList.remove('is-visible');

        if (context.musicBrainzEntityModalHideTimer !== undefined) {
            window.clearTimeout(context.musicBrainzEntityModalHideTimer);
        }

        context.musicBrainzEntityModalHideTimer = window.setTimeout(() => {
            context.musicBrainzEntityModal.hidden = true;
            context.musicBrainzEntityModalHideTimer = undefined;
        }, context.musicBrainzEntityModalTransitionMs);
    };

    const animateMusicBrainzDialogResize = (updateContent: () => void): void => {
        const modalVisible = !context.musicBrainzEntityModal.hidden && context.musicBrainzEntityModal.classList.contains('is-visible');
        if (!modalVisible) {
            updateContent();
            return;
        }

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const startRect = context.musicBrainzEntityDialog.getBoundingClientRect();
        const startWidth = Math.ceil(startRect.width);
        const startHeight = Math.ceil(startRect.height);

        updateContent();
        context.musicBrainzEntityDialog.style.width = '';
        context.musicBrainzEntityDialog.style.height = '';

        const targetRect = context.musicBrainzEntityDialog.getBoundingClientRect();
        const targetWidth = Math.ceil(targetRect.width);
        const targetHeight = Math.ceil(targetRect.height);
        if (
            prefersReducedMotion
            || startWidth <= 0
            || startHeight <= 0
            || targetWidth <= 0
            || targetHeight <= 0
            || (Math.abs(targetWidth - startWidth) < 2 && Math.abs(targetHeight - startHeight) < 2)
        ) {
            return;
        }

        const targetContentWidth = Math.ceil(context.musicBrainzEntityContent.getBoundingClientRect().width);
        context.musicBrainzEntityDialog.classList.add('is-resizing');
        context.musicBrainzEntityContent.style.width = `${targetContentWidth}px`;
        context.musicBrainzEntityDialog.style.width = `${startWidth}px`;
        context.musicBrainzEntityDialog.style.height = `${startHeight}px`;
        void context.musicBrainzEntityDialog.offsetWidth;
        context.musicBrainzEntityDialog.style.width = `${targetWidth}px`;
        context.musicBrainzEntityDialog.style.height = `${targetHeight}px`;

        let cleanupTimer: number | undefined;
        const cleanup = (): void => {
            if (cleanupTimer !== undefined) {
                window.clearTimeout(cleanupTimer);
                cleanupTimer = undefined;
            }

            context.musicBrainzEntityDialog.removeEventListener('transitionend', handleTransitionEnd);
            context.musicBrainzEntityDialog.classList.remove('is-resizing');
            context.musicBrainzEntityDialog.style.width = '';
            context.musicBrainzEntityDialog.style.height = '';
            context.musicBrainzEntityContent.style.width = '';
        };

        const handleTransitionEnd = (event: TransitionEvent): void => {
            if (event.target !== context.musicBrainzEntityDialog) {
                return;
            }

            if (event.propertyName !== 'width' && event.propertyName !== 'height') {
                return;
            }

            cleanup();
        };

        context.musicBrainzEntityDialog.addEventListener('transitionend', handleTransitionEnd);
        cleanupTimer = window.setTimeout(cleanup, context.musicBrainzEntityModalTransitionMs + 120);
    };

    const openMusicBrainzEntityForCurrentTrack = async (entityType: MusicBrainzEntityType): Promise<void> => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        const selectedTrackIndex = context.currentTrackIndex;
        await context.ensureTrackTagsResolved(selectedTrackIndex);
        if (selectedTrackIndex < 0 || selectedTrackIndex >= context.tracks.length) {
            return;
        }

        const mbid = mbidForTrackEntity(context.tracks[selectedTrackIndex], entityType).trim();
        if (!mbid) {
            return;
        }

        if (context.musicBrainzEntityModalHideTimer !== undefined) {
            window.clearTimeout(context.musicBrainzEntityModalHideTimer);
            context.musicBrainzEntityModalHideTimer = undefined;
        }

        context.musicBrainzEntityDialog.style.width = '';
        context.musicBrainzEntityDialog.style.height = '';
        context.musicBrainzEntityTitle.textContent = `MusicBrainz ${entityType} info`;
        context.musicBrainzEntityContent.innerHTML = '<p class="mb-entity-empty">Loading from MusicBrainz...</p>';
        context.musicBrainzEntityModal.hidden = false;
        window.requestAnimationFrame(() => {
            context.musicBrainzEntityModal.classList.add('is-visible');
        });

        const entityInfo = await lookupMusicBrainzEntity(entityType, mbid);
        if (!entityInfo.found) {
            animateMusicBrainzDialogResize(() => {
                context.musicBrainzEntityContent.innerHTML = '<p class="mb-entity-empty">No details found for this MusicBrainz ID.</p>';
            });
            return;
        }

        animateMusicBrainzDialogResize(() => {
            renderMusicBrainzEntityContent(entityInfo, context.musicBrainzEntityTitle, context.musicBrainzEntityContent);
        });
    };

    const closeTechnicalInfoModal = (): void => {
        context.technicalInfoModal.classList.remove('is-visible');

        if (context.technicalInfoModalHideTimer !== undefined) {
            window.clearTimeout(context.technicalInfoModalHideTimer);
        }

        context.technicalInfoModalHideTimer = window.setTimeout(() => {
            context.technicalInfoModal.hidden = true;
            context.technicalInfoModalHideTimer = undefined;
        }, context.technicalInfoModalTransitionMs);
    };

    const openTechnicalInfoModal = async (): Promise<void> => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        if (context.technicalInfoModalHideTimer !== undefined) {
            window.clearTimeout(context.technicalInfoModalHideTimer);
            context.technicalInfoModalHideTimer = undefined;
        }

        const selectedTrackIndex = context.currentTrackIndex;
        context.technicalInfoTitle.textContent = 'Technical info';
        context.technicalInfoContent.innerHTML = '<p class="technical-info-empty">Loading technical information...</p>';
        context.technicalInfoModal.hidden = false;
        window.requestAnimationFrame(() => {
            context.technicalInfoModal.classList.add('is-visible');
        });

        await context.ensureTrackTagsResolved(selectedTrackIndex);
        if (selectedTrackIndex >= context.tracks.length) {
            return;
        }

        renderTechnicalInfoModalContent(selectedTrackIndex);
    };

    return {
        closeAboutModal,
        closeErrorModal,
        closeMusicBrainzEntityModal,
        closeTechnicalInfoModal,
        closeTextFileModal,
        hydrateCurrentArtistInfo,
        hydrateCurrentTrackTag,
        openAboutModal,
        openCoverImageModal,
        openErrorModal,
        openMusicBrainzEntityForCurrentTrack,
        openTechnicalInfoModal,
        openTextFileModal,
        resetArtistInfoPanel,
        setBackgroundCover,
    };
};