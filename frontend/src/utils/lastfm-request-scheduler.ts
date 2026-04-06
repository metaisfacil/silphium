import type { RequestTarget } from './musicbrainz-request-scheduler';

const normalizeRequestTarget = (target?: RequestTarget): { server: string; path: string } => {
    const server = target?.server?.trim() || '(unknown-server)';
    const path = target?.path?.trim() || '(unknown-path)';
    return { server, path };
};

const logLastFmNetworkRequest = (details: string, target?: RequestTarget): void => {
    const normalizedTarget = normalizeRequestTarget(target);
    console.info(`[LFM] network request: server=${normalizedTarget.server} path=${normalizedTarget.path} ${details}`);
};

export const scheduleLastFmRequest = async <T>(request: () => Promise<T>, target?: RequestTarget): Promise<T> => {
    logLastFmNetworkRequest('queued=false waitMs=0 cooldownMs=0', target);
    return await request();
};
