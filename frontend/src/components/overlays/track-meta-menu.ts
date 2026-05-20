export type TrackMetaMenuElements = {
    trackMetaMenu: HTMLDivElement;
    trackMetaCopyFilePathBtn: HTMLButtonElement;
    trackMetaCopyFolderPathBtn: HTMLButtonElement;
    trackMetaCopyDivider: HTMLHRElement;
    trackMetaSendToDivider: HTMLHRElement;
    trackMetaSendToList: HTMLDivElement;
    trackMetaFilterArtistBtn: HTMLButtonElement;
    trackMetaArtistDivider: HTMLHRElement;
    trackMetaOpenMbBtn: HTMLButtonElement;
    trackMetaParentFolderBtn: HTMLButtonElement;
    trackMetaBrowserFolderBtn: HTMLButtonElement;
};

export const renderTrackMetaMenu = (): string => `
    <div id="track-meta-menu" class="track-meta-menu" role="menu" aria-label="Track metadata options" hidden>
    <button id="track-meta-copy-file-path-btn" class="track-meta-menu-item" type="button" role="menuitem">Copy file path</button>
    <button id="track-meta-copy-folder-path-btn" class="track-meta-menu-item" type="button" role="menuitem">Copy folder path</button>
    <hr id="track-meta-copy-divider" class="track-meta-menu-divider" role="separator">
    <button id="track-meta-filter-artist-btn" class="track-meta-menu-item" type="button" role="menuitem" hidden>Filter artist in sidebar</button>
    <hr id="track-meta-artist-divider" class="track-meta-menu-divider" role="separator" hidden>
    <button id="track-meta-parent-folder-btn" class="track-meta-menu-item" type="button" role="menuitem">Open folder in sidebar</button>
    <button id="track-meta-browser-folder-btn" class="track-meta-menu-item" type="button" role="menuitem">Open folder in browser</button>
    <hr id="track-meta-send-to-divider" class="track-meta-menu-divider" role="separator" hidden>
    <div id="track-meta-send-to-list"></div>
    <button id="track-meta-open-mb-btn" class="track-meta-menu-item" type="button" role="menuitem">Open in MusicBrainz</button>
    </div>
`;

export const getTrackMetaMenuElements = (root: ParentNode): TrackMetaMenuElements => ({
    trackMetaMenu: root.querySelector('#track-meta-menu') as HTMLDivElement,
    trackMetaCopyFilePathBtn: root.querySelector('#track-meta-copy-file-path-btn') as HTMLButtonElement,
    trackMetaCopyFolderPathBtn: root.querySelector('#track-meta-copy-folder-path-btn') as HTMLButtonElement,
    trackMetaCopyDivider: root.querySelector('#track-meta-copy-divider') as HTMLHRElement,
    trackMetaSendToDivider: root.querySelector('#track-meta-send-to-divider') as HTMLHRElement,
    trackMetaSendToList: root.querySelector('#track-meta-send-to-list') as HTMLDivElement,
    trackMetaFilterArtistBtn: root.querySelector('#track-meta-filter-artist-btn') as HTMLButtonElement,
    trackMetaArtistDivider: root.querySelector('#track-meta-artist-divider') as HTMLHRElement,
    trackMetaOpenMbBtn: root.querySelector('#track-meta-open-mb-btn') as HTMLButtonElement,
    trackMetaParentFolderBtn: root.querySelector('#track-meta-parent-folder-btn') as HTMLButtonElement,
    trackMetaBrowserFolderBtn: root.querySelector('#track-meta-browser-folder-btn') as HTMLButtonElement,
});