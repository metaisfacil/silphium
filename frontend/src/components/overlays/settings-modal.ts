export type SettingsModalElements = {
    settingsModal: HTMLDivElement;
    settingsBackdrop: HTMLDivElement;
    settingsClose: HTMLButtonElement;
    settingsTabGeneral: HTMLButtonElement;
    settingsTabNetwork: HTMLButtonElement;
    settingsTabDatabase: HTMLButtonElement;
    settingsTabPlaylists: HTMLButtonElement;
    settingsTabScrobbling: HTMLButtonElement;
    settingsTabAudio: HTMLButtonElement;
    settingsTabUi: HTMLButtonElement;
    settingsPanelGeneral: HTMLDivElement;
    settingsPanelNetwork: HTMLDivElement;
    settingsPanelDatabase: HTMLDivElement;
    settingsPanelPlaylists: HTMLDivElement;
    settingsPanelScrobbling: HTMLDivElement;
    settingsPanelAudio: HTMLDivElement;
    settingsPanelUi: HTMLDivElement;
    settingsShortcutAccordionToggle: HTMLButtonElement;
    settingsShortcutAccordionPanel: HTMLDivElement;
    settingsLibraryFolderList: HTMLUListElement;
    settingsAddLibraryFolder: HTMLButtonElement;
    settingsRemoveLibraryFolder: HTMLButtonElement;
    settingsFavoritePlaylistList: HTMLUListElement;
    settingsAddFavoritePlaylist: HTMLButtonElement;
    settingsRemoveFavoritePlaylist: HTMLButtonElement;
    settingsScrobbleFilterMode: HTMLSelectElement;
    settingsScrobbleRuleList: HTMLUListElement;
    settingsAddScrobbleRule: HTMLButtonElement;
    settingsRemoveScrobbleRule: HTMLButtonElement;
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
    settingsScrobbleRuleModal: HTMLDivElement;
    settingsScrobbleRuleBackdrop: HTMLDivElement;
    settingsScrobbleRuleForm: HTMLFormElement;
    settingsScrobbleRuleTitle: HTMLParagraphElement;
    settingsScrobbleRuleField: HTMLSelectElement;
    settingsScrobbleRuleOperator: HTMLSelectElement;
    settingsScrobbleRuleValueLabel: HTMLLabelElement;
    settingsScrobbleRuleValue: HTMLInputElement;
    settingsScrobbleRuleHint: HTMLParagraphElement;
    settingsScrobbleRuleStatus: HTMLParagraphElement;
    settingsScrobbleRuleCancel: HTMLButtonElement;
    settingsScrobbleRuleConfirm: HTMLButtonElement;
    settingsFFmpegPath: HTMLInputElement;
    settingsListenBrainzToken: HTMLInputElement;
    settingsMusicBrainzServerUrl: HTMLInputElement;
    settingsMusicBrainzRequestRateMs: HTMLInputElement;
    settingsListenBrainzServerUrl: HTMLInputElement;
    settingsListenBrainzRequestRateMs: HTMLInputElement;
    settingsAudioOutputDevice: HTMLSelectElement;
    settingsAudioOutputBufferMs: HTMLInputElement;
    settingsApplyAudioNow: HTMLButtonElement;
    settingsGaplessPlayback: HTMLInputElement;
    settingsReplayGain: HTMLInputElement;
    settingsPreferMusicBrainzMetadata: HTMLInputElement;
    settingsMusicBrainzTagDatabaseEnabled: HTMLInputElement;
    settingsMusicBrainzTagStaleDays: HTMLInputElement;
    settingsMusicBrainzTagRequestStaggeringEnabled: HTMLInputElement;
    settingsMusicBrainzTagWorkerCores: HTMLInputElement;
    settingsMusicBrainzTagWorkerProgressBar: HTMLDivElement;
    settingsMusicBrainzTagWorkerProgressFill: HTMLSpanElement;
    settingsMusicBrainzTagWorkerProgressValue: HTMLSpanElement;
    settingsMusicBrainzTagWorkerProgressRemaining: HTMLParagraphElement;
    settingsMusicBrainzTagWorkerProgressStatus: HTMLParagraphElement;
    settingsPlayerCardLayout: HTMLSelectElement;
    settingsCoverArtPriorityList: HTMLUListElement;
    settingsMinimizeToTrayField: HTMLDivElement;
    settingsMinimizeToTrayOnClose: HTMLInputElement;
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
                    <button id="settings-tab-ui" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-ui" aria-selected="false">UI</button>
                    <button id="settings-tab-audio" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-audio" aria-selected="false">Audio</button>
                    <button id="settings-tab-playlists" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-playlists" aria-selected="false">Playlists</button>
                    <button id="settings-tab-scrobbling" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-scrobbling" aria-selected="false">Scrobbling</button>
                    <button id="settings-tab-database" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-database" aria-selected="false">Database</button>
                    <button id="settings-tab-network" class="settings-tab" type="button" role="tab" aria-controls="settings-panel-network" aria-selected="false">Network</button>
                </div>
                <div id="settings-panel-general" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-general">
                    <div class="settings-field">
                        <label class="settings-label" for="settings-library-folder-list">Library folders</label>
                        <p class="settings-hint">Add one or more library roots. A folder settings dialog opens after adding a folder, and you can double-click an existing entry to change its label or release depth.</p>
                        <ul id="settings-library-folder-list" class="settings-library-folder-list" role="listbox" aria-label="Library folders" tabindex="0"></ul>
                        <div class="settings-list-actions">
                            <button id="settings-add-library-folder" class="settings-list-btn" type="button" title="Add library folder" aria-label="Add library folder">+</button>
                            <button id="settings-remove-library-folder" class="settings-list-btn" type="button" title="Remove selected library folder" aria-label="Remove selected library folder" disabled>-</button>
                        </div>
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-ffmpeg-path">FFmpeg executable path</label>
                        <p class="settings-hint">Optional full path to ffmpeg. Leave blank to use the version available on PATH.</p>
                        <input id="settings-ffmpeg-path" class="settings-input" type="text" spellcheck="false" placeholder="Leave blank to use PATH">
                    </div>
                    <div class="settings-field settings-toggle-field">
                        <label class="settings-checkbox-row" for="settings-prefer-musicbrainz-metadata">
                            <input id="settings-prefer-musicbrainz-metadata" class="settings-checkbox" type="checkbox">
                            <span class="settings-label">Prefer MusicBrainz metadata when MBIDs are present</span>
                        </label>
                        <p class="settings-hint">Track labels are replaced on-the-fly by MusicBrainz lookup.</p>
                    </div>
                </div>
                <div id="settings-panel-network" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-network" hidden>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-listenbrainz-token">ListenBrainz user token</label>
                        <p class="settings-hint">Used to submit scrobbles to your ListenBrainz account.</p>
                        <input id="settings-listenbrainz-token" class="settings-input" type="password" placeholder="Optional">
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-musicbrainz-server-url">MusicBrainz server URL</label>
                        <p class="settings-hint">Override the MusicBrainz server used for lookups. Local hosts are permitted a shorter cooldown between requests.</p>
                        <div class="settings-server-url-row">
                            <input id="settings-musicbrainz-server-url" class="settings-input" type="text" spellcheck="false" placeholder="https://musicbrainz.org">
                            <div class="settings-server-rate-group">
                                <input id="settings-musicbrainz-request-rate-ms" class="settings-input settings-server-rate-input" type="number" min="0" step="1" inputmode="numeric" aria-label="MusicBrainz request rate limit in milliseconds" placeholder="0">
                                <span class="settings-server-rate-unit">ms</span>
                            </div>
                        </div>
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-listenbrainz-server-url">ListenBrainz server URL</label>
                        <p class="settings-hint">Override the ListenBrainz server used for scrobbling. Local hosts are permitted a shorter cooldown between requests.</p>
                        <div class="settings-server-url-row">
                            <input id="settings-listenbrainz-server-url" class="settings-input" type="text" spellcheck="false" placeholder="https://api.listenbrainz.org">
                            <div class="settings-server-rate-group">
                                <input id="settings-listenbrainz-request-rate-ms" class="settings-input settings-server-rate-input" type="number" min="0" step="1" inputmode="numeric" aria-label="ListenBrainz request rate limit in milliseconds" placeholder="0">
                                <span class="settings-server-rate-unit">ms</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="settings-panel-database" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-database" hidden>
                    <div class="settings-field settings-toggle-field">
                        <label class="settings-checkbox-row" for="settings-musicbrainz-tag-database-enabled">
                            <input id="settings-musicbrainz-tag-database-enabled" class="settings-checkbox" type="checkbox">
                            <span class="settings-label">Enable MusicBrainz tag database</span>
                        </label>
                        <p class="settings-hint">Builds a background MusicBrainz tag index for <code>mbtag:</code> library searches. Direct user lookups still take priority over the background worker.</p>
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-musicbrainz-tag-stale-days">Metadata stale after</label>
                        <p class="settings-hint">Default is 30 days. Set 0 to never automatically refetch cached MusicBrainz metadata.</p>
                        <div class="settings-server-rate-group">
                            <input id="settings-musicbrainz-tag-stale-days" class="settings-input settings-server-rate-input" type="number" min="0" max="36500" step="1" inputmode="numeric" aria-label="MusicBrainz metadata stale days" placeholder="30">
                            <span class="settings-server-rate-unit">days</span>
                        </div>
                    </div>
                    <div class="settings-field settings-toggle-field">
                        <label class="settings-checkbox-row" for="settings-musicbrainz-tag-request-staggering-enabled">
                            <input id="settings-musicbrainz-tag-request-staggering-enabled" class="settings-checkbox" type="checkbox">
                            <span class="settings-label">Stagger background refetches</span>
                        </label>
                        <p class="settings-hint">Refreshes roughly total database entries divided by stale days per run, oldest first, so large libraries do not queue every refetch at once.</p>
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-musicbrainz-tag-worker-cores">MusicBrainz tag worker cores</label>
                        <p class="settings-hint">Uses up to this many parallel local tag readers. MusicBrainz network requests to the public server are limited to one request per second.</p>
                        <input id="settings-musicbrainz-tag-worker-cores" class="settings-input" type="number" min="1" step="1" inputmode="numeric" placeholder="1">
                    </div>
                    <div class="settings-field settings-worker-progress-field">
                        <div class="settings-worker-progress-header">
                            <span class="settings-label">Metadata worker progress</span>
                            <span id="settings-musicbrainz-tag-worker-progress-value" class="settings-worker-progress-value">0%</span>
                        </div>
                        <div id="settings-musicbrainz-tag-worker-progress-bar" class="settings-worker-progress-bar" role="progressbar" aria-label="Metadata worker progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0% complete">
                            <span id="settings-musicbrainz-tag-worker-progress-fill" class="settings-worker-progress-fill"></span>
                        </div>
                        <p id="settings-musicbrainz-tag-worker-progress-remaining" class="settings-hint">0 entities processed • 0 entities still to look up.</p>
                        <p id="settings-musicbrainz-tag-worker-progress-status" class="settings-hint settings-worker-progress-status">MusicBrainz tag worker idle.</p>
                    </div>
                </div>
                <div id="settings-panel-playlists" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-playlists" hidden>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-favourite-playlist-list">Favourite playlists</label>
                        <p class="settings-hint">These playlists will always appear in the playlist modal.</p>
                        <ul id="settings-favourite-playlist-list" class="settings-favorite-list" role="listbox" aria-label="Favourite playlists"></ul>
                        <div class="settings-list-actions">
                            <button id="settings-add-favorite-playlist" class="settings-list-btn" type="button" title="Add favourite playlist" aria-label="Add favourite playlist">+</button>
                            <button id="settings-remove-favorite-playlist" class="settings-list-btn" type="button" title="Remove selected favourite playlist" aria-label="Remove selected favourite playlist" disabled>-</button>
                        </div>
                    </div>
                </div>
                <div id="settings-panel-scrobbling" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-scrobbling" hidden>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-scrobble-filter-mode">Scrobble mode</label>
                        <p class="settings-hint">In blacklist mode matching rules block scrobbles. In whitelist mode at least one rule must match before a scrobble is submitted.</p>
                        <select id="settings-scrobble-filter-mode" class="settings-input settings-select">
                            <option value="blacklist">Blacklist: scrobble unless a rule matches</option>
                            <option value="whitelist">Whitelist: scrobble only when a rule matches</option>
                        </select>
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-scrobble-rule-list">Scrobble rules</label>
                        <p class="settings-hint">Rules can target paths, names, genres, MBIDs, and track length. Text rules support contains, equals, starts with, and RegEx matching. Double-click a rule to edit it.</p>
                        <ul id="settings-scrobble-rule-list" class="settings-folder-list" role="listbox" aria-label="Scrobble rules"></ul>
                        <div class="settings-list-actions">
                            <button id="settings-add-scrobble-rule" class="settings-list-btn" type="button" title="Add scrobble rule" aria-label="Add scrobble rule">+</button>
                            <button id="settings-remove-scrobble-rule" class="settings-list-btn" type="button" title="Remove selected scrobble rule" aria-label="Remove selected scrobble rule" disabled>-</button>
                        </div>
                    </div>
                </div>
                <div id="settings-panel-audio" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-audio" hidden>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-audio-output-device">Audio output device</label>
                        <div class="settings-audio-device-row">
                            <select id="settings-audio-output-device" class="settings-input settings-select"></select>
                            <button id="settings-apply-audio-now" class="settings-secondary-btn settings-audio-apply-btn" type="button" title="Refresh the device list and reload audio-related app state without restarting." aria-label="Refresh audio settings"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M20 5V10H15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19V14H9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.6 9.2C7.6 7.2 9.6 6 12 6C14.4 6 16.4 7.1 17.5 8.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.4 14.8C16.4 16.8 14.4 18 12 18C9.6 18 7.6 16.9 6.5 15.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                        </div>
                        <p class="settings-hint">Choose the output device used when the audio backend initializes.<br>Use the refresh button to rescan devices and reload audio-related state without restarting.</p>
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-audio-output-buffer-ms">Audio output buffer (ms)</label>
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
                        <label class="settings-label" for="settings-player-card-layout">Player card layout</label>
                        <p class="settings-hint">Choose how track metadata is arranged on the player card.</p>
                        <select id="settings-player-card-layout" class="settings-input settings-select">
                            <option value="default">Default — Title, album, artist</option>
                            <option value="release">Release-focused — Artist, cover, label &amp; year</option>
                        </select>
                    </div>
                    <div class="settings-field">
                        <label class="settings-label" for="settings-cover-art-priority-list">Cover art source priority</label>
                        <p class="settings-hint">Check sources to enable them, then drag to reorder priority. Top enabled entry is tried first. Separate cover files are preferred by default.</p>
                        <ul id="settings-cover-art-priority-list" class="settings-priority-list" role="listbox" aria-label="Cover art source priority"></ul>
                    </div>
                    <div id="settings-minimize-to-tray-field" class="settings-field settings-toggle-field">
                        <label class="settings-checkbox-row" for="settings-minimize-to-tray-on-close">
                            <input id="settings-minimize-to-tray-on-close" class="settings-checkbox" type="checkbox">
                            <span class="settings-label">Minimize to system tray</span>
                        </label>
                        <p class="settings-hint">Disabled by default. When enabled, closing the window hides Silphium to the system tray instead of quitting.</p>
                    </div>
                    <div class="settings-accordion">
                        <button id="settings-shortcut-accordion-toggle" class="settings-accordion-toggle" type="button" aria-expanded="false" aria-controls="settings-shortcut-accordion-panel">Keyboard shortcuts</button>
                        <div id="settings-shortcut-accordion-panel" class="settings-accordion-panel" hidden>
                            <p class="settings-hint">Click a field and press a key combination. Use Delete to clear.</p>
                            <div class="settings-shortcuts-grid">
                                <div class="settings-field">
                                    <label class="settings-label" for="settings-shortcut-play-pause">Play/pause toggle</label>
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
                    </div>
                </div>
                <p id="settings-status" class="settings-status"></p>
                <div class="settings-actions">
                    <button id="settings-force-reload" class="settings-secondary-btn" type="button">Force reload</button>
                    <button id="settings-save" class="upload-btn" type="button">Save</button>
                </div>
            </div>
        </section>
        <div id="settings-library-depth-modal" class="settings-submodal" hidden>
            <div id="settings-library-depth-backdrop" class="settings-submodal-backdrop"></div>
            <form id="settings-library-depth-form" class="settings-subdialog" role="dialog" aria-modal="true" aria-labelledby="settings-library-depth-title">
                <p id="settings-library-depth-title" class="settings-subdialog-title">Library folder settings</p>
                <div class="settings-field">
                    <label class="settings-label" for="settings-library-depth-label-input">Custom label</label>
                    <p class="settings-hint">Overrides the name shown for this library in the app.<br>Leave blank to use the folder name.</p>
                    <input id="settings-library-depth-label-input" class="settings-input" type="text" maxlength="120" placeholder="Optional">
                </div>
                <div class="settings-field">
                    <label class="settings-label" for="settings-library-depth-input">Release folder depth</label>
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
        <div id="settings-scrobble-rule-modal" class="settings-submodal" hidden>
            <div id="settings-scrobble-rule-backdrop" class="settings-submodal-backdrop"></div>
            <form id="settings-scrobble-rule-form" class="settings-subdialog" role="dialog" aria-modal="true" aria-labelledby="settings-scrobble-rule-title">
                <p id="settings-scrobble-rule-title" class="settings-subdialog-title">Add scrobble rule</p>
                <div class="settings-field">
                    <label class="settings-label" for="settings-scrobble-rule-field">Rule field</label>
                    <select id="settings-scrobble-rule-field" class="settings-input settings-select">
                        <option value="path">Path</option>
                        <option value="albumArtist">Album artist</option>
                        <option value="trackArtist">Track artist</option>
                        <option value="albumTitle">Album title</option>
                        <option value="trackTitle">Track title</option>
                        <option value="genre">Genre</option>
                        <option value="artistMbid">Artist MBID</option>
                        <option value="albumMbid">Album MBID</option>
                        <option value="trackLength">Track length</option>
                    </select>
                </div>
                <div class="settings-field">
                    <label class="settings-label" for="settings-scrobble-rule-operator">Rule operator</label>
                    <select id="settings-scrobble-rule-operator" class="settings-input settings-select"></select>
                </div>
                <div class="settings-field">
                    <label id="settings-scrobble-rule-value-label" class="settings-label" for="settings-scrobble-rule-value">Rule value</label>
                    <p id="settings-scrobble-rule-hint" class="settings-hint">Enter a value for this rule.</p>
                    <input id="settings-scrobble-rule-value" class="settings-input" type="text" spellcheck="false" placeholder="Value">
                </div>
                <p id="settings-scrobble-rule-status" class="settings-subdialog-status" aria-live="polite"></p>
                <div class="settings-subdialog-actions">
                    <button id="settings-scrobble-rule-cancel" class="settings-secondary-btn" type="button">Cancel</button>
                    <button id="settings-scrobble-rule-confirm" class="upload-btn" type="submit">Apply</button>
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
    settingsTabNetwork: root.querySelector('#settings-tab-network') as HTMLButtonElement,
    settingsTabDatabase: root.querySelector('#settings-tab-database') as HTMLButtonElement,
    settingsTabPlaylists: root.querySelector('#settings-tab-playlists') as HTMLButtonElement,
    settingsTabScrobbling: root.querySelector('#settings-tab-scrobbling') as HTMLButtonElement,
    settingsTabAudio: root.querySelector('#settings-tab-audio') as HTMLButtonElement,
    settingsTabUi: root.querySelector('#settings-tab-ui') as HTMLButtonElement,
    settingsPanelGeneral: root.querySelector('#settings-panel-general') as HTMLDivElement,
    settingsPanelNetwork: root.querySelector('#settings-panel-network') as HTMLDivElement,
    settingsPanelDatabase: root.querySelector('#settings-panel-database') as HTMLDivElement,
    settingsPanelPlaylists: root.querySelector('#settings-panel-playlists') as HTMLDivElement,
    settingsPanelScrobbling: root.querySelector('#settings-panel-scrobbling') as HTMLDivElement,
    settingsPanelAudio: root.querySelector('#settings-panel-audio') as HTMLDivElement,
    settingsPanelUi: root.querySelector('#settings-panel-ui') as HTMLDivElement,
    settingsShortcutAccordionToggle: root.querySelector('#settings-shortcut-accordion-toggle') as HTMLButtonElement,
    settingsShortcutAccordionPanel: root.querySelector('#settings-shortcut-accordion-panel') as HTMLDivElement,
    settingsLibraryFolderList: root.querySelector('#settings-library-folder-list') as HTMLUListElement,
    settingsAddLibraryFolder: root.querySelector('#settings-add-library-folder') as HTMLButtonElement,
    settingsRemoveLibraryFolder: root.querySelector('#settings-remove-library-folder') as HTMLButtonElement,
    settingsFavoritePlaylistList: root.querySelector('#settings-favourite-playlist-list') as HTMLUListElement,
    settingsAddFavoritePlaylist: root.querySelector('#settings-add-favorite-playlist') as HTMLButtonElement,
    settingsRemoveFavoritePlaylist: root.querySelector('#settings-remove-favorite-playlist') as HTMLButtonElement,
    settingsScrobbleFilterMode: root.querySelector('#settings-scrobble-filter-mode') as HTMLSelectElement,
    settingsScrobbleRuleList: root.querySelector('#settings-scrobble-rule-list') as HTMLUListElement,
    settingsAddScrobbleRule: root.querySelector('#settings-add-scrobble-rule') as HTMLButtonElement,
    settingsRemoveScrobbleRule: root.querySelector('#settings-remove-scrobble-rule') as HTMLButtonElement,
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
    settingsScrobbleRuleModal: root.querySelector('#settings-scrobble-rule-modal') as HTMLDivElement,
    settingsScrobbleRuleBackdrop: root.querySelector('#settings-scrobble-rule-backdrop') as HTMLDivElement,
    settingsScrobbleRuleForm: root.querySelector('#settings-scrobble-rule-form') as HTMLFormElement,
    settingsScrobbleRuleTitle: root.querySelector('#settings-scrobble-rule-title') as HTMLParagraphElement,
    settingsScrobbleRuleField: root.querySelector('#settings-scrobble-rule-field') as HTMLSelectElement,
    settingsScrobbleRuleOperator: root.querySelector('#settings-scrobble-rule-operator') as HTMLSelectElement,
    settingsScrobbleRuleValueLabel: root.querySelector('#settings-scrobble-rule-value-label') as HTMLLabelElement,
    settingsScrobbleRuleValue: root.querySelector('#settings-scrobble-rule-value') as HTMLInputElement,
    settingsScrobbleRuleHint: root.querySelector('#settings-scrobble-rule-hint') as HTMLParagraphElement,
    settingsScrobbleRuleStatus: root.querySelector('#settings-scrobble-rule-status') as HTMLParagraphElement,
    settingsScrobbleRuleCancel: root.querySelector('#settings-scrobble-rule-cancel') as HTMLButtonElement,
    settingsScrobbleRuleConfirm: root.querySelector('#settings-scrobble-rule-confirm') as HTMLButtonElement,
    settingsFFmpegPath: root.querySelector('#settings-ffmpeg-path') as HTMLInputElement,
    settingsListenBrainzToken: root.querySelector('#settings-listenbrainz-token') as HTMLInputElement,
    settingsMusicBrainzServerUrl: root.querySelector('#settings-musicbrainz-server-url') as HTMLInputElement,
    settingsMusicBrainzRequestRateMs: root.querySelector('#settings-musicbrainz-request-rate-ms') as HTMLInputElement,
    settingsListenBrainzServerUrl: root.querySelector('#settings-listenbrainz-server-url') as HTMLInputElement,
    settingsListenBrainzRequestRateMs: root.querySelector('#settings-listenbrainz-request-rate-ms') as HTMLInputElement,
    settingsAudioOutputDevice: root.querySelector('#settings-audio-output-device') as HTMLSelectElement,
    settingsAudioOutputBufferMs: root.querySelector('#settings-audio-output-buffer-ms') as HTMLInputElement,
    settingsApplyAudioNow: root.querySelector('#settings-apply-audio-now') as HTMLButtonElement,
    settingsGaplessPlayback: root.querySelector('#settings-gapless-playback') as HTMLInputElement,
    settingsReplayGain: root.querySelector('#settings-replaygain') as HTMLInputElement,
    settingsPreferMusicBrainzMetadata: root.querySelector('#settings-prefer-musicbrainz-metadata') as HTMLInputElement,
    settingsMusicBrainzTagDatabaseEnabled: root.querySelector('#settings-musicbrainz-tag-database-enabled') as HTMLInputElement,
    settingsMusicBrainzTagStaleDays: root.querySelector('#settings-musicbrainz-tag-stale-days') as HTMLInputElement,
    settingsMusicBrainzTagRequestStaggeringEnabled: root.querySelector('#settings-musicbrainz-tag-request-staggering-enabled') as HTMLInputElement,
    settingsMusicBrainzTagWorkerCores: root.querySelector('#settings-musicbrainz-tag-worker-cores') as HTMLInputElement,
    settingsMusicBrainzTagWorkerProgressBar: root.querySelector('#settings-musicbrainz-tag-worker-progress-bar') as HTMLDivElement,
    settingsMusicBrainzTagWorkerProgressFill: root.querySelector('#settings-musicbrainz-tag-worker-progress-fill') as HTMLSpanElement,
    settingsMusicBrainzTagWorkerProgressValue: root.querySelector('#settings-musicbrainz-tag-worker-progress-value') as HTMLSpanElement,
    settingsMusicBrainzTagWorkerProgressRemaining: root.querySelector('#settings-musicbrainz-tag-worker-progress-remaining') as HTMLParagraphElement,
    settingsMusicBrainzTagWorkerProgressStatus: root.querySelector('#settings-musicbrainz-tag-worker-progress-status') as HTMLParagraphElement,
    settingsPlayerCardLayout: root.querySelector('#settings-player-card-layout') as HTMLSelectElement,
    settingsCoverArtPriorityList: root.querySelector('#settings-cover-art-priority-list') as HTMLUListElement,
    settingsMinimizeToTrayField: root.querySelector('#settings-minimize-to-tray-field') as HTMLDivElement,
    settingsMinimizeToTrayOnClose: root.querySelector('#settings-minimize-to-tray-on-close') as HTMLInputElement,
    settingsShortcutPlayPauseToggle: root.querySelector('#settings-shortcut-play-pause') as HTMLInputElement,
    settingsShortcutNextTrack: root.querySelector('#settings-shortcut-next-track') as HTMLInputElement,
    settingsShortcutPreviousTrack: root.querySelector('#settings-shortcut-previous-track') as HTMLInputElement,
    settingsShortcutStopPlayback: root.querySelector('#settings-shortcut-stop-playback') as HTMLInputElement,
    settingsShortcutFocusLibraryFilter: root.querySelector('#settings-shortcut-focus-library-filter') as HTMLInputElement,
    settingsShortcutOpenSettings: root.querySelector('#settings-shortcut-open-settings') as HTMLInputElement,
    settingsStatus: root.querySelector('#settings-status') as HTMLParagraphElement,
});
