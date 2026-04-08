type ViteBeforeUpdateCallback = () => void;

type ViteHotChannel = {
    on(event: 'vite:beforeUpdate', callback: ViteBeforeUpdateCallback): void;
};

type ImportMetaWithOptionalHot = {
    hot?: ViteHotChannel;
};

type WindowWithReloadableLocation = {
    location: {
        reload(): void;
    };
    addEventListener?(event: 'beforeunload', listener: () => void): void;
    go?: {
        main?: {
            App?: {
                DisposeFrontendSessionState?: () => Promise<void> | void;
            };
        };
    };
};

const backendDisposeTimeoutMs = 250;

const wait = async (durationMs: number): Promise<void> => {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, durationMs);
    });
};

const disposeBackendSessionState = async (runtimeWindow: WindowWithReloadableLocation): Promise<void> => {
    const dispose = runtimeWindow.go?.main?.App?.DisposeFrontendSessionState;
    if (typeof dispose !== 'function') {
        return;
    }

    try {
        await Promise.race([
            Promise.resolve(dispose()),
            wait(backendDisposeTimeoutMs),
        ]);
    } catch {
        // Ignore backend teardown failures so reload can proceed.
    }
};

export const installHmrFullReset = (
    importMetaRef: ImportMetaWithOptionalHot,
    runtimeWindow: WindowWithReloadableLocation = window,
): void => {
    runtimeWindow.addEventListener?.('beforeunload', () => {
        void disposeBackendSessionState(runtimeWindow);
    });

    if (!importMetaRef.hot) {
        return;
    }

    let reloadRequested = false;
    importMetaRef.hot.on('vite:beforeUpdate', () => {
        if (reloadRequested) {
            return;
        }

        reloadRequested = true;
        void (async () => {
            await disposeBackendSessionState(runtimeWindow);
            runtimeWindow.location.reload();
        })();
    });
};
