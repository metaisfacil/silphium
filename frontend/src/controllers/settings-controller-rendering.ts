import type { AppLibraryFolder, AudioOutputDevice, CoverArtPrioritySource, CustomSendToAction, MusicBrainzTagWorkerProgress, ScrobbleRule } from '../types/app-types';
import { describeLibraryFolderConnection, describeScrobbleRule, libraryFolderMusicBrainzTagWorkerScansEnabled, normalizeLibraryFolderKind } from '../utils/main-helpers';
import { formatCustomActionScopeLabel, formatEtaLabel, labelForCoverArtPriority, normalizeMusicBrainzTagWorkerProgress } from './settings-controller-utils';

export const renderFavoritePlaylistList = (
    listElement: HTMLUListElement,
    removeButton: HTMLButtonElement,
    favoritePlaylists: string[],
    selectedFavoritePlaylistIndex: number,
): void => {
    listElement.innerHTML = '';

    if (favoritePlaylists.length === 0) {
        listElement.innerHTML = '<li class="settings-favorite-empty">No favourite playlists configured.</li>';
        removeButton.disabled = true;
        return;
    }

    favoritePlaylists.forEach((playlistPath, index) => {
        const item = document.createElement('li');
        item.className = 'settings-favorite-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `settings-favorite-item-btn${index === selectedFavoritePlaylistIndex ? ' is-selected' : ''}`;
        button.dataset.favoritePlaylistIndex = String(index);
        button.title = playlistPath;
        button.textContent = playlistPath;

        item.append(button);
        listElement.append(item);
    });

    removeButton.disabled = selectedFavoritePlaylistIndex < 0;
};

export const renderScrobbleRuleList = (
    listElement: HTMLUListElement,
    removeButton: HTMLButtonElement,
    scrobbleRules: ScrobbleRule[],
    selectedScrobbleRuleIndex: number,
): void => {
    listElement.innerHTML = '';

    if (scrobbleRules.length === 0) {
        listElement.innerHTML = '<li class="settings-folder-empty">No scrobble rules configured.</li>';
        removeButton.disabled = true;
        return;
    }

    scrobbleRules.forEach((rule, index) => {
        const item = document.createElement('li');
        item.className = 'settings-folder-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `settings-folder-item-btn${index === selectedScrobbleRuleIndex ? ' is-selected' : ''}`;
        button.dataset.scrobbleRuleIndex = String(index);
        button.title = `${describeScrobbleRule(rule)}\nDouble-click to edit`;
        button.textContent = describeScrobbleRule(rule);

        item.append(button);
        listElement.append(item);
    });

    removeButton.disabled = selectedScrobbleRuleIndex < 0;
};

export const renderCustomSendToActionList = (
    listElement: HTMLUListElement,
    removeButton: HTMLButtonElement,
    customSendToActions: CustomSendToAction[],
    selectedCustomSendToActionIndex: number,
): void => {
    listElement.innerHTML = '';

    if (customSendToActions.length === 0) {
        listElement.innerHTML = '<li class="settings-folder-empty">No send to actions configured.</li>';
        removeButton.disabled = true;
        return;
    }

    customSendToActions.forEach((action, index) => {
        const item = document.createElement('li');
        item.className = 'settings-folder-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `settings-folder-item-btn${index === selectedCustomSendToActionIndex ? ' is-selected' : ''}`;
        button.dataset.sendToActionIndex = String(index);
        button.title = `${formatCustomActionScopeLabel(action.scope)}: ${action.commandTemplate}\nDouble-click to edit`;
        button.textContent = `[${formatCustomActionScopeLabel(action.scope)}] ${action.title}`;

        item.append(button);
        listElement.append(item);
    });

    removeButton.disabled = selectedCustomSendToActionIndex < 0;
};

export const renderLibraryFolderList = (
    listElement: HTMLUListElement,
    removeButton: HTMLButtonElement,
    libraryFolders: AppLibraryFolder[],
    selectedLibraryFolderIndex: number,
): void => {
    listElement.innerHTML = '';

    if (libraryFolders.length === 0) {
        listElement.innerHTML = '<li class="settings-library-folder-empty">No library folders configured.</li>';
        removeButton.disabled = true;
        return;
    }

    libraryFolders.forEach((folder, index) => {
        const folderKind = normalizeLibraryFolderKind(folder.kind);
        const item = document.createElement('li');
        item.className = 'settings-library-folder-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `settings-library-folder-item-btn${index === selectedLibraryFolderIndex ? ' is-selected' : ''}`;
        button.dataset.libraryFolderIndex = String(index);
        button.title = [
            folder.label ? `Label: ${folder.label}` : '',
            folderKind === 'remote' ? `Remote: ${describeLibraryFolderConnection(folder)}` : folder.path,
            folderKind === 'remote' || libraryFolderMusicBrainzTagWorkerScansEnabled(folder)
                ? ''
                : 'MusicBrainz worker scans disabled',
            folderKind === 'remote'
                ? 'Double-click to change host, port, and label'
                : 'Double-click to change label, release depth, and MusicBrainz worker scans',
        ].filter((line) => line !== '').join('\n');

        const pathLabel = document.createElement('span');
        pathLabel.className = 'settings-library-folder-path';
        pathLabel.textContent = folderKind === 'remote' ? describeLibraryFolderConnection(folder) : folder.path;

        const meta = document.createElement('span');
        meta.className = 'settings-library-folder-meta';

        if (folder.label) {
            const labelBadge = document.createElement('span');
            labelBadge.className = 'settings-library-folder-label-badge';
            labelBadge.textContent = `Label: ${folder.label}`;
            meta.append(labelBadge);
        }

        const depthBadge = document.createElement('span');
        depthBadge.className = 'settings-library-folder-depth-badge';
        depthBadge.textContent = folderKind === 'remote'
            ? 'Shared library'
            : folder.releaseDepth > 0
                ? `Depth ${folder.releaseDepth}`
                : 'Whole folder';

        meta.append(depthBadge);

        if (folderKind !== 'remote' && !libraryFolderMusicBrainzTagWorkerScansEnabled(folder)) {
            const workerBadge = document.createElement('span');
            workerBadge.className = 'settings-library-folder-label-badge';
            workerBadge.textContent = 'MB scans off';
            meta.append(workerBadge);
        }

        button.append(pathLabel, meta);
        item.append(button);
        listElement.append(item);
    });

    removeButton.disabled = selectedLibraryFolderIndex < 0;
};

export const renderCoverArtPriorityList = (
    listElement: HTMLUListElement,
    coverArtPriority: CoverArtPrioritySource[],
    coverArtPriorityOrder: CoverArtPrioritySource[],
): void => {
    listElement.innerHTML = '';

    const enabled = new Set<CoverArtPrioritySource>(coverArtPriority);

    coverArtPriorityOrder.forEach((source, index) => {
        const item = document.createElement('li');
        item.className = 'settings-priority-item';

        const row = document.createElement('div');
        row.className = `settings-priority-item-btn${enabled.has(source) ? '' : ' is-disabled'}`;
        row.dataset.coverArtPriorityIndex = String(index);
        row.draggable = true;
        row.title = 'Drag to change priority';

        const handle = document.createElement('span');
        handle.className = 'settings-priority-handle';
        handle.setAttribute('aria-hidden', 'true');
        handle.textContent = '=';

        const label = document.createElement('label');
        label.className = 'settings-priority-checkbox-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'settings-checkbox';
        checkbox.dataset.coverArtPrioritySource = source;
        checkbox.checked = enabled.has(source);

        const text = document.createElement('span');
        text.className = 'settings-priority-label';
        text.textContent = labelForCoverArtPriority(source);

        label.append(checkbox, text);
        row.append(handle, label);

        item.append(row);
        listElement.append(item);
    });
};

export const renderAudioOutputDeviceOptions = (
    selectElement: HTMLSelectElement,
    audioOutputDevices: AudioOutputDevice[],
    selectedDevice: string,
): void => {
    selectElement.innerHTML = '';

    const primaryDriverOption = document.createElement('option');
    primaryDriverOption.value = 'default';
    primaryDriverOption.textContent = 'Primary Sound Driver';
    selectElement.append(primaryDriverOption);

    const normalizedDevices = audioOutputDevices.length > 0
        ? audioOutputDevices
        : [{ id: 'default', name: 'System default output device', backend: 'auto', isDefault: true }];

    normalizedDevices.forEach((device) => {
        const normalizedId = (device.id || 'default').trim() || 'default';
        if (normalizedId === 'default') {
            return;
        }

        const option = document.createElement('option');
        option.value = normalizedId;
        const deviceName = device.name || device.id || 'System default output device';
        option.textContent = deviceName;
        selectElement.append(option);
    });

    const targetDevice = selectedDevice.trim() || 'default';
    if (targetDevice === 'default') {
        selectElement.value = 'default';
        return;
    }

    const hasExact = normalizedDevices.some((device) => (device.id || 'default') === targetDevice);
    if (!hasExact) {
        const fallbackOption = document.createElement('option');
        fallbackOption.value = targetDevice;
        fallbackOption.textContent = `${targetDevice} (saved)`;
        selectElement.append(fallbackOption);
    }

    selectElement.value = hasExact ? targetDevice : targetDevice;
};

export type MusicBrainzProgressRenderContext = {
    progressBar: HTMLDivElement;
    progressFill: HTMLSpanElement;
    progressValue: HTMLSpanElement;
    progressRemaining: HTMLSpanElement;
    progressStatus: HTMLParagraphElement;
};

export type MusicBrainzProgressEtaState = {
    entityRatePerSecond: number | null;
    lastSampleAtMs: number | null;
    lastCompletedEntityLookups: number;
};

export const resetMusicBrainzTagWorkerEtaTracking = (eta: MusicBrainzProgressEtaState): void => {
    eta.entityRatePerSecond = null;
    eta.lastSampleAtMs = null;
    eta.lastCompletedEntityLookups = 0;
};

export const estimateMusicBrainzTagWorkerEtaSeconds = (
    nextProgress: MusicBrainzTagWorkerProgress,
    currentProgress: MusicBrainzTagWorkerProgress,
    eta: MusicBrainzProgressEtaState,
): number | null => {
    if (!nextProgress.enabled || !nextProgress.active || nextProgress.pendingEntityLookups <= 0) {
        resetMusicBrainzTagWorkerEtaTracking(eta);
        return null;
    }

    const nowMs = Date.now();
    const completedEntityLookups = nextProgress.completedEntityLookups;
    const previousSampleAtMs = eta.lastSampleAtMs;
    const shouldResetTracking = previousSampleAtMs === null
        || completedEntityLookups < eta.lastCompletedEntityLookups
        || !currentProgress.active
        || currentProgress.pendingEntityLookups <= 0;

    if (shouldResetTracking) {
        eta.entityRatePerSecond = null;
        eta.lastSampleAtMs = nowMs;
        eta.lastCompletedEntityLookups = completedEntityLookups;
        return null;
    }

    const elapsedSeconds = Math.max(0, (nowMs - previousSampleAtMs) / 1000);
    const completedDelta = completedEntityLookups - eta.lastCompletedEntityLookups;
    if (completedDelta > 0 && elapsedSeconds > 0) {
        const instantRate = completedDelta / elapsedSeconds;
        eta.entityRatePerSecond = eta.entityRatePerSecond === null
            ? instantRate
            : (eta.entityRatePerSecond * 0.65) + (instantRate * 0.35);
        eta.lastSampleAtMs = nowMs;
        eta.lastCompletedEntityLookups = completedEntityLookups;
    }

    if (eta.entityRatePerSecond === null || eta.entityRatePerSecond <= 0) {
        return null;
    }

    return nextProgress.pendingEntityLookups / eta.entityRatePerSecond;
};

export const renderMusicBrainzTagWorkerProgressUI = (
    value: MusicBrainzTagWorkerProgress,
    ctx: MusicBrainzProgressRenderContext,
    currentProgress: MusicBrainzTagWorkerProgress,
    eta: MusicBrainzProgressEtaState,
): MusicBrainzTagWorkerProgress => {
    const nextProgress = normalizeMusicBrainzTagWorkerProgress(value);
    const etaSeconds = estimateMusicBrainzTagWorkerEtaSeconds(nextProgress, currentProgress, eta);
    const progressPercent = Math.round(nextProgress.progress * 100);

    ctx.progressValue.textContent = `${progressPercent}%`;
    ctx.progressFill.style.width = `${progressPercent}%`;
    ctx.progressBar.setAttribute('aria-valuenow', String(progressPercent));
    ctx.progressBar.setAttribute('aria-valuetext', `${progressPercent}% complete`);
    ctx.progressBar.classList.toggle('is-active', nextProgress.active);
    ctx.progressBar.classList.toggle('is-disabled', !nextProgress.enabled);

    const etaLabel = formatEtaLabel(etaSeconds);
    const summaryParts: string[] = [];
    const completedTrackScans = nextProgress.completedTrackScans;
    const pendingTrackScans = nextProgress.pendingTrackScans;
    const completedEntityLookups = nextProgress.completedEntityLookups;
    const pendingEntityLookups = nextProgress.pendingEntityLookups;

    if (completedTrackScans > 0 || pendingTrackScans > 0 || (nextProgress.totalTrackScans > 0 && nextProgress.totalEntityLookups <= 0)) {
        summaryParts.push(`${completedTrackScans} ${completedTrackScans === 1 ? 'track' : 'tracks'} scanned`);
        if (pendingTrackScans > 0) {
            summaryParts.push(`${pendingTrackScans} ${pendingTrackScans === 1 ? 'track' : 'tracks'} still to scan`);
        }
    }

    if (completedEntityLookups > 0 || pendingEntityLookups > 0 || (nextProgress.totalEntityLookups > 0 && nextProgress.totalTrackScans <= 0)) {
        summaryParts.push(`${completedEntityLookups} ${completedEntityLookups === 1 ? 'entity' : 'entities'} processed`);
        if (pendingEntityLookups > 0) {
            summaryParts.push(`${pendingEntityLookups} ${pendingEntityLookups === 1 ? 'entity' : 'entities'} still to look up`);
        }
    }

    if (summaryParts.length === 0) {
        summaryParts.push('No metadata work queued');
    }

    ctx.progressRemaining.textContent = `${summaryParts.join(' • ')}${etaLabel ? ` • ${etaLabel} remaining` : '.'}`;

    if (!nextProgress.enabled) {
        ctx.progressStatus.textContent = 'MusicBrainz tag database is disabled.';
        return nextProgress;
    }

    if (nextProgress.active) {
        if (nextProgress.pendingTrackScans > 0 && nextProgress.pendingEntityLookups > 0) {
            ctx.progressStatus.textContent = 'Scanning local track metadata and fetching queued MusicBrainz entities.';
            return nextProgress;
        }

        if (nextProgress.pendingTrackScans > 0) {
            ctx.progressStatus.textContent = 'Scanning local track metadata to build the lookup queue.';
            return nextProgress;
        }

        ctx.progressStatus.textContent = 'Fetching queued MusicBrainz entities.';
        return nextProgress;
    }

    ctx.progressStatus.textContent = 'Background metadata index is up to date.';
    return nextProgress;
};
