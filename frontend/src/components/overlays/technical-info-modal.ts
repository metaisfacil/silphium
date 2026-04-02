export type TechnicalInfoModalElements = {
    technicalInfoModal: HTMLDivElement;
    technicalInfoBackdrop: HTMLDivElement;
    technicalInfoTitle: HTMLParagraphElement;
    technicalInfoContent: HTMLDivElement;
    technicalInfoClose: HTMLButtonElement;
};

export const renderTechnicalInfoModal = (): string => `
    <div id="technical-info-modal" class="technical-info-modal" hidden>
        <div id="technical-info-backdrop" class="technical-info-backdrop"></div>
        <section class="technical-info-dialog" role="dialog" aria-modal="true" aria-labelledby="technical-info-title">
            <header class="technical-info-header">
                <p id="technical-info-title" class="technical-info-title">Technical info</p>
                <button id="technical-info-close" class="technical-info-close" type="button" aria-label="Close technical details">✕</button>
            </header>
            <div id="technical-info-content" class="technical-info-content"></div>
        </section>
    </div>
`;

export const getTechnicalInfoModalElements = (root: ParentNode): TechnicalInfoModalElements => ({
    technicalInfoModal: root.querySelector('#technical-info-modal') as HTMLDivElement,
    technicalInfoBackdrop: root.querySelector('#technical-info-backdrop') as HTMLDivElement,
    technicalInfoTitle: root.querySelector('#technical-info-title') as HTMLParagraphElement,
    technicalInfoContent: root.querySelector('#technical-info-content') as HTMLDivElement,
    technicalInfoClose: root.querySelector('#technical-info-close') as HTMLButtonElement,
});
