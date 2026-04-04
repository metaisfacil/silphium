export type MusicBrainzEntityModalElements = {
    musicBrainzEntityModal: HTMLDivElement;
    musicBrainzEntityBackdrop: HTMLDivElement;
    musicBrainzEntityDialog: HTMLElement;
    musicBrainzEntityTitle: HTMLParagraphElement;
    musicBrainzEntityContent: HTMLDivElement;
    musicBrainzEntityClose: HTMLButtonElement;
};

export const renderMusicBrainzEntityModal = (): string => `
    <div id="mb-entity-modal" class="mb-entity-modal" hidden>
        <div id="mb-entity-backdrop" class="mb-entity-backdrop"></div>
        <section class="mb-entity-dialog" role="dialog" aria-modal="true" aria-labelledby="mb-entity-title">
            <header class="mb-entity-header">
                <p id="mb-entity-title" class="mb-entity-title">MusicBrainz info</p>
                <button id="mb-entity-close" class="mb-entity-close" type="button" aria-label="Close MusicBrainz details"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg></button>
            </header>
            <div id="mb-entity-content" class="mb-entity-content"></div>
        </section>
    </div>
`;

export const getMusicBrainzEntityModalElements = (root: ParentNode): MusicBrainzEntityModalElements => ({
    musicBrainzEntityModal: root.querySelector('#mb-entity-modal') as HTMLDivElement,
    musicBrainzEntityBackdrop: root.querySelector('#mb-entity-backdrop') as HTMLDivElement,
    musicBrainzEntityDialog: root.querySelector('.mb-entity-dialog') as HTMLElement,
    musicBrainzEntityTitle: root.querySelector('#mb-entity-title') as HTMLParagraphElement,
    musicBrainzEntityContent: root.querySelector('#mb-entity-content') as HTMLDivElement,
    musicBrainzEntityClose: root.querySelector('#mb-entity-close') as HTMLButtonElement,
});
