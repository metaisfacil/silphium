export type SettingsModalElements = {
    settingsModal: HTMLDivElement;
    settingsBackdrop: HTMLDivElement;
    settingsClose: HTMLButtonElement;
    settingsBrowse: HTMLButtonElement;
    settingsSave: HTMLButtonElement;
    settingsLibraryPath: HTMLInputElement;
    settingsListenBrainzToken: HTMLInputElement;
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
    settingsBrowse: root.querySelector('#settings-browse') as HTMLButtonElement,
    settingsSave: root.querySelector('#settings-save') as HTMLButtonElement,
    settingsLibraryPath: root.querySelector('#settings-library-path') as HTMLInputElement,
    settingsListenBrainzToken: root.querySelector('#settings-listenbrainz-token') as HTMLInputElement,
    settingsStatus: root.querySelector('#settings-status') as HTMLParagraphElement,
});