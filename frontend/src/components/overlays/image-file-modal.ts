export type ImageFileModalElements = {
    imageFileModal: HTMLDivElement;
    imageFileBackdrop: HTMLDivElement;
    imageFilePreview: HTMLImageElement;
};

export const renderImageFileModal = (): string => `
    <div id="image-file-modal" class="image-file-modal" hidden>
        <div id="image-file-backdrop" class="image-file-backdrop"></div>
        <section class="image-file-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
            <div class="image-file-content">
                <img id="image-file-preview" class="image-file-preview" alt="Image preview">
            </div>
        </section>
    </div>
`;

export const getImageFileModalElements = (root: ParentNode): ImageFileModalElements => ({
    imageFileModal: root.querySelector('#image-file-modal') as HTMLDivElement,
    imageFileBackdrop: root.querySelector('#image-file-backdrop') as HTMLDivElement,
    imageFilePreview: root.querySelector('#image-file-preview') as HTMLImageElement,
});