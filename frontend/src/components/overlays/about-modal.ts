export type AboutModalElements = {
    aboutModal: HTMLDivElement;
    aboutBackdrop: HTMLDivElement;
    aboutClose: HTMLButtonElement;
    aboutVersion: HTMLParagraphElement;
    aboutRepoLink: HTMLAnchorElement;
};

export const renderAboutModal = (): string => `
    <div id="about-modal" class="about-modal" hidden>
        <div id="about-backdrop" class="about-backdrop"></div>
        <section class="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
            <header class="about-header">
                <p id="about-title" class="about-title">About</p>
                <button id="about-close" class="about-close" type="button" aria-label="Close about dialog">✕</button>
            </header>
            <div class="about-content">
                <div class="about-logo-wrap">
                    <img class="about-logo" src="/silphium-logo.svg" alt="Silphium logo">
                </div>
                <p class="about-name"><strong>Silphium</strong></p>
                <p id="about-version" class="about-version">dev</p>
                <p class="about-author">by metaisfacil</p>
                <p class="about-repo">
                    <a id="about-repo-link" class="about-repo-link" href="https://github.com/metaisfacil/silphium">github.com/metaisfacil/silphium</a>
                </p>
            </div>
        </section>
    </div>
`;

export const getAboutModalElements = (root: ParentNode): AboutModalElements => ({
    aboutModal: root.querySelector('#about-modal') as HTMLDivElement,
    aboutBackdrop: root.querySelector('#about-backdrop') as HTMLDivElement,
    aboutClose: root.querySelector('#about-close') as HTMLButtonElement,
    aboutVersion: root.querySelector('#about-version') as HTMLParagraphElement,
    aboutRepoLink: root.querySelector('#about-repo-link') as HTMLAnchorElement,
});
