const interactiveBridgeQuietWindowMs = 180;
const slowBackgroundBridgeCooldownMs = 450;
const backgroundBridgePollMs = 16;

type BackgroundBridgeCallOptions<T> = {
    maxWaitMs?: number;
    onTimeout?: () => Promise<T> | T;
    cooldownMsAfter?: number;
};

let activeInteractiveBridgeCalls = 0;
let activeBackgroundBridgeCalls = 0;
let backgroundBridgeBlockedUntilMs = 0;

const nowMs = (): number => {
    return Date.now();
};

const extendBackgroundBridgeBlock = (durationMs: number): void => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return;
    }

    backgroundBridgeBlockedUntilMs = Math.max(backgroundBridgeBlockedUntilMs, nowMs() + durationMs);
};

export const shouldDeferBackgroundBridgeCall = (): boolean => {
    const currentNowMs = nowMs();
    return activeInteractiveBridgeCalls > 0
        || activeBackgroundBridgeCalls > 0
        || currentNowMs < backgroundBridgeBlockedUntilMs;
};

const waitForBackgroundBridgeWindow = async (maxWaitMs: number): Promise<boolean> => {
    const deadlineMs = nowMs() + Math.max(0, maxWaitMs);
    while (shouldDeferBackgroundBridgeCall()) {
        const remainingMs = deadlineMs - nowMs();
        if (remainingMs <= 0) {
            return false;
        }

        await new Promise<void>((resolve) => {
            globalThis.setTimeout(resolve, Math.min(backgroundBridgePollMs, Math.max(1, remainingMs)));
        });
    }

    return true;
};

export const noteSlowBackgroundBridgeCall = (cooldownMs = slowBackgroundBridgeCooldownMs): void => {
    extendBackgroundBridgeBlock(cooldownMs);
};

export const runInteractiveBridgeCall = async <T>(
    callback: () => Promise<T> | T,
    quietWindowMs = interactiveBridgeQuietWindowMs,
): Promise<T> => {
    activeInteractiveBridgeCalls += 1;
    extendBackgroundBridgeBlock(quietWindowMs);
    try {
        return await callback();
    } finally {
        activeInteractiveBridgeCalls = Math.max(0, activeInteractiveBridgeCalls - 1);
        extendBackgroundBridgeBlock(quietWindowMs);
    }
};

export const runBackgroundBridgeCall = async <T>(
    callback: () => Promise<T> | T,
    options: BackgroundBridgeCallOptions<T> = {},
): Promise<T> => {
    const {
        maxWaitMs = 500,
        onTimeout,
        cooldownMsAfter = 0,
    } = options;

    const ready = await waitForBackgroundBridgeWindow(maxWaitMs);
    if (!ready) {
        if (onTimeout) {
            return await onTimeout();
        }

        return await callback();
    }

    activeBackgroundBridgeCalls += 1;
    try {
        return await callback();
    } finally {
        activeBackgroundBridgeCalls = Math.max(0, activeBackgroundBridgeCalls - 1);
        extendBackgroundBridgeBlock(cooldownMsAfter);
    }
};

export const resetBridgeLoadGateForTests = (): void => {
    activeInteractiveBridgeCalls = 0;
    activeBackgroundBridgeCalls = 0;
    backgroundBridgeBlockedUntilMs = 0;
};