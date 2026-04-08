import { describe, expect, it, vi } from 'vitest';

import { installHmrFullReset } from './hmr-full-reset';

describe('installHmrFullReset', () => {
    it('does not register when Vite hot channel is unavailable', () => {
        const reload = vi.fn();
        const addEventListener = vi.fn();

        installHmrFullReset({}, {
            location: {
                reload,
            },
            addEventListener,
        });

        expect(reload).not.toHaveBeenCalled();
        expect(addEventListener).toHaveBeenCalledTimes(1);
        expect(addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('disposes backend state and reloads once after the first hot update notification', async () => {
        let beforeUpdateCallback: (() => void) | null = null;
        let beforeUnloadCallback: (() => void) | null = null;
        const on = vi.fn((event: 'vite:beforeUpdate', callback: () => void) => {
            if (event === 'vite:beforeUpdate') {
                beforeUpdateCallback = callback;
            }
        });
        const addEventListener = vi.fn((event: 'beforeunload', callback: () => void) => {
            if (event === 'beforeunload') {
                beforeUnloadCallback = callback;
            }
        });
        const reload = vi.fn();
        const disposeFrontendSessionState = vi.fn(async () => undefined);

        installHmrFullReset(
            {
                hot: {
                    on,
                },
            },
            {
                location: {
                    reload,
                },
                addEventListener,
                go: {
                    main: {
                        App: {
                            DisposeFrontendSessionState: disposeFrontendSessionState,
                        },
                    },
                },
            },
        );

        expect(on).toHaveBeenCalledTimes(1);
        expect(on).toHaveBeenCalledWith('vite:beforeUpdate', expect.any(Function));
        expect(beforeUpdateCallback).not.toBeNull();
        expect(beforeUnloadCallback).not.toBeNull();

        beforeUpdateCallback?.();
        beforeUpdateCallback?.();

        await Promise.resolve();
        await Promise.resolve();

        beforeUnloadCallback?.();
        await Promise.resolve();

        await vi.waitFor(() => {
            expect(reload).toHaveBeenCalledTimes(1);
        });
        expect(disposeFrontendSessionState).toHaveBeenCalledTimes(2);
    });
});
