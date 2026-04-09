import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSettingsModalElements, renderSettingsModal } from '../components/overlays/settings-modal';
import { bindSettingsControllerEvents, type SettingsControllerEventContext } from './settings-controller-events';

const createContext = (): SettingsControllerEventContext => {
    document.body.innerHTML = renderSettingsModal();
    const trigger = document.createElement('button');
    document.body.append(trigger);

    return {
        elements: getSettingsModalElements(document),
        options: {
            trigger,
            getValues: vi.fn(),
            selectLibraryFolder: vi.fn(async () => ''),
            selectPlaylistFile: vi.fn(async () => ''),
            save: vi.fn(async () => undefined),
            fetchLastFmSessionKey: vi.fn(async () => ''),
            applyAudioNow: vi.fn(async () => []),
            forceReload: vi.fn(async () => undefined),
            getPlayerCardLayout: vi.fn(() => 'default'),
            setPlayerCardLayout: vi.fn(),
        },
        libraryFolderRepeatClickWindowMs: 400,
        settingsTabScrollStepPx: 160,
        libraryFolders: [],
        selectedLibraryFolderIndex: -1,
        lastLibraryFolderClickIndex: -1,
        lastLibraryFolderClickAt: Number.NEGATIVE_INFINITY,
        favoritePlaylists: [],
        selectedFavoritePlaylistIndex: -1,
        scrobbleRules: [],
        selectedScrobbleRuleIndex: -1,
        lastScrobbleRuleClickIndex: -1,
        lastScrobbleRuleClickAt: Number.NEGATIVE_INFINITY,
        customSendToActions: [],
        selectedCustomSendToActionIndex: -1,
        lastCustomSendToActionClickIndex: -1,
        lastCustomSendToActionClickAt: Number.NEGATIVE_INFINITY,
        coverArtPriorityOrder: ['embedded', 'file', 'musicbrainz'],
        draggedCoverPriorityIndex: -1,
        forceReloadInProgress: false,
        forceReloadEtaSeconds: null,
        lastFmSessionFetchInProgress: false,
        setShortcutAccordionExpanded: vi.fn(),
        setCoverArtPriorityAccordionExpanded: vi.fn(),
        scrollShortcutAccordionIntoView: vi.fn(),
        scrollCoverArtPriorityAccordionIntoView: vi.fn(),
        refreshLastFmSessionFetchButton: vi.fn(),
        refreshMusicBrainzTagWorkerControls: vi.fn(),
        refreshMusicBrainzRateControls: vi.fn(),
        refreshListenBrainzRateControls: vi.fn(),
        refreshEqualizerPositionControls: vi.fn(),
        refreshScrobbleRuleDialogControls: vi.fn(),
        refreshAudioOutputDevices: vi.fn(),
        refreshForceReloadStatus: vi.fn(),
        clearCoverArtDragState: vi.fn(),
        moveCoverArtPriority: vi.fn(),
        setCoverArtPrioritySourceEnabled: vi.fn(),
        doRenderLibraryFolderList: vi.fn(),
        doRenderFavoritePlaylistList: vi.fn(),
        doRenderScrobbleRuleList: vi.fn(),
        doRenderCustomSendToActionList: vi.fn(),
        doRenderCoverArtPriorityList: vi.fn(),
        setSelectedLibraryFolderIndex: vi.fn(),
        setSelectedCustomSendToActionIndex: vi.fn(),
        buildFormValues: vi.fn(() => ({ scrobbleRules: [], audioOutputDevice: 'default' })),
        doOpenLibraryDepthDialog: vi.fn(async () => null),
        doOpenScrobbleRuleDialog: vi.fn(async () => null),
        doOpenSendToActionDialog: vi.fn(async () => null),
        doCloseLibraryDepthDialog: vi.fn(),
        doCloseScrobbleRuleDialog: vi.fn(),
        doCloseSendToActionDialog: vi.fn(),
        editLibraryFolderSettings: vi.fn(async () => false),
        editScrobbleRule: vi.fn(async () => false),
        editCustomSendToAction: vi.fn(async () => false),
        setSettingsStatusMessage: vi.fn(),
        setLibraryDepthStatusMessage: vi.fn(),
        setScrobbleRuleStatusMessage: vi.fn(),
        setSendToActionStatusMessage: vi.fn(),
        requestClose: vi.fn(async () => true),
        finalizeClose: vi.fn(),
        open: vi.fn(),
        setActiveTab: vi.fn(),
        scrollTabsBy: vi.fn(),
        updateTabScrollControls: vi.fn(),
    } as unknown as SettingsControllerEventContext;
};

describe('bindSettingsControllerEvents', () => {
    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    it('opens the settings modal from the trigger supplied in options', () => {
        const context = createContext();
        bindSettingsControllerEvents(context);

        context.options.trigger.click();

        expect(context.open).toHaveBeenCalledTimes(1);
    });

    it('focuses the audio output device when the audio tab is selected', () => {
        const context = createContext();
        bindSettingsControllerEvents(context);

        context.elements.settingsTabAudio.click();

        expect(context.setActiveTab).toHaveBeenCalledWith('audio');
        expect(document.activeElement).toBe(context.elements.settingsAudioOutputDevice);
    });

    it('focuses the first network field when the network tab is selected', () => {
        const context = createContext();
        bindSettingsControllerEvents(context);

        context.elements.settingsTabNetwork.click();

        expect(context.setActiveTab).toHaveBeenCalledWith('network');
        expect(document.activeElement).toBe(context.elements.settingsListenBrainzToken);
    });

    it('toggles the shortcuts accordion when clicking the header outside the tooltip', () => {
        const context = createContext();
        bindSettingsControllerEvents(context);

        const header = context.elements.settingsShortcutAccordionToggle.parentElement as HTMLDivElement;
        header.click();

        expect(context.setShortcutAccordionExpanded).toHaveBeenCalledWith(true);
    });

    it('does not toggle the shortcuts accordion when clicking its tooltip', () => {
        const context = createContext();
        bindSettingsControllerEvents(context);

        const tooltipTrigger = document.querySelector('[aria-label="Show help for Keyboard shortcuts"]');
        expect(tooltipTrigger).not.toBeNull();

        (tooltipTrigger as HTMLButtonElement).click();

        expect(context.setShortcutAccordionExpanded).not.toHaveBeenCalled();
    });
});