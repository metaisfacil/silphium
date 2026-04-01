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
                <button id="text-file-close" class="text-file-close" type="button" aria-label="Close text file">✕</button>
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