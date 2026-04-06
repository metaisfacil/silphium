const defaultMusicBrainzRequestGapMs = 1000;

type RequestService = 'MBZ' | 'LBZ';

export type RequestTarget = {
    server?: string;
    path?: string;
};

const normalizeRequestTarget = (target?: RequestTarget): { server: string; path: string } => {
    const server = target?.server?.trim() || '(unknown-server)';
    const path = target?.path?.trim() || '(unknown-path)';
    return { server, path };
};

const logNetworkRequest = (service: RequestService, details: string, target?: RequestTarget): void => {
    const normalizedTarget = normalizeRequestTarget(target);
    console.info(`[${service}] network request: server=${normalizedTarget.server} path=${normalizedTarget.path} ${details}`);
};

const createRequestScheduler = (service: RequestService, getCooldownMs: () => number) => {
    let requestQueue: Promise<void> = Promise.resolve();
    let nextRequestStartAt = 0;

    return async <T>(request: () => Promise<T>, target?: RequestTarget): Promise<T> => {
        const run = async (): Promise<T> => {
            const now = Date.now();
            const waitMs = Math.max(0, nextRequestStartAt - now);
            const cooldownMs = getCooldownMs();
            logNetworkRequest(service, `queued=true waitMs=${waitMs} cooldownMs=${cooldownMs}`, target);
            if (waitMs > 0) {
                await delay(waitMs);
            }

            nextRequestStartAt = Date.now() + cooldownMs;
            return request();
        };

        const scheduled = requestQueue.then(run, run);
        requestQueue = scheduled.then(() => undefined, () => undefined);
        return scheduled;
    };
};

const delay = async (ms: number): Promise<void> => {
    await new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    });
};

export const scheduleMusicBrainzRequest = createRequestScheduler(
    'MBZ',
    () => defaultMusicBrainzRequestGapMs,
);

export const scheduleListenBrainzRequest = async <T>(request: () => Promise<T>, target?: RequestTarget): Promise<T> => {
    logNetworkRequest('LBZ', 'queued=false waitMs=0 cooldownMs=0', target);
    return await request();
};
