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
        const on = vi.fn();
        const addEventListener = vi.fn();
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
        const beforeUpdateCallback = on.mock.calls[0]?.[1];
        const beforeUnloadCallback = addEventListener.mock.calls[0]?.[1];
        expect(beforeUpdateCallback).toEqual(expect.any(Function));
        expect(beforeUnloadCallback).toEqual(expect.any(Function));

        (beforeUpdateCallback as () => void)();
        (beforeUpdateCallback as () => void)();

        await Promise.resolve();
        await Promise.resolve();

        (beforeUnloadCallback as () => void)();
        await Promise.resolve();

        await vi.waitFor(() => {
            expect(reload).toHaveBeenCalledTimes(1);
        });
        expect(disposeFrontendSessionState).toHaveBeenCalledTimes(2);
    });
});
