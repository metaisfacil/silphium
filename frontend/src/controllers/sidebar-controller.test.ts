import { describe, expect, it, vi } from 'vitest';

import { createSidebarController } from './sidebar-controller';

const createElements = () => ({
    app: document.createElement('div'),
    sidebarToggle: document.createElement('button'),
    libraryHeaderTitleText: document.createElement('span'),
    sidebarNavPane: document.createElement('section'),
    sidebarModeBar: document.createElement('div'),
    sidebarPaneLibrary: document.createElement('section'),
    sidebarPaneSocial: document.createElement('section'),
});

describe('createSidebarController', () => {
    it('hides the mode bar and section panes in navigation mode', () => {
        const elements = createElements();

        createSidebarController({
            elements,
            showLibrarySection: vi.fn(),
            showSocialSection: vi.fn(),
            isSocialActiveSection: vi.fn(() => false),
        });

        expect(elements.libraryHeaderTitleText.textContent).toBe('Browse');
        expect(elements.sidebarNavPane.hidden).toBe(false);
        expect(elements.sidebarModeBar.hidden).toBe(true);
        expect(elements.sidebarPaneLibrary.hidden).toBe(true);
        expect(elements.sidebarPaneSocial.hidden).toBe(true);
        expect(elements.app.classList.contains('sidebar-subview-active')).toBe(false);
        expect(elements.sidebarToggle.classList.contains('is-back-mode')).toBe(false);
    });

    it('grows the toggle into the back state while a section is open', () => {
        const elements = createElements();
        elements.app.classList.add('sidebar-open');

        const controller = createSidebarController({
            elements,
            showLibrarySection: vi.fn(),
            showSocialSection: vi.fn(),
            isSocialActiveSection: vi.fn(() => false),
        });

        controller.showLibrary();

        expect(elements.app.classList.contains('sidebar-subview-active')).toBe(true);
        expect(elements.sidebarToggle.classList.contains('is-back-mode')).toBe(true);
        expect(elements.sidebarToggle.getAttribute('aria-label')).toBe('Back to sidebar navigation');
    });

    it('resets mode state when returning to navigation mode', () => {
        const elements = createElements();
        elements.app.classList.add('sidebar-open');
        const onShowNavigation = vi.fn();
        const showSocialSection = vi.fn();

        const controller = createSidebarController({
            elements,
            onShowNavigation,
            showLibrarySection: vi.fn(),
            showSocialSection,
            isSocialActiveSection: vi.fn(() => true),
        });

        controller.showSocial();
        expect(elements.libraryHeaderTitleText.textContent).toBe('Social');
        controller.showNavigation();

        expect(showSocialSection).toHaveBeenCalledTimes(1);
        expect(onShowNavigation).toHaveBeenCalledTimes(1);
        expect(controller.getActiveView()).toBe('nav');
        expect(elements.libraryHeaderTitleText.textContent).toBe('Browse');
        expect(elements.sidebarNavPane.hidden).toBe(false);
        expect(elements.sidebarModeBar.hidden).toBe(true);
        expect(elements.sidebarPaneLibrary.hidden).toBe(true);
        expect(elements.sidebarPaneSocial.hidden).toBe(true);
        expect(elements.app.classList.contains('sidebar-subview-active')).toBe(false);
        expect(elements.sidebarToggle.classList.contains('is-back-mode')).toBe(false);
    });
});