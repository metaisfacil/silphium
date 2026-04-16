import { describe, expect, it } from 'vitest';

import { getSidebarElements, renderSidebar, setLibraryShareConnectionsIndicator } from './sidebar';

describe('sidebar share connections indicator', () => {
    it('toggles visibility and updates the count label', () => {
        document.body.innerHTML = renderSidebar();

        const { libraryShareConnectionsIndicator } = getSidebarElements(document);

        setLibraryShareConnectionsIndicator(libraryShareConnectionsIndicator, 0);
        expect(libraryShareConnectionsIndicator.hidden).toBe(true);
        expect(libraryShareConnectionsIndicator.classList.contains('is-visible')).toBe(false);
        expect(libraryShareConnectionsIndicator.getAttribute('aria-label')).toBe('No remote listeners connected');

        setLibraryShareConnectionsIndicator(libraryShareConnectionsIndicator, 3);
        expect(libraryShareConnectionsIndicator.hidden).toBe(false);
        expect(libraryShareConnectionsIndicator.classList.contains('is-visible')).toBe(true);
        expect(libraryShareConnectionsIndicator.textContent).toContain('3');
        expect(libraryShareConnectionsIndicator.getAttribute('aria-label')).toBe('3 remote listeners connected');

        setLibraryShareConnectionsIndicator(libraryShareConnectionsIndicator, 1);
        expect(libraryShareConnectionsIndicator.getAttribute('aria-label')).toBe('1 remote listener connected');
    });
});