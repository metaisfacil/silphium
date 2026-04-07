import { BrowserOpenURL } from '../wailsjs/runtime/runtime';

const MB_BASE = 'https://musicbrainz.org';

export type MusicBrainzIds = {
    recordingId?: string;
    releaseId?: string;
    artistId?: string;
    labelId?: string;
};

export type MusicBrainzArtistCredit = {
    name: string;
    artistId?: string;
    joinPhrase: string;
};

type ArtistLinkOptions = {
    artistText?: string;
    artistMbids?: string[];
    artistCredits?: MusicBrainzArtistCredit[];
};

const mbUrl = (type: string, id?: string): string | undefined =>
    id ? `${MB_BASE}/${type}/${id}` : undefined;

const setLink = (el: HTMLElement, url: string | undefined): void => {
    if (url) {
        el.dataset.mbUrl = url;
    } else {
        delete el.dataset.mbUrl;
    }
};

const normalizeArtistMbids = (artistMbids?: string[]): string[] => {
    if (!artistMbids || artistMbids.length === 0) {
        return [];
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const mbid of artistMbids) {
        const clean = mbid.trim();
        if (!clean) {
            continue;
        }

        const key = clean.toLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        normalized.push(clean);
    }

    return normalized;
};

const renderArtistLinks = (
    artistEl: HTMLElement,
    artistText: string,
    artistMbids: string[],
    artistCredits: MusicBrainzArtistCredit[],
    fallbackArtistId?: string,
): void => {
    setLink(artistEl, undefined);
    artistEl.textContent = artistText;

    if (!artistText) {
        return;
    }

    if (artistMbids.length === 0) {
        setLink(artistEl, mbUrl('artist', fallbackArtistId));
        return;
    }

    if (artistMbids.length === 1) {
        setLink(artistEl, mbUrl('artist', artistMbids[0]));
        return;
    }

    if (artistCredits.length === 0) {
        /* v8 ignore next -- normalizeArtistMbids guarantees artistMbids[0] is non-empty when length > 0 */
        setLink(artistEl, mbUrl('artist', artistMbids[0] || fallbackArtistId));
        return;
    }

    artistEl.textContent = '';
    for (let index = 0; index < artistCredits.length; index += 1) {
        const credit = artistCredits[index];
        const artistSpan = document.createElement('span');
        artistSpan.className = 'track-artist-link';
        artistSpan.textContent = credit.name;
        setLink(artistSpan, mbUrl('artist', credit.artistId || artistMbids[index]));
        artistEl.append(artistSpan);

        const joinPhrase = credit.joinPhrase;
        if (joinPhrase) {
            artistEl.append(document.createTextNode(joinPhrase));
        }
    }
};

export const applyMbLinks = (
    titleEl: HTMLElement,
    albumEl: HTMLElement,
    artistEl: HTMLElement,
    ids: MusicBrainzIds,
    options?: ArtistLinkOptions,
): void => {
    setLink(titleEl, mbUrl('recording', ids.recordingId));
    setLink(albumEl, mbUrl('release', ids.releaseId));

    /* v8 ignore next -- HTMLElement.textContent is effectively string-backed for the rendered nodes this helper receives */
    const artistText = options?.artistText ?? artistEl.textContent ?? '';
    const artistMbids = normalizeArtistMbids(options?.artistMbids);
    const artistCredits = (options?.artistCredits || [])
        .map((credit) => ({
            name: credit.name.trim(),
            artistId: credit.artistId?.trim() || undefined,
            joinPhrase: credit.joinPhrase || '',
        }))
        .filter((credit) => credit.name !== '');
    renderArtistLinks(artistEl, artistText, artistMbids, artistCredits, ids.artistId);
};

export const openMbLink = (el: HTMLElement): void => {
    const closest = el.closest('[data-mb-url]');
    const url = closest instanceof HTMLElement ? closest.dataset.mbUrl : el.dataset.mbUrl;
    if (url) {
        BrowserOpenURL(url);
    }
};
