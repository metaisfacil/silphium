import { BrowserOpenURL } from '../wailsjs/runtime/runtime';

const MB_BASE = 'https://musicbrainz.org';

export type MusicBrainzIds = {
    recordingId?: string;
    releaseId?: string;
    artistId?: string;
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

export const applyMbLinks = (
    titleEl: HTMLElement,
    albumEl: HTMLElement,
    artistEl: HTMLElement,
    ids: MusicBrainzIds,
): void => {
    setLink(titleEl, mbUrl('recording', ids.recordingId));
    setLink(albumEl, mbUrl('release', ids.releaseId));
    setLink(artistEl, mbUrl('artist', ids.artistId));
};

export const openMbLink = (el: HTMLElement): void => {
    const url = el.dataset.mbUrl;
    if (url) {
        BrowserOpenURL(url);
    }
};
