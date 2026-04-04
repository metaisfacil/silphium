export type SettingsModalElements = {
    settingsModal: HTMLDivElement;
    settingsBackdrop: HTMLDivElement;
    settingsClose: HTMLButtonElement;
    settingsTabGeneral: HTMLButtonElement;
    settingsTabPlaylists: HTMLButtonElement;
    settingsTabUi: HTMLButtonElement;
    settingsTabShortcuts: HTMLButtonElement;
    settingsPanelGeneral: HTMLDivElement;
    settingsPanelPlaylists: HTMLDivElement;
    settingsPanelUi: HTMLDivElement;
    settingsPanelShortcuts: HTMLDivElement;
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
    settingsShortcutPlayPauseToggle: HTMLInputElement;
    settingsShortcutNextTrack: HTMLInputElement;
    settingsShortcutPreviousTrack: HTMLInputElement;
    settingsShortcutStopPlayback: HTMLInputElement;
    settingsShortcutFocusLibraryFilter: HTMLInputElement;
    settingsShortcutOpenSettings: HTMLInputElement;
    settingsStatus: HTMLParagraphElement;
};

export const renderSettingsModal = (): string => `
    <div id="settings-modal" class="settings-modal" hidden>
        <div id="settings-backdrop" class="settings-backdrop"></div>
        <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header class="settings-header">
                <p id="settings-title" class="settings-title">Settings</p>
                <button id="settings-close" class="settings-close" type="button" aria-label="Close settings"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg></button>
            </header>
            <div class="settings-content">
                <div class="settings-tabs" role="tablist" aria-label="Settings sections">
                    <button id="settings-tab-general" class="settings-tab is-active" type="button" role="tab" aria-controls="settings-panel-general" aria-selected="true">General</button>
                    <button id="settings-tab-playlists" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-playlists" aria-selected="false">Playlists</button>
                    <button id="settings-tab-ui" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-ui" aria-selected="false">UI</button>
                    <button id="settings-tab-shortcuts" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-shortcuts" aria-selected="false">Shortcuts</button>
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
                            <option value="default">Default — Title, album, artist</option>
                            <option value="release">Release-focused — Artist, cover, label &amp; year</option>
                        </select>
                    </div>
                </div>
                <div id="settings-panel-shortcuts" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-shortcuts" hidden>
                    <p class="settings-hint">Click a field and press a key combination. Use Delete to clear.</p>
                    <div class="settings-shortcuts-grid">
                        <div class="settings-field">
                            <label class="settings-label" for="settings-shortcut-play-pause">Play/Pause toggle</label>
                            <input id="settings-shortcut-play-pause" class="settings-input" type="text" readonly spellcheck="false" placeholder="Space">
                        </div>
                        <div class="settings-field">
                            <label class="settings-label" for="settings-shortcut-next-track">Next track</label>
                            <input id="settings-shortcut-next-track" class="settings-input" type="text" readonly spellcheck="false" placeholder="N">
                        </div>
                        <div class="settings-field">
                            <label class="settings-label" for="settings-shortcut-previous-track">Previous track</label>
                            <input id="settings-shortcut-previous-track" class="settings-input" type="text" readonly spellcheck="false" placeholder="P">
                        </div>
                        <div class="settings-field">
                            <label class="settings-label" for="settings-shortcut-stop-playback">Stop playback</label>
                            <input id="settings-shortcut-stop-playback" class="settings-input" type="text" readonly spellcheck="false" placeholder="Z">
                        </div>
                        <div class="settings-field">
                            <label class="settings-label" for="settings-shortcut-focus-library-filter">Focus library filter</label>
                            <input id="settings-shortcut-focus-library-filter" class="settings-input" type="text" readonly spellcheck="false" placeholder="Ctrl+F">
                        </div>
                        <div class="settings-field">
                            <label class="settings-label" for="settings-shortcut-open-settings">Open settings modal</label>
                            <input id="settings-shortcut-open-settings" class="settings-input" type="text" readonly spellcheck="false" placeholder="Ctrl+P">
                        </div>
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
    settingsTabShortcuts: root.querySelector('#settings-tab-shortcuts') as HTMLButtonElement,
    settingsPanelGeneral: root.querySelector('#settings-panel-general') as HTMLDivElement,
    settingsPanelPlaylists: root.querySelector('#settings-panel-playlists') as HTMLDivElement,
    settingsPanelUi: root.querySelector('#settings-panel-ui') as HTMLDivElement,
    settingsPanelShortcuts: root.querySelector('#settings-panel-shortcuts') as HTMLDivElement,
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
    settingsShortcutPlayPauseToggle: root.querySelector('#settings-shortcut-play-pause') as HTMLInputElement,
    settingsShortcutNextTrack: root.querySelector('#settings-shortcut-next-track') as HTMLInputElement,
    settingsShortcutPreviousTrack: root.querySelector('#settings-shortcut-previous-track') as HTMLInputElement,
    settingsShortcutStopPlayback: root.querySelector('#settings-shortcut-stop-playback') as HTMLInputElement,
    settingsShortcutFocusLibraryFilter: root.querySelector('#settings-shortcut-focus-library-filter') as HTMLInputElement,
    settingsShortcutOpenSettings: root.querySelector('#settings-shortcut-open-settings') as HTMLInputElement,
    settingsStatus: root.querySelector('#settings-status') as HTMLParagraphElement,
});
