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
                <button id="mb-entity-close" class="mb-entity-close" type="button" aria-label="Close MusicBrainz details">✕</button>
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
