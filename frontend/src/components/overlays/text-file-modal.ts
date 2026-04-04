export type TextFileModalElements = {
    textFileModal: HTMLDivElement;
    textFileBackdrop: HTMLDivElement;
    textFileTitle: HTMLParagraphElement;
    textFileCode: HTMLElement;
    textFileClose: HTMLButtonElement;
};

export const renderTextFileModal = (): string => `
    <div id="text-file-modal" class="text-file-modal" hidden>
        <div id="text-file-backdrop" class="text-file-backdrop"></div>
        <section class="text-file-dialog" role="dialog" aria-modal="true" aria-labelledby="text-file-title">
            <header class="text-file-header">
                <p id="text-file-title" class="text-file-title">Text file</p>
                <button id="text-file-close" class="text-file-close" type="button" aria-label="Close text file"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg></button>
            </header>
            <pre class="text-file-content"><code id="text-file-code"></code></pre>
        </section>
    </div>
`;

export const getTextFileModalElements = (root: ParentNode): TextFileModalElements => ({
    textFileModal: root.querySelector('#text-file-modal') as HTMLDivElement,
    textFileBackdrop: root.querySelector('#text-file-backdrop') as HTMLDivElement,
    textFileTitle: root.querySelector('#text-file-title') as HTMLParagraphElement,
    textFileCode: root.querySelector('#text-file-code') as HTMLElement,
    textFileClose: root.querySelector('#text-file-close') as HTMLButtonElement,
});