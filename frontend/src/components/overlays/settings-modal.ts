export type SettingsModalElements = {
    settingsModal: HTMLDivElement;
    settingsBackdrop: HTMLDivElement;
    settingsClose: HTMLButtonElement;
    settingsTabGeneral: HTMLButtonElement;
    settingsTabPlaylists: HTMLButtonElement;
    settingsPanelGeneral: HTMLDivElement;
    settingsPanelPlaylists: HTMLDivElement;
    settingsBrowse: HTMLButtonElement;
    settingsAddFavoritePlaylist: HTMLButtonElement;
    settingsSave: HTMLButtonElement;
    settingsLibraryPath: HTMLInputElement;
    settingsListenBrainzToken: HTMLInputElement;
    settingsReleaseDepth: HTMLInputElement;
    settingsFavoritePlaylists: HTMLTextAreaElement;
    settingsStatus: HTMLParagraphElement;
};

export const renderSettingsModal = (): string => `
    <div id="settings-modal" class="settings-modal" hidden>
        <div id="settings-backdrop" class="settings-backdrop"></div>
        <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header class="settings-header">
                <p id="settings-title" class="settings-title">Settings</p>
                <button id="settings-close" class="settings-close" type="button" aria-label="Close settings">✕</button>
            </header>
            <div class="settings-content">
                <div class="settings-tabs" role="tablist" aria-label="Settings sections">
                    <button id="settings-tab-general" class="settings-tab is-active" type="button" role="tab" aria-controls="settings-panel-general" aria-selected="true">General</button>
                    <button id="settings-tab-playlists" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-playlists" aria-selected="false">Playlists</button>
                </div>
                <div id="settings-panel-general" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-general">
                    <div class="settings-field">
                        <label class="settings-label" for="settings-library-path">Library Folder</label>
                        <p class="settings-hint">Choose the root library folder Silphium scans for files.</p>
                        <div class="settings-path-row">
                            <input id="settings-library-path" class="settings-input" type="text" placeholder="No folder selected">
                            <button id="settings-browse" class="settings-browse-btn" type="button" aria-label="Choose folder">...</button>
                        </div>
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-listenbrainz-token">ListenBrainz User Token</label>
                        <p class="settings-hint">Used to submit scrobbles to your ListenBrainz account.</p>
                        <input id="settings-listenbrainz-token" class="settings-input" type="password" placeholder="Optional">
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-release-depth">Release Folder Depth</label>
                        <p class="settings-hint">Depth from the library root where each release starts.</p>
                        <input id="settings-release-depth" class="settings-input" type="number" min="1" step="1" inputmode="numeric" placeholder="Optional">
                    </div>
                </div>
                <div id="settings-panel-playlists" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-playlists" hidden>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-favourite-playlists">Favourite Playlists</label>
                        <p class="settings-hint">These playlists will always appear in the playlist modal. One path per line.</p>
                        <textarea id="settings-favourite-playlists" class="settings-input settings-textarea" rows="6" placeholder="C:\\Music\\favourites.m3u8"></textarea>
                        <div class="settings-actions-inline">
                            <button id="settings-add-favorite-playlist" class="settings-inline-btn" type="button">Add from file...</button>
                        </div>
                    </div>
                </div>
                <p id="settings-status" class="settings-status"></p>
                <div class="settings-actions">
                    <button id="settings-save" class="upload-btn" type="button">Save</button>
                </div>
            </div>
        </section>
    </div>
`;

export const getSettingsModalElements = (root: ParentNode): SettingsModalElements => ({
    settingsModal: root.querySelector('#settings-modal') as HTMLDivElement,
    settingsBackdrop: root.querySelector('#settings-backdrop') as HTMLDivElement,
    settingsClose: root.querySelector('#settings-close') as HTMLButtonElement,
    settingsTabGeneral: root.querySelector('#settings-tab-general') as HTMLButtonElement,
    settingsTabPlaylists: root.querySelector('#settings-tab-playlists') as HTMLButtonElement,
    settingsPanelGeneral: root.querySelector('#settings-panel-general') as HTMLDivElement,
    settingsPanelPlaylists: root.querySelector('#settings-panel-playlists') as HTMLDivElement,
    settingsBrowse: root.querySelector('#settings-browse') as HTMLButtonElement,
    settingsAddFavoritePlaylist: root.querySelector('#settings-add-favorite-playlist') as HTMLButtonElement,
    settingsSave: root.querySelector('#settings-save') as HTMLButtonElement,
    settingsLibraryPath: root.querySelector('#settings-library-path') as HTMLInputElement,
    settingsListenBrainzToken: root.querySelector('#settings-listenbrainz-token') as HTMLInputElement,
    settingsReleaseDepth: root.querySelector('#settings-release-depth') as HTMLInputElement,
    settingsFavoritePlaylists: root.querySelector('#settings-favourite-playlists') as HTMLTextAreaElement,
    settingsStatus: root.querySelector('#settings-status') as HTMLParagraphElement,
});