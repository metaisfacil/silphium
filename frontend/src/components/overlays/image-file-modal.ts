export type ImageFileModalElements = {
    imageFileModal: HTMLDivElement;
    imageFileBackdrop: HTMLDivElement;
    imageFileTitle: HTMLParagraphElement;
    imageFileClose: HTMLButtonElement;
    imageFilePreview: HTMLImageElement;
};

export const renderImageFileModal = (): string => `
    <div id="image-file-modal" class="image-file-modal" hidden>
        <div id="image-file-backdrop" class="image-file-backdrop"></div>
        <section class="image-file-dialog" role="dialog" aria-modal="true" aria-labelledby="image-file-title">
            <header class="image-file-header">
                <p id="image-file-title" class="image-file-title">Image file</p>
                <button id="image-file-close" class="image-file-close" type="button" aria-label="Close image file">✕</button>
            </header>
            <div class="image-file-content">
                <img id="image-file-preview" class="image-file-preview" alt="Image preview">
            </div>
        </section>
    </div>
`;

export const getImageFileModalElements = (root: ParentNode): ImageFileModalElements => ({
    imageFileModal: root.querySelector('#image-file-modal') as HTMLDivElement,
    imageFileBackdrop: root.querySelector('#image-file-backdrop') as HTMLDivElement,
    imageFileTitle: root.querySelector('#image-file-title') as HTMLParagraphElement,
    imageFileClose: root.querySelector('#image-file-close') as HTMLButtonElement,
    imageFilePreview: root.querySelector('#image-file-preview') as HTMLImageElement,
});