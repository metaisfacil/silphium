type SerialAsyncPollerOptions = {
    run: () => Promise<void> | void;
    getDelayMs: () => number | null;
};

export const createSerialAsyncPoller = (options: SerialAsyncPollerOptions) => {
    let timeoutHandle: number | undefined;
    let running = false;
    let inFlight = false;

    const clearScheduledTick = (): void => {
        if (timeoutHandle === undefined) {
            return;
        }

        window.clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
    };

    const scheduleNextTick = (): void => {
        if (!running || timeoutHandle !== undefined) {
            return;
        }

        const delayMs = options.getDelayMs();
        if (delayMs === null) {
            return;
        }

        timeoutHandle = window.setTimeout(() => {
            timeoutHandle = undefined;
            void tick();
        }, Math.max(0, delayMs));
    };

    const tick = async (): Promise<void> => {
        if (!running || inFlight) {
            return;
        }

        inFlight = true;
        try {
            await options.run();
        } finally {
            inFlight = false;
            scheduleNextTick();
        }
    };

    return {
        start: (): void => {
            if (running) {
                return;
            }

            running = true;
            scheduleNextTick();
        },
        stop: (): void => {
            running = false;
            clearScheduledTick();
        },
        poke: (): void => {
            if (!running) {
                return;
            }

            clearScheduledTick();
            if (!inFlight) {
                scheduleNextTick();
            }
        },
    };
};