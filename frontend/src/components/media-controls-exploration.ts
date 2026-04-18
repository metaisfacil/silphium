import type { MusicBrainzExplorationGraph, Track } from '../types/app-types';
import { lookupMusicBrainzExploration } from '../utils/musicbrainz-entity-helpers';
import { renderExplorationGraph } from './overlays/exploration-graph';
import { getExplorationModalElements, renderExplorationModal } from './overlays/exploration-modal';
import { EventsOn } from '../../wailsjs/runtime/runtime';

type ExplorationButtonOptions = {
    getActiveTrack: () => Track | undefined;
};

type ExplorationProgress = {
    requestId: string;
    message: string;
    current: number;
    total: number;
    done: boolean;
};

const EXPLORATION_PROGRESS_EVENT = 'silphium:musicbrainz:exploration-progress';
const EXPLORATION_CACHE_VERSION = 'exclude-no-label-v5';

let activeExplorationGraph: ReturnType<typeof renderExplorationGraph> | null = null;
let activeExplorationRequestVersion = 0;
let activeExplorationRequestId: string | null = null;
let removeExplorationProgressListener: (() => void) | null = null;
const explorationCache = new Map<string, MusicBrainzExplorationGraph>();

const trackExplorationKey = (track: Track): string => {
    const artistIds = Array.from(new Set([
        track.mbIds.artistId?.trim() || '',
        ...track.artistMbids.map((artistId) => artistId.trim()),
    ].filter((artistId) => artistId !== ''))).sort();

    return [
        EXPLORATION_CACHE_VERSION,
        track.mbIds.recordingId?.trim() || '',
        track.mbIds.releaseId?.trim() || '',
        track.mbIds.labelId?.trim() || '',
        artistIds.join(','),
    ].join('|');
};

export const canExploreTrack = (track?: Track): boolean => {
    if (!track) {
        return false;
    }

    return Boolean(
        track.mbIds.recordingId?.trim()
        || track.mbIds.releaseId?.trim()
        || track.mbIds.artistId?.trim()
        || track.mbIds.labelId?.trim()
        || track.artistMbids.some((artistId) => artistId.trim() !== ''),
    );
};

const destroyActiveExplorationGraph = (): void => {
    activeExplorationGraph?.destroy();
    activeExplorationGraph = null;
};

const createProgressIndicator = (progress?: ExplorationProgress): HTMLDivElement => {
    const loading = document.createElement('div');
    loading.className = 'exploration-loading';

    const body = document.createElement('div');
    body.className = 'exploration-loading-body';

    const message = document.createElement('p');
    message.className = 'exploration-loading-message';

    const bar = document.createElement('div');
    bar.className = 'exploration-loading-bar';

    const fill = document.createElement('div');
    fill.className = 'exploration-loading-bar-fill';
    bar.append(fill);

    const stats = document.createElement('p');
    stats.className = 'exploration-loading-stats';

    body.append(message, bar, stats);
    loading.append(body);

    const total = Math.max(progress?.total || 0, progress?.current || 0);
    const percent = total > 0 ? Math.min(100, Math.round(((progress?.current || 0) / total) * 100)) : 14;
    fill.style.width = `${percent}%`;
    fill.classList.toggle('is-indeterminate', total === 0 && !progress?.done);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(Math.max(total, 1)));
    bar.setAttribute('aria-valuenow', String(progress?.current || 0));

    message.textContent = progress?.message || 'Loading MusicBrainz connections...';
    stats.textContent = total > 0
        ? `${Math.min(progress?.current || 0, total)} of ${total} MusicBrainz requests completed`
        : 'Preparing MusicBrainz requests...';

    return loading;
};

const renderExplorationLoading = (content: HTMLElement, progress?: ExplorationProgress): void => {
    destroyActiveExplorationGraph();
    content.replaceChildren(createProgressIndicator(progress));
};

const updateExplorationLoading = (content: HTMLElement, progress: ExplorationProgress): void => {
    const existing = content.querySelector('.exploration-loading') as HTMLDivElement | null;
    if (!existing) {
        renderExplorationLoading(content, progress);
        return;
    }

    const replacement = createProgressIndicator(progress);
    existing.replaceWith(replacement);
};

const ensureExplorationProgressListener = (): void => {
    if (removeExplorationProgressListener) {
        return;
    }

    removeExplorationProgressListener = EventsOn(EXPLORATION_PROGRESS_EVENT, (progress: ExplorationProgress) => {
        if (!progress || progress.requestId !== activeExplorationRequestId) {
            return;
        }

        const modal = document.getElementById('exploration-modal') as HTMLDivElement | null;
        if (!modal || modal.hidden) {
            return;
        }

        const { explorationContent } = getExplorationModalElements(document);
        updateExplorationLoading(explorationContent, progress);
    });
};

const renderExplorationMessage = (content: HTMLElement, className: string, message: string): void => {
    destroyActiveExplorationGraph();
    const status = document.createElement('div');
    status.className = className;
    status.textContent = message;
    content.replaceChildren(status);
};

const renderExplorationData = (content: HTMLElement, graph: MusicBrainzExplorationGraph): void => {
    destroyActiveExplorationGraph();

    if (!graph.found || graph.nodes.length === 0) {
        renderExplorationMessage(content, 'exploration-empty', graph.summary || 'No MusicBrainz exploration data found.');
        return;
    }

    const meta = document.createElement('div');
    meta.className = 'exploration-meta';

    const summary = document.createElement('p');
    summary.className = 'exploration-summary';
    summary.textContent = graph.summary || 'MusicBrainz connections';
    meta.append(summary);

    const counts = document.createElement('p');
    counts.className = 'exploration-counts';
    counts.textContent = `${graph.nodes.length} nodes, ${graph.edges.length} links`;
    const countsRow = document.createElement('div');
    countsRow.className = 'exploration-counts-row';
    countsRow.append(counts);

    if (graph.warnings.length > 0) {
        const warningIndicator = document.createElement('span');
        warningIndicator.className = 'exploration-warning-indicator';
        warningIndicator.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10.73 4.57C11.3 3.57 12.7 3.57 13.27 4.57L21.14 18.27C21.72 19.29 20.99 20.55 19.86 20.55H4.14C3.01 20.55 2.28 19.29 2.86 18.27L10.73 4.57ZM12 9C11.31 9 10.75 9.56 10.75 10.25V13.25C10.75 13.94 11.31 14.5 12 14.5C12.69 14.5 13.25 13.94 13.25 13.25V10.25C13.25 9.56 12.69 9 12 9ZM12 18C11.31 18 10.75 17.44 10.75 16.75C10.75 16.06 11.31 15.5 12 15.5C12.69 15.5 13.25 16.06 13.25 16.75C13.25 17.44 12.69 18 12 18Z"/></svg>';
        warningIndicator.setAttribute('role', 'img');
        warningIndicator.tabIndex = 0;
        const tooltipText = ['Warnings:', ...graph.warnings.map((warning) => `- ${warning}`)].join('\n');
        warningIndicator.title = tooltipText;
        warningIndicator.setAttribute('aria-label', tooltipText);
        countsRow.append(warningIndicator);
    }

    meta.append(countsRow);

    const graphHost = document.createElement('div');
    graphHost.id = 'exploration-graph';
    graphHost.className = 'exploration-graph';

    content.replaceChildren(meta, graphHost);
    activeExplorationGraph = renderExplorationGraph(graphHost, graph);
};

const ensureExplorationModal = (): HTMLDivElement | null => {
    let modal = document.getElementById('exploration-modal') as HTMLDivElement | null;
    if (modal) {
        return modal;
    }

    document.body.insertAdjacentHTML('beforeend', renderExplorationModal());
    modal = document.getElementById('exploration-modal') as HTMLDivElement | null;
    return modal;
};

const closeExplorationModal = (modal: HTMLDivElement, content: HTMLElement, title: HTMLElement): void => {
    activeExplorationRequestVersion += 1;
    activeExplorationRequestId = null;
    modal.classList.remove('is-visible');
    window.setTimeout(() => {
        destroyActiveExplorationGraph();
        content.replaceChildren();
        title.textContent = 'Connection Explorer';
        modal.hidden = true;
    }, 200);
};

const openExplorationModal = async (track: Track): Promise<void> => {
    const modal = ensureExplorationModal();
    if (!modal) {
        return;
    }

    ensureExplorationProgressListener();

    modal.hidden = false;
    window.requestAnimationFrame(() => {
        if (!modal.hidden) {
            modal.classList.add('is-visible');
        }
    });
    const { explorationClose, explorationContent, explorationTitle } = getExplorationModalElements(document);
    explorationClose.onclick = () => {
        closeExplorationModal(modal, explorationContent, explorationTitle);
    };

    explorationTitle.textContent = `Connection Explorer`;
    renderExplorationLoading(explorationContent);

    activeExplorationRequestVersion += 1;
    const requestVersion = activeExplorationRequestVersion;
    const cacheKey = trackExplorationKey(track);
    const cached = explorationCache.get(cacheKey);
    if (cached) {
        activeExplorationRequestId = null;
        renderExplorationData(explorationContent, cached);
        return;
    }

    const requestId = `exploration-${Date.now()}-${requestVersion}-${Math.random().toString(36).slice(2, 8)}`;
    activeExplorationRequestId = requestId;
    const graph = await lookupMusicBrainzExploration(track, requestId);
    if (requestVersion !== activeExplorationRequestVersion || modal.hidden) {
        return;
    }

    activeExplorationRequestId = null;
    explorationCache.set(cacheKey, graph);
    renderExplorationData(explorationContent, graph);
};

export function setupExplorationButton(root: ParentNode, options: ExplorationButtonOptions) {
    const btn = root.querySelector('#exploration-btn') as HTMLButtonElement | null;
    if (!btn) return;
    if (btn.dataset.explorationBound === 'true') {
        return;
    }

    btn.dataset.explorationBound = 'true';
    btn.classList.add('exploration-btn');
    btn.hidden = true;
    btn.disabled = true;
    btn.addEventListener('click', () => {
        const activeTrack = options.getActiveTrack();
        if (!activeTrack || !canExploreTrack(activeTrack)) {
            return;
        }

        void openExplorationModal(activeTrack);
    });
}

export function updateExplorationButton(root: ParentNode, track?: Track): void {
    const btn = root.querySelector('#exploration-btn') as HTMLButtonElement | null;
    if (!btn) {
        return;
    }

    const enabled = canExploreTrack(track);
    btn.hidden = !enabled;
    btn.disabled = !enabled;
    btn.title = enabled
        ? 'Explore connections between entities'
        : 'This track has no tagged MusicBrainz IDs';
}
