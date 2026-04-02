export type TrackMetaMenuElements = {
    trackMetaMenu: HTMLDivElement;
    trackMetaOpenMbBtn: HTMLButtonElement;
    trackMetaParentFolderBtn: HTMLButtonElement;
};

export const renderTrackMetaMenu = (): string => `
    <div id="track-meta-menu" class="track-meta-menu" role="menu" aria-label="Track metadata options" hidden>
    <button id="track-meta-parent-folder-btn" class="track-meta-menu-item" type="button" role="menuitem">Open containing folder</button>
        <button id="track-meta-open-mb-btn" class="track-meta-menu-item" type="button" role="menuitem">Open in MusicBrainz</button>
    </div>
`;

export const getTrackMetaMenuElements = (root: ParentNode): TrackMetaMenuElements => ({
    trackMetaMenu: root.querySelector('#track-meta-menu') as HTMLDivElement,
    trackMetaOpenMbBtn: root.querySelector('#track-meta-open-mb-btn') as HTMLButtonElement,
    trackMetaParentFolderBtn: root.querySelector('#track-meta-parent-folder-btn') as HTMLButtonElement,
});