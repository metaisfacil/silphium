import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCoverFlipRuntime } from './app-cover-flip-runtime';

describe('createCoverFlipRuntime', () => {
    beforeEach(() => {
        vi.spyOn(performance, 'now').mockReturnValue(1000);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('toggles on secondary input and suppresses the immediate follow-up context menu', () => {
        document.body.innerHTML = '<div id="frame"><button id="inside" type="button"></button></div>';
        const coverFrame = document.querySelector('#frame') as HTMLDivElement;
        const inside = document.querySelector('#inside') as HTMLButtonElement;
        const context = {
            coverFrame,
            coverFlipped: false,
            setCoverFlipped: vi.fn((nextValue: boolean) => {
                context.coverFlipped = nextValue;
            }),
        };
        const runtime = createCoverFlipRuntime(context);

        const secondaryInput = new MouseEvent('pointerdown', { button: 2, bubbles: true });
        const preventSecondaryDefault = vi.spyOn(secondaryInput, 'preventDefault');
        const stopSecondaryPropagation = vi.spyOn(secondaryInput, 'stopPropagation');

        runtime.toggleCoverFlipFromSecondaryInput(secondaryInput);

        expect(preventSecondaryDefault).toHaveBeenCalledTimes(1);
        expect(stopSecondaryPropagation).toHaveBeenCalledTimes(1);
        expect(context.setCoverFlipped).toHaveBeenCalledWith(true);
        expect(runtime.suppressCoverFrontClickUntil).toBe(1320);

        vi.mocked(performance.now).mockReturnValue(1100);
        const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
        Object.defineProperty(contextMenuEvent, 'target', { value: inside });
        const preventContextDefault = vi.spyOn(contextMenuEvent, 'preventDefault');
        const stopContextPropagation = vi.spyOn(contextMenuEvent, 'stopPropagation');

        expect(runtime.toggleCoverFlipFromContextMenu(contextMenuEvent)).toBe(true);
        expect(preventContextDefault).toHaveBeenCalledTimes(1);
        expect(stopContextPropagation).toHaveBeenCalledTimes(1);
        expect(context.setCoverFlipped).toHaveBeenCalledTimes(1);
    });

    it('supports ctrl-primary clicks and ignores unrelated pointer input', () => {
        document.body.innerHTML = '<div id="frame"></div>';
        const context = {
            coverFrame: document.querySelector('#frame') as HTMLDivElement,
            coverFlipped: false,
            setCoverFlipped: vi.fn((nextValue: boolean) => {
                context.coverFlipped = nextValue;
            }),
        };
        const runtime = createCoverFlipRuntime(context);

        const ctrlPrimaryClick = new MouseEvent('pointerdown', { button: 0, ctrlKey: true, bubbles: true });
        runtime.toggleCoverFlipFromSecondaryInput(ctrlPrimaryClick);

        expect(context.setCoverFlipped).toHaveBeenCalledWith(true);

        const plainPrimaryClick = new MouseEvent('pointerdown', { button: 0, bubbles: true });
        runtime.toggleCoverFlipFromSecondaryInput(plainPrimaryClick);

        expect(context.setCoverFlipped).toHaveBeenCalledTimes(1);
    });

    it('only handles context menus that originate inside the cover frame', () => {
        document.body.innerHTML = '<div id="frame"></div><button id="outside" type="button"></button>';
        const outside = document.querySelector('#outside') as HTMLButtonElement;
        const context = {
            coverFrame: document.querySelector('#frame') as HTMLDivElement,
            coverFlipped: false,
            setCoverFlipped: vi.fn(),
        };
        const runtime = createCoverFlipRuntime(context);

        const outsideContextMenu = new MouseEvent('contextmenu', { bubbles: true });
        Object.defineProperty(outsideContextMenu, 'target', { value: outside });
        const preventDefaultSpy = vi.spyOn(outsideContextMenu, 'preventDefault');
        const stopPropagationSpy = vi.spyOn(outsideContextMenu, 'stopPropagation');

        expect(runtime.toggleCoverFlipFromContextMenu(outsideContextMenu)).toBe(false);
        expect(preventDefaultSpy).not.toHaveBeenCalled();
        expect(stopPropagationSpy).not.toHaveBeenCalled();
        expect(context.setCoverFlipped).not.toHaveBeenCalled();
    });
});