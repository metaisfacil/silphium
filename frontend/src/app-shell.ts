import { getMediaControlsElements, renderMediaControls } from './components/media-controls';
import { getSidebarElements, renderSidebar } from './components/sidebar';
import {
    getAboutModalElements,
    getErrorModalElements,
    getImageFileModalElements,
    getMusicBrainzEntityModalElements,
    getPlayOrderMenuElements,
    getPlaylistMenuElements,
    getPlaylistModalElements,
    getPlaylistTargetModalElements,
    getQueueConfirmModalElements,
    getShareModalElements,
    getSidebarQueueMenuElements,
    getSettingsModalElements,
    getTechnicalInfoModalElements,
    getTextFileModalElements,
    getTrackMetaMenuElements,
    renderAboutModal,
    renderErrorModal,
    renderImageFileModal,
    renderMusicBrainzEntityModal,
    renderPlayOrderMenu,
    renderPlaylistMenu,
    renderPlaylistModal,
    renderPlaylistTargetModal,
    renderQueueConfirmModal,
    renderShareModal,
    renderSidebarQueueMenu,
    renderSettingsModal,
    renderTechnicalInfoModal,
    renderTextFileModal,
    renderTrackMetaMenu,
} from './components/overlays';

export const renderAppShell = (app: HTMLElement): void => {
    app.innerHTML = `
        <div class="bg-stage" aria-hidden="true">
            <div id="bg-layer-a" class="bg-layer"></div>
            <div id="bg-layer-b" class="bg-layer"></div>
        </div>
        ${renderSidebar()}
        ${renderMediaControls()}
        ${renderAboutModal()}
        ${renderErrorModal()}
        ${renderQueueConfirmModal()}
        ${renderTextFileModal()}
        ${renderImageFileModal()}
        ${renderMusicBrainzEntityModal()}
        ${renderTechnicalInfoModal()}
        ${renderSettingsModal()}
        ${renderShareModal()}
        ${renderPlayOrderMenu()}
        ${renderTrackMetaMenu()}
        ${renderSidebarQueueMenu()}
        ${renderPlaylistMenu()}
        ${renderPlaylistTargetModal()}
        ${renderPlaylistModal()}
`;
};

export const getAppShellElements = (document: Document) => {
    const sidebarElements = getSidebarElements(document);
    const mediaControlsElements = getMediaControlsElements(document);
    const aboutModalElements = getAboutModalElements(document);
    const errorModalElements = getErrorModalElements(document);
    const queueConfirmModalElements = getQueueConfirmModalElements(document);
    const textFileModalElements = getTextFileModalElements(document);
    const imageModalElements = getImageFileModalElements(document);
    const musicBrainzEntityModalElements = getMusicBrainzEntityModalElements(document);
    const technicalInfoModalElements = getTechnicalInfoModalElements(document);
    const settingsElements = getSettingsModalElements(document);
    const shareModalElements = getShareModalElements(document);
    const playOrderMenuElements = getPlayOrderMenuElements(document);
    const trackMetaMenuElements = getTrackMetaMenuElements(document);
    const sidebarQueueMenuElements = getSidebarQueueMenuElements(document);
    const playlistMenuElements = getPlaylistMenuElements(document);
    const playlistTargetModalElements = getPlaylistTargetModalElements(document);
    const playlistModalElements = getPlaylistModalElements(document);

    return {
        ...sidebarElements,
        ...mediaControlsElements,
        bgLayerA: document.getElementById('bg-layer-a') as HTMLDivElement,
        bgLayerB: document.getElementById('bg-layer-b') as HTMLDivElement,
        aboutModal: aboutModalElements.aboutModal,
        aboutBackdrop: aboutModalElements.aboutBackdrop,
        aboutClose: aboutModalElements.aboutClose,
        aboutVersion: aboutModalElements.aboutVersion,
        aboutRepoLink: aboutModalElements.aboutRepoLink,
        errorModal: errorModalElements.errorModal,
        errorBackdrop: errorModalElements.errorBackdrop,
        errorTitle: errorModalElements.errorTitle,
        errorModalMessage: errorModalElements.errorMessage,
        errorClose: errorModalElements.errorClose,
        errorOk: errorModalElements.errorOk,
        queueConfirmModal: queueConfirmModalElements.queueConfirmModal,
        queueConfirmBackdrop: queueConfirmModalElements.queueConfirmBackdrop,
        queueConfirmTitle: queueConfirmModalElements.queueConfirmTitle,
        queueConfirmMessage: queueConfirmModalElements.queueConfirmMessage,
        queueConfirmCancel: queueConfirmModalElements.queueConfirmCancel,
        queueConfirmProceed: queueConfirmModalElements.queueConfirmProceed,
        textFileModal: textFileModalElements.textFileModal,
        textFileBackdrop: textFileModalElements.textFileBackdrop,
        textFileTitle: textFileModalElements.textFileTitle,
        textFileCode: textFileModalElements.textFileCode,
        textFileClose: textFileModalElements.textFileClose,
        imageModalElements,
        musicBrainzEntityModal: musicBrainzEntityModalElements.musicBrainzEntityModal,
        musicBrainzEntityBackdrop: musicBrainzEntityModalElements.musicBrainzEntityBackdrop,
        musicBrainzEntityDialog: musicBrainzEntityModalElements.musicBrainzEntityDialog,
        musicBrainzEntityTitle: musicBrainzEntityModalElements.musicBrainzEntityTitle,
        musicBrainzEntityContent: musicBrainzEntityModalElements.musicBrainzEntityContent,
        musicBrainzEntityClose: musicBrainzEntityModalElements.musicBrainzEntityClose,
        technicalInfoModal: technicalInfoModalElements.technicalInfoModal,
        technicalInfoBackdrop: technicalInfoModalElements.technicalInfoBackdrop,
        technicalInfoTitle: technicalInfoModalElements.technicalInfoTitle,
        technicalInfoContent: technicalInfoModalElements.technicalInfoContent,
        technicalInfoClose: technicalInfoModalElements.technicalInfoClose,
        settingsElements,
        shareModal: shareModalElements.shareModal,
        shareBackdrop: shareModalElements.shareBackdrop,
        shareDialog: shareModalElements.shareDialog,
        shareClose: shareModalElements.shareClose,
        sharePreview: shareModalElements.sharePreview,
        shareStreamingLinksRegion: shareModalElements.shareStreamingLinksRegion,
        shareStreamingLinks: shareModalElements.shareStreamingLinks,
        shareCommentInput: shareModalElements.shareCommentInput,
        shareStatus: shareModalElements.shareStatus,
        shareSave: shareModalElements.shareSave,
        shareCopy: shareModalElements.shareCopy,
        playOrderMenu: playOrderMenuElements.playOrderMenu,
        ...trackMetaMenuElements,
        ...sidebarQueueMenuElements,
        playlistMenuElements,
        playlistTargetModalElements,
        playlistModalElements,
    };
};
