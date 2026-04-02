export type ImageFileModalElements = {
    imageFileModal: HTMLDivElement;
    imageFileBackdrop: HTMLDivElement;
    imageFilePreview: HTMLImageElement;
    imageFileThumbsPrev: HTMLButtonElement;
    imageFileThumbsNext: HTMLButtonElement;
    imageFileThumbsViewport: HTMLDivElement;
    imageFileThumbsRow: HTMLDivElement;
};

export const renderImageFileModal = (): string => `
    <div id="image-file-modal" class="image-file-modal" hidden>
        <div id="image-file-backdrop" class="image-file-backdrop"></div>
        <section class="image-file-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
            <div class="image-file-content">
                <img id="image-file-preview" class="image-file-preview" alt="Image preview">
            </div>
            <div class="image-file-thumbs" aria-label="Related images">
                <button id="image-file-thumbs-prev" class="image-file-thumbs-nav" type="button" aria-label="Previous images">‹</button>
                <div id="image-file-thumbs-viewport" class="image-file-thumbs-viewport">
                    <div id="image-file-thumbs-row" class="image-file-thumbs-row"></div>
                </div>
                <button id="image-file-thumbs-next" class="image-file-thumbs-nav" type="button" aria-label="Next images">›</button>
            </div>
        </section>
    </div>
`;

export const getImageFileModalElements = (root: ParentNode): ImageFileModalElements => ({
    imageFileModal: root.querySelector('#image-file-modal') as HTMLDivElement,
    imageFileBackdrop: root.querySelector('#image-file-backdrop') as HTMLDivElement,
    imageFilePreview: root.querySelector('#image-file-preview') as HTMLImageElement,
    imageFileThumbsPrev: root.querySelector('#image-file-thumbs-prev') as HTMLButtonElement,
    imageFileThumbsNext: root.querySelector('#image-file-thumbs-next') as HTMLButtonElement,
    imageFileThumbsViewport: root.querySelector('#image-file-thumbs-viewport') as HTMLDivElement,
    imageFileThumbsRow: root.querySelector('#image-file-thumbs-row') as HTMLDivElement,
});