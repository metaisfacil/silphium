export type SettingsModalElements = {
    settingsModal: HTMLDivElement;
    settingsBackdrop: HTMLDivElement;
    settingsClose: HTMLButtonElement;
    settingsTabGeneral: HTMLButtonElement;
    settingsTabPlaylists: HTMLButtonElement;
    settingsTabUi: HTMLButtonElement;
    settingsPanelGeneral: HTMLDivElement;
    settingsPanelPlaylists: HTMLDivElement;
    settingsPanelUi: HTMLDivElement;
    settingsBrowse: HTMLButtonElement;
    settingsFavoritePlaylistList: HTMLUListElement;
    settingsAddFavoritePlaylist: HTMLButtonElement;
    settingsRemoveFavoritePlaylist: HTMLButtonElement;
    settingsForceReload: HTMLButtonElement;
    settingsSave: HTMLButtonElement;
    settingsLibraryPath: HTMLInputElement;
    settingsListenBrainzToken: HTMLInputElement;
    settingsReleaseDepth: HTMLInputElement;
    settingsPreferMusicBrainzMetadata: HTMLInputElement;
    settingsPlayerCardLayout: HTMLSelectElement;
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
                    <button id="settings-tab-ui" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-ui" aria-selected="false">UI</button>
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
                    <div class="settings-field settings-toggle-field">
                        <label class="settings-checkbox-row" for="settings-prefer-musicbrainz-metadata">
                            <input id="settings-prefer-musicbrainz-metadata" class="settings-checkbox" type="checkbox">
                            <span class="settings-label">Prefer MusicBrainz metadata when MBIDs are present</span>
                        </label>
                        <p class="settings-hint">Track labels are replaced on-the-fly by MusicBrainz lookup.</p>
                    </div>
                </div>
                <div id="settings-panel-playlists" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-playlists" hidden>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-favourite-playlist-list">Favourite Playlists</label>
                        <p class="settings-hint">These playlists will always appear in the playlist modal.</p>
                        <ul id="settings-favourite-playlist-list" class="settings-favorite-list" role="listbox" aria-label="Favourite playlists"></ul>
                        <div class="settings-list-actions">
                            <button id="settings-add-favorite-playlist" class="settings-list-btn" type="button" title="Add favourite playlist" aria-label="Add favourite playlist">+</button>
                            <button id="settings-remove-favorite-playlist" class="settings-list-btn" type="button" title="Remove selected favourite playlist" aria-label="Remove selected favourite playlist" disabled>-</button>
                        </div>
                    </div>
                </div>
                <div id="settings-panel-ui" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-ui" hidden>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-player-card-layout">Player Card Layout</label>
                        <p class="settings-hint">Choose how track metadata is arranged on the player card.</p>
                        <select id="settings-player-card-layout" class="settings-input settings-select">
                            <option value="default">Default — Title, Album, Artist</option>
                            <option value="release">Release-Focused — Artist, Cover, Label &amp; Year</option>
                        </select>
                    </div>
                </div>
                <p id="settings-status" class="settings-status"></p>
                <div class="settings-actions">
                    <button id="settings-force-reload" class="settings-secondary-btn" type="button">Force Reload</button>
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
    settingsTabUi: root.querySelector('#settings-tab-ui') as HTMLButtonElement,
    settingsPanelGeneral: root.querySelector('#settings-panel-general') as HTMLDivElement,
    settingsPanelPlaylists: root.querySelector('#settings-panel-playlists') as HTMLDivElement,
    settingsPanelUi: root.querySelector('#settings-panel-ui') as HTMLDivElement,
    settingsBrowse: root.querySelector('#settings-browse') as HTMLButtonElement,
    settingsFavoritePlaylistList: root.querySelector('#settings-favourite-playlist-list') as HTMLUListElement,
    settingsAddFavoritePlaylist: root.querySelector('#settings-add-favorite-playlist') as HTMLButtonElement,
    settingsRemoveFavoritePlaylist: root.querySelector('#settings-remove-favorite-playlist') as HTMLButtonElement,
    settingsForceReload: root.querySelector('#settings-force-reload') as HTMLButtonElement,
    settingsSave: root.querySelector('#settings-save') as HTMLButtonElement,
    settingsLibraryPath: root.querySelector('#settings-library-path') as HTMLInputElement,
    settingsListenBrainzToken: root.querySelector('#settings-listenbrainz-token') as HTMLInputElement,
    settingsReleaseDepth: root.querySelector('#settings-release-depth') as HTMLInputElement,
    settingsPreferMusicBrainzMetadata: root.querySelector('#settings-prefer-musicbrainz-metadata') as HTMLInputElement,
    settingsPlayerCardLayout: root.querySelector('#settings-player-card-layout') as HTMLSelectElement,
    settingsStatus: root.querySelector('#settings-status') as HTMLParagraphElement,
});
