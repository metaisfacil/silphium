import type { SidebarElements } from '../components/sidebar';

type SidebarView = 'nav' | 'library' | 'social';

export type SidebarController = {
    showNavigation: () => void;
    showLibrary: () => void;
    showSocial: () => void;
    getActiveView: () => SidebarView;
    isSocialActive: () => boolean;
};

export type SidebarControllerOptions = {
    elements: Pick<SidebarElements, 'sidebarToggle' | 'libraryHeaderTitleText' | 'sidebarNavPane' | 'sidebarModeBar' | 'sidebarPaneLibrary' | 'sidebarPaneSocial'> & {
        app: HTMLElement;
    };
    onShowNavigation?: () => void;
    showLibrarySection: () => void;
    showSocialSection: () => void;
    isSocialActiveSection: () => boolean;
};

export const createSidebarController = (controller: SidebarControllerOptions): SidebarController => {
    let activeView: SidebarView = 'nav';

    const syncSidebarToggleState = (): void => {
        const hasSubview = activeView !== 'nav';
        const showBackToggle = hasSubview && controller.elements.app.classList.contains('sidebar-open');

        controller.elements.app.classList.toggle('sidebar-subview-active', hasSubview);
        controller.elements.sidebarToggle.classList.toggle('is-back-mode', showBackToggle);

        if (!controller.elements.sidebarToggle.classList.contains('is-loading')) {
            controller.elements.sidebarToggle.setAttribute(
                'aria-label',
                showBackToggle
                    ? 'Back to sidebar navigation'
                    : controller.elements.app.classList.contains('sidebar-open')
                        ? 'Close sidebar'
                        : 'Open sidebar',
            );
        }
    };

    const render = (): void => {
        controller.elements.sidebarNavPane.hidden = activeView !== 'nav';
        controller.elements.sidebarModeBar.hidden = true;
        controller.elements.sidebarPaneLibrary.hidden = activeView !== 'library';
        controller.elements.sidebarPaneSocial.hidden = activeView !== 'social';
        controller.elements.libraryHeaderTitleText.textContent = activeView === 'nav'
            ? 'Browse'
            : activeView === 'social'
                ? 'Social'
                : 'Library';
        syncSidebarToggleState();
    };

    const showNavigation = (): void => {
        activeView = 'nav';
        controller.onShowNavigation?.();
        render();
    };

    const showLibrary = (): void => {
        activeView = 'library';
        controller.showLibrarySection();
        render();
    };

    const showSocial = (): void => {
        activeView = 'social';
        controller.showSocialSection();
        render();
    };

    render();

    return {
        showNavigation,
        showLibrary,
        showSocial,
        getActiveView: () => activeView,
        isSocialActive: () => controller.isSocialActiveSection(),
    };
};
