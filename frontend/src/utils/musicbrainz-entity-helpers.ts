import {
    LookupMusicBrainzEntity,
    LookupMusicBrainzExploration,
    LookupTrackMusicBrainzMetadata,
} from '../../wailsjs/go/main/App';
import { BrowserOpenURL } from '../../wailsjs/runtime/runtime';
import { scheduleMusicBrainzRequest } from './musicbrainz-request-scheduler';
import type {
    MusicBrainzEntityInfo,
    MusicBrainzExplorationGraph,
    MusicBrainzEntityType,
    MusicBrainzTrackMetadata,
    Track,
} from '../types/app-types';

const defaultMusicBrainzServerUrl = 'https://musicbrainz.org';
let resolveMusicBrainzServerUrl: (() => string) | null = null;

const musicBrainzServerUrlForLogs = (): string => {
    const resolved = resolveMusicBrainzServerUrl ? resolveMusicBrainzServerUrl().trim() : '';
    return resolved !== '' ? resolved : defaultMusicBrainzServerUrl;
};

export const setMusicBrainzRequestLogServerResolver = (resolver: (() => string) | null): void => {
    resolveMusicBrainzServerUrl = resolver;
};

export const emptyMusicBrainzEntityInfo = (entityType: MusicBrainzEntityType, mbid: string): MusicBrainzEntityInfo => ({
    found: false,
    entityType,
    mbid,
    title: '',
    subtitle: '',
    summary: '',
    facts: [],
    tags: [],
    urls: [],
    rawJson: '',
});

const emptyMusicBrainzTrackMetadata = (releaseId: string): MusicBrainzTrackMetadata => ({
    found: false,
    recordingId: '',
    releaseId,
    title: '',
    album: '',
    artist: '',
    artistCredits: [],
});

const emptyMusicBrainzExplorationGraph = (): MusicBrainzExplorationGraph => ({
    found: false,
    title: 'MusicBrainz exploration',
    summary: 'No MusicBrainz exploration data found.',
    nodes: [],
    edges: [],
    warnings: [],
});

export const musicBrainzMBIDSearchQuery = (entityType: string, mbid: string): string => {
    const normalizedEntityType = entityType.trim().toLowerCase();
    const normalizedMBID = mbid.trim().toLowerCase();
    if (normalizedMBID === '') {
        return '';
    }

    switch (normalizedEntityType) {
        case 'artist':
            return `mbid-artist:${normalizedMBID}`;
        case 'release':
            return `mbid-release:${normalizedMBID}`;
        case 'recording':
            return `mbid-recording:${normalizedMBID}`;
        default:
            return '';
    }
};

export const lookupMusicBrainzTrackMetadata = async (recordingId: string, releaseId: string): Promise<MusicBrainzTrackMetadata> => {
    const cleanRecordingId = recordingId.trim();
    const cleanReleaseId = releaseId.trim();
    if (!cleanRecordingId && !cleanReleaseId) {
        return emptyMusicBrainzTrackMetadata(cleanReleaseId);
    }

    try {
        const releasePath = cleanReleaseId
            ? `/ws/2/release/${cleanReleaseId}?fmt=json&inc=artists+labels`
            : `/ws/2/recording/${cleanRecordingId}?fmt=json&inc=artists+releases`;
        return await scheduleMusicBrainzRequest(async () => (
            await LookupTrackMusicBrainzMetadata(cleanRecordingId, cleanReleaseId) as MusicBrainzTrackMetadata
        ), {
            server: musicBrainzServerUrlForLogs(),
            path: releasePath,
        });
    } catch (error) {
        console.error(error);
        return emptyMusicBrainzTrackMetadata(cleanReleaseId);
    }
};

export const lookupMusicBrainzEntity = async (entityType: MusicBrainzEntityType, mbid: string): Promise<MusicBrainzEntityInfo> => {
    try {
        return await scheduleMusicBrainzRequest(async () => (
            await LookupMusicBrainzEntity(entityType, mbid) as MusicBrainzEntityInfo
        ), {
            server: musicBrainzServerUrlForLogs(),
            path: `/ws/2/${entityType}/${mbid}?fmt=json&inc=...`,
        });
    } catch (error) {
        console.error(error);
        return emptyMusicBrainzEntityInfo(entityType, mbid);
    }
};

export const lookupMusicBrainzExploration = async (track: Track, requestId: string): Promise<MusicBrainzExplorationGraph> => {
    const recordingId = track.mbIds.recordingId?.trim() || '';
    const releaseId = track.mbIds.releaseId?.trim() || '';
    const labelId = track.mbIds.labelId?.trim() || '';
    const artistIds = Array.from(new Set([
        track.mbIds.artistId?.trim() || '',
        ...track.artistMbids.map((artistId) => artistId.trim()),
        ...track.mbArtistCredits.map((credit) => credit.artistId?.trim() || ''),
    ].filter((artistId) => artistId !== '')));

    if (!recordingId && !releaseId && artistIds.length === 0 && !labelId) {
        return emptyMusicBrainzExplorationGraph();
    }

    try {
        return await scheduleMusicBrainzRequest(async () => (
            await LookupMusicBrainzExploration(recordingId, releaseId, artistIds, labelId, requestId) as MusicBrainzExplorationGraph
        ), {
            server: musicBrainzServerUrlForLogs(),
            path: '/ws/2/exploration (composite lookup)',
        });
    } catch (error) {
        console.error(error);
        return emptyMusicBrainzExplorationGraph();
    }
};

export const mbidForTrackEntity = (track: Track, entityType: MusicBrainzEntityType): string => {
    if (entityType === 'recording') {
        return track.mbIds.recordingId || '';
    }

    if (entityType === 'release') {
        return track.mbIds.releaseId || '';
    }

    if (entityType === 'label') {
        return track.mbIds.labelId || '';
    }

    return track.mbIds.artistId || track.artistMbids[0] || '';
};

export const faviconUrlForResource = (resource: string): string | undefined => {
    try {
        const parsed = new URL(resource);
        return `${parsed.origin}/favicon.ico`;
    } catch {
        return undefined;
    }
};

export const renderMusicBrainzEntityContent = (
    entity: MusicBrainzEntityInfo,
    titleElement: HTMLElement,
    contentElement: HTMLElement,
): void => {
    contentElement.innerHTML = '';

    const entityTypeLabel = (entity.entityType || 'entity').trim().toLowerCase();
    titleElement.textContent = `MusicBrainz ${entityTypeLabel} info`;

    const details = [...entity.facts];
    const disambiguation = entity.summary?.trim() || '';
    if (disambiguation) {
        details.push({
            label: 'Disambiguation',
            value: disambiguation,
        });
    }

    if (details.length > 0) {
        const factsTitle = document.createElement('p');
        factsTitle.className = 'mb-entity-section-title';
        factsTitle.textContent = 'Details';
        contentElement.append(factsTitle);

        const facts = document.createElement('div');
        facts.className = 'mb-entity-facts';
        for (const fact of details) {
            const label = document.createElement('p');
            label.className = 'mb-entity-fact-label';
            label.textContent = fact.label;

            const value = document.createElement('p');
            value.className = 'mb-entity-fact-value';
            value.textContent = fact.value;

            facts.append(label, value);
        }

        contentElement.append(facts);
    }

    if (entity.tags.length > 0) {
        const tagsTitle = document.createElement('p');
        tagsTitle.className = 'mb-entity-section-title';
        tagsTitle.textContent = 'Tags / genres';
        contentElement.append(tagsTitle);

        const tags = document.createElement('div');
        tags.className = 'mb-entity-tags';
        for (const tag of entity.tags) {
            const chip = document.createElement('p');
            chip.className = 'mb-entity-tag';
            chip.textContent = tag;
            tags.append(chip);
        }

        contentElement.append(tags);
    }

    const linksTitle = document.createElement('p');
    linksTitle.className = 'mb-entity-section-title';
    linksTitle.textContent = 'External Links';
    contentElement.append(linksTitle);

    if (entity.urls.length > 0) {
        const links = document.createElement('ul');
        links.className = 'mb-entity-links';
        for (const url of entity.urls) {
            const listItem = document.createElement('li');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'artist-link-btn';

            const fallback = document.createElement('span');
            fallback.className = 'artist-link-fallback';
            fallback.innerHTML = '<svg class="overlay-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M8.71 15.29C7.93 14.51 7.93 13.24 8.71 12.46L12.46 8.71C13.24 7.93 14.51 7.93 15.29 8.71C16.07 9.49 16.07 10.76 15.29 11.54L14.37 12.46C13.98 12.85 13.98 13.48 14.37 13.87C14.76 14.26 15.39 14.26 15.78 13.87L16.7 12.95C18.27 11.39 18.27 8.86 16.7 7.29C15.14 5.73 12.61 5.73 11.05 7.29L7.29 11.05C5.73 12.61 5.73 15.14 7.29 16.7C8.86 18.27 11.39 18.27 12.95 16.7L13.87 15.78C14.26 15.39 14.26 14.76 13.87 14.37C13.48 13.98 12.85 13.98 12.46 14.37L11.54 15.29C10.76 16.07 9.49 16.07 8.71 15.29Z"/></svg>';

            const faviconUrl = faviconUrlForResource(url.resource);
            if (faviconUrl) {
                const icon = document.createElement('img');
                icon.className = 'artist-link-icon';
                icon.alt = '';
                icon.loading = 'lazy';
                icon.decoding = 'async';
                icon.referrerPolicy = 'no-referrer';
                icon.src = faviconUrl;
                icon.addEventListener('error', () => {
                    icon.remove();
                    fallback.hidden = false;
                });
                fallback.hidden = true;
                button.append(icon, fallback);
            } else {
                fallback.hidden = false;
                button.append(fallback);
            }

            button.title = `${url.type || 'Link'}: ${url.resource}`;
            button.setAttribute('aria-label', button.title);
            button.addEventListener('click', () => {
                void BrowserOpenURL(url.resource);
            });

            listItem.append(button);
            links.append(listItem);
        }

        contentElement.append(links);
    } else {
        const emptyLinks = document.createElement('p');
        emptyLinks.className = 'mb-entity-empty';
        emptyLinks.textContent = 'None available.';
        contentElement.append(emptyLinks);
    }

    const rawDetails = document.createElement('details');
    rawDetails.className = 'mb-entity-raw-details';

    const rawSummary = document.createElement('summary');
    rawSummary.className = 'mb-entity-raw-summary';
    rawSummary.textContent = 'Raw payload';
    rawDetails.append(rawSummary);

    const raw = document.createElement('pre');
    raw.className = 'mb-entity-raw';
    raw.textContent = entity.rawJson || 'No payload returned.';
    rawDetails.append(raw);
    contentElement.append(rawDetails);
};
