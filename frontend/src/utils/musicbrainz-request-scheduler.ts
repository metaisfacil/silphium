const musicBrainzRequestGapMs = 1000;

let requestQueue: Promise<void> = Promise.resolve();
let nextRequestStartAt = 0;

const delay = async (ms: number): Promise<void> => {
    await new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    });
};

export const scheduleMusicBrainzRequest = async <T>(request: () => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
        const now = Date.now();
        const waitMs = Math.max(0, nextRequestStartAt - now);
        if (waitMs > 0) {
            await delay(waitMs);
        }

        nextRequestStartAt = Date.now() + musicBrainzRequestGapMs;
        return request();
    };

    const scheduled = requestQueue.then(run, run);
    requestQueue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
};
