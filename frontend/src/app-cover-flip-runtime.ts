type CoverFlipRuntimeContext = {
    coverFrame: HTMLElement;
    coverFlipped: boolean;
    setCoverFlipped: (flipped: boolean) => void;
};

export const createCoverFlipRuntime = (context: CoverFlipRuntimeContext) => {
    const coverFlipSuppressWindowMs = 320;
    let suppressCoverContextMenuUntil = 0;
    let suppressCoverFrontClickUntil = 0;

    const markCoverFlipHandled = (): void => {
        const suppressUntil = performance.now() + coverFlipSuppressWindowMs;
        suppressCoverContextMenuUntil = suppressUntil;
        suppressCoverFrontClickUntil = suppressUntil;
    };

    const toggleCoverFlipFromSecondaryInput = (event: MouseEvent): void => {
        if (performance.now() < suppressCoverContextMenuUntil) {
            return;
        }

        const isSecondaryButton = event.button === 2;
        const isCtrlPrimaryClick = event.button === 0 && event.ctrlKey;
        if (!isSecondaryButton && !isCtrlPrimaryClick) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        markCoverFlipHandled();
        context.setCoverFlipped(!context.coverFlipped);
    };

    const toggleCoverFlipFromContextMenu = (event: MouseEvent): boolean => {
        const target = event.target;
        if (!(target instanceof Node) || !context.coverFrame.contains(target)) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();

        if (performance.now() < suppressCoverContextMenuUntil) {
            return true;
        }

        markCoverFlipHandled();
        context.setCoverFlipped(!context.coverFlipped);
        return true;
    };

    const logRescan = (message: string, ...args: unknown[]): void => {
        const timestamp = new Date().toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3,
        });
        console.log(`[${timestamp}] ${message}`, ...args);
    };

    return {
        get suppressCoverFrontClickUntil() {
            return suppressCoverFrontClickUntil;
        },
        logRescan,
        toggleCoverFlipFromContextMenu,
        toggleCoverFlipFromSecondaryInput,
    };
};
