export type SettingsModalElements = {
    settingsModal: HTMLDivElement;
    settingsBackdrop: HTMLDivElement;
    settingsClose: HTMLButtonElement;
    settingsTabGeneral: HTMLButtonElement;
    settingsTabPlaylists: HTMLButtonElement;
    settingsTabAudio: HTMLButtonElement;
    settingsTabUi: HTMLButtonElement;
    settingsTabShortcuts: HTMLButtonElement;
    settingsPanelGeneral: HTMLDivElement;
    settingsPanelPlaylists: HTMLDivElement;
    settingsPanelAudio: HTMLDivElement;
    settingsPanelUi: HTMLDivElement;
    settingsPanelShortcuts: HTMLDivElement;
    settingsLibraryFolderList: HTMLUListElement;
    settingsAddLibraryFolder: HTMLButtonElement;
    settingsRemoveLibraryFolder: HTMLButtonElement;
    settingsFavoritePlaylistList: HTMLUListElement;
    settingsAddFavoritePlaylist: HTMLButtonElement;
    settingsRemoveFavoritePlaylist: HTMLButtonElement;
    settingsForceReload: HTMLButtonElement;
    settingsSave: HTMLButtonElement;
    settingsLibraryDepthModal: HTMLDivElement;
    settingsLibraryDepthBackdrop: HTMLDivElement;
    settingsLibraryDepthForm: HTMLFormElement;
    settingsLibraryDepthTitle: HTMLParagraphElement;
    settingsLibraryDepthLabelInput: HTMLInputElement;
    settingsLibraryDepthInput: HTMLInputElement;
    settingsLibraryDepthStatus: HTMLParagraphElement;
    settingsLibraryDepthCancel: HTMLButtonElement;
    settingsLibraryDepthConfirm: HTMLButtonElement;
    settingsListenBrainzToken: HTMLInputElement;
    settingsAudioOutputDevice: HTMLSelectElement;
    settingsAudioOutputBufferMs: HTMLInputElement;
    settingsApplyAudioNow: HTMLButtonElement;
    settingsGaplessPlayback: HTMLInputElement;
    settingsReplayGain: HTMLInputElement;
    settingsPreferMusicBrainzMetadata: HTMLInputElement;
    settingsPlayerCardLayout: HTMLSelectElement;
    settingsCoverArtPriorityList: HTMLUListElement;
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
                    <button id="settings-tab-audio" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-audio" aria-selected="false">Audio</button>
                    <button id="settings-tab-ui" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-ui" aria-selected="false">UI</button>
                    <button id="settings-tab-shortcuts" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-shortcuts" aria-selected="false">Shortcuts</button>
                </div>
                <div id="settings-panel-general" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-general">
                    <div class="settings-field">
                        <label class="settings-label" for="settings-library-folder-list">Library Folders</label>
                        <p class="settings-hint">Add one or more library roots. A folder settings dialog opens after adding a folder, and you can double-click an existing entry to change its label or release depth.</p>
                        <ul id="settings-library-folder-list" class="settings-library-folder-list" role="listbox" aria-label="Library folders" tabindex="0"></ul>
                        <div class="settings-list-actions">
                            <button id="settings-add-library-folder" class="settings-list-btn" type="button" title="Add library folder" aria-label="Add library folder">+</button>
                            <button id="settings-remove-library-folder" class="settings-list-btn" type="button" title="Remove selected library folder" aria-label="Remove selected library folder" disabled>-</button>
                        </div>
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-listenbrainz-token">ListenBrainz User Token</label>
                        <p class="settings-hint">Used to submit scrobbles to your ListenBrainz account.</p>
                        <input id="settings-listenbrainz-token" class="settings-input" type="password" placeholder="Optional">
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
                <div id="settings-panel-audio" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-audio" hidden>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-audio-output-device">Audio Output Device</label>
                        <div class="settings-audio-device-row">
                            <select id="settings-audio-output-device" class="settings-input settings-select"></select>
                            <button id="settings-apply-audio-now" class="settings-secondary-btn settings-audio-apply-btn" type="button" title="Refresh the device list and reload audio-related app state without restarting." aria-label="Refresh Audio Settings"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M20 5V10H15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19V14H9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.6 9.2C7.6 7.2 9.6 6 12 6C14.4 6 16.4 7.1 17.5 8.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.4 14.8C16.4 16.8 14.4 18 12 18C9.6 18 7.6 16.9 6.5 15.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                        </div>
                        <p class="settings-hint">Choose the output device used when the audio backend initializes.<br>Use the refresh button to rescan devices and reload audio-related state without restarting.</p>
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-audio-output-buffer-ms">Audio Output Buffer (ms)</label>
                        <p class="settings-hint">0 uses driver default. Higher values may reduce crackling but increase latency.<br>Applied on next app launch.</p>
                        <input id="settings-audio-output-buffer-ms" class="settings-input" type="number" min="0" max="1000" step="1" inputmode="numeric" placeholder="0">
                    </div>
                    <div class="settings-field settings-toggle-field">
                        <label class="settings-checkbox-row" for="settings-gapless-playback">
                            <input id="settings-gapless-playback" class="settings-checkbox" type="checkbox">
                            <span class="settings-label">Enable gapless playback</span>
                        </label>
                        <p class="settings-hint">When supported, trims encoder delay/padding and prequeues the next track for seamless transitions.</p>
                    </div>
                    <div class="settings-field settings-toggle-field">
                        <label class="settings-checkbox-row" for="settings-replaygain">
                            <input id="settings-replaygain" class="settings-checkbox" type="checkbox">
                            <span class="settings-label">Enable ReplayGain</span>
                        </label>
                        <p class="settings-hint">Reads ReplayGain tags when present and scans tracks without them before playback. The gain is applied before the volume slider and never written back to files.</p>
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
                    <div class="settings-field">
                        <label class="settings-label" for="settings-cover-art-priority-list">Cover Art Source Priority</label>
                        <p class="settings-hint">Check sources to enable them, then drag to reorder priority. Top enabled entry is tried first. Separate cover files are preferred by default.</p>
                        <ul id="settings-cover-art-priority-list" class="settings-priority-list" role="listbox" aria-label="Cover art source priority"></ul>
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
        <div id="settings-library-depth-modal" class="settings-submodal" hidden>
            <div id="settings-library-depth-backdrop" class="settings-submodal-backdrop"></div>
            <form id="settings-library-depth-form" class="settings-subdialog" role="dialog" aria-modal="true" aria-labelledby="settings-library-depth-title">
                <p id="settings-library-depth-title" class="settings-subdialog-title">Library Folder Settings</p>
                <div class="settings-field">
                    <label class="settings-label" for="settings-library-depth-label-input">Custom Label</label>
                    <p class="settings-hint">Overrides the name shown for this library in the app.<br>Leave blank to use the folder name.</p>
                    <input id="settings-library-depth-label-input" class="settings-input" type="text" maxlength="120" placeholder="Optional">
                </div>
                <div class="settings-field">
                    <label class="settings-label" for="settings-library-depth-input">Release Folder Depth</label>
                    <p class="settings-hint">Enter how many folder levels below this library root a release begins.<br>Use 0 to treat the whole folder as one release.</p>
                    <input id="settings-library-depth-input" class="settings-input" type="number" min="0" step="1" inputmode="numeric" placeholder="0">
                </div>
                <p id="settings-library-depth-status" class="settings-subdialog-status" aria-live="polite"></p>
                <div class="settings-subdialog-actions">
                    <button id="settings-library-depth-cancel" class="settings-secondary-btn" type="button">Cancel</button>
                    <button id="settings-library-depth-confirm" class="upload-btn" type="submit">Apply</button>
                </div>
            </form>
        </div>
    </div>
`;

export const getSettingsModalElements = (root: ParentNode): SettingsModalElements => ({
    settingsModal: root.querySelector('#settings-modal') as HTMLDivElement,
    settingsBackdrop: root.querySelector('#settings-backdrop') as HTMLDivElement,
    settingsClose: root.querySelector('#settings-close') as HTMLButtonElement,
    settingsTabGeneral: root.querySelector('#settings-tab-general') as HTMLButtonElement,
    settingsTabPlaylists: root.querySelector('#settings-tab-playlists') as HTMLButtonElement,
    settingsTabAudio: root.querySelector('#settings-tab-audio') as HTMLButtonElement,
    settingsTabUi: root.querySelector('#settings-tab-ui') as HTMLButtonElement,
    settingsTabShortcuts: root.querySelector('#settings-tab-shortcuts') as HTMLButtonElement,
    settingsPanelGeneral: root.querySelector('#settings-panel-general') as HTMLDivElement,
    settingsPanelPlaylists: root.querySelector('#settings-panel-playlists') as HTMLDivElement,
    settingsPanelAudio: root.querySelector('#settings-panel-audio') as HTMLDivElement,
    settingsPanelUi: root.querySelector('#settings-panel-ui') as HTMLDivElement,
    settingsPanelShortcuts: root.querySelector('#settings-panel-shortcuts') as HTMLDivElement,
    settingsLibraryFolderList: root.querySelector('#settings-library-folder-list') as HTMLUListElement,
    settingsAddLibraryFolder: root.querySelector('#settings-add-library-folder') as HTMLButtonElement,
    settingsRemoveLibraryFolder: root.querySelector('#settings-remove-library-folder') as HTMLButtonElement,
    settingsFavoritePlaylistList: root.querySelector('#settings-favourite-playlist-list') as HTMLUListElement,
    settingsAddFavoritePlaylist: root.querySelector('#settings-add-favorite-playlist') as HTMLButtonElement,
    settingsRemoveFavoritePlaylist: root.querySelector('#settings-remove-favorite-playlist') as HTMLButtonElement,
    settingsForceReload: root.querySelector('#settings-force-reload') as HTMLButtonElement,
    settingsSave: root.querySelector('#settings-save') as HTMLButtonElement,
    settingsLibraryDepthModal: root.querySelector('#settings-library-depth-modal') as HTMLDivElement,
    settingsLibraryDepthBackdrop: root.querySelector('#settings-library-depth-backdrop') as HTMLDivElement,
    settingsLibraryDepthForm: root.querySelector('#settings-library-depth-form') as HTMLFormElement,
    settingsLibraryDepthTitle: root.querySelector('#settings-library-depth-title') as HTMLParagraphElement,
    settingsLibraryDepthLabelInput: root.querySelector('#settings-library-depth-label-input') as HTMLInputElement,
    settingsLibraryDepthInput: root.querySelector('#settings-library-depth-input') as HTMLInputElement,
    settingsLibraryDepthStatus: root.querySelector('#settings-library-depth-status') as HTMLParagraphElement,
    settingsLibraryDepthCancel: root.querySelector('#settings-library-depth-cancel') as HTMLButtonElement,
    settingsLibraryDepthConfirm: root.querySelector('#settings-library-depth-confirm') as HTMLButtonElement,
    settingsListenBrainzToken: root.querySelector('#settings-listenbrainz-token') as HTMLInputElement,
    settingsAudioOutputDevice: root.querySelector('#settings-audio-output-device') as HTMLSelectElement,
    settingsAudioOutputBufferMs: root.querySelector('#settings-audio-output-buffer-ms') as HTMLInputElement,
    settingsApplyAudioNow: root.querySelector('#settings-apply-audio-now') as HTMLButtonElement,
    settingsGaplessPlayback: root.querySelector('#settings-gapless-playback') as HTMLInputElement,
    settingsReplayGain: root.querySelector('#settings-replaygain') as HTMLInputElement,
    settingsPreferMusicBrainzMetadata: root.querySelector('#settings-prefer-musicbrainz-metadata') as HTMLInputElement,
    settingsPlayerCardLayout: root.querySelector('#settings-player-card-layout') as HTMLSelectElement,
    settingsCoverArtPriorityList: root.querySelector('#settings-cover-art-priority-list') as HTMLUListElement,
    settingsShortcutPlayPauseToggle: root.querySelector('#settings-shortcut-play-pause') as HTMLInputElement,
    settingsShortcutNextTrack: root.querySelector('#settings-shortcut-next-track') as HTMLInputElement,
    settingsShortcutPreviousTrack: root.querySelector('#settings-shortcut-previous-track') as HTMLInputElement,
    settingsShortcutStopPlayback: root.querySelector('#settings-shortcut-stop-playback') as HTMLInputElement,
    settingsShortcutFocusLibraryFilter: root.querySelector('#settings-shortcut-focus-library-filter') as HTMLInputElement,
    settingsShortcutOpenSettings: root.querySelector('#settings-shortcut-open-settings') as HTMLInputElement,
    settingsStatus: root.querySelector('#settings-status') as HTMLParagraphElement,
});
