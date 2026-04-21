import type { ArtistDetails, ArtistExternalUrl, Track } from '../types/app-types';
import { faviconUrlForResource } from '../utils/musicbrainz-entity-helpers';

type ArtistInfoElements = {
    artistInfoName: HTMLElement;
    artistInfoType: HTMLElement;
    artistInfoCountry: HTMLElement;
    artistInfoLifeSpan: HTMLElement;
    artistInfoGenres: HTMLElement;
    artistInfoSummary: HTMLElement;
    artistInfoLinks: HTMLElement;
};

type ArtistInfoControllerOptions = {
    elements: ArtistInfoElements;
    getTracks: () => Track[];
    getCurrentTrackIndex: () => number;
    getRequestVersion: () => number;
    lookupArtistByMBID: (mbid: string) => Promise<ArtistDetails>;
    openUrl: (url: string) => unknown;
};

export type ArtistInfoController = ReturnType<typeof createArtistInfoController>;

export const createArtistInfoController = (options: ArtistInfoControllerOptions) => {
    const {
        artistInfoName,
        artistInfoType,
        artistInfoCountry,
        artistInfoLifeSpan,
        artistInfoGenres,
        artistInfoSummary,
        artistInfoLinks,
    } = options.elements;
    const ownerDocument = artistInfoLinks.ownerDocument;
    const ownerWindow = ownerDocument.defaultView ?? window;

    const artistInfoByMBID = new Map<string, ArtistDetails>();
    let expandedArtistLinkGroup: string | null = null;
    let artistInfoContextMenuCopyText = '';
    const artistLinkPanelAnimationMs = 180;
    const artistLinkPanelResetTimers = new WeakMap<HTMLElement, number>();
    const artistInfoContextMenu = ownerDocument.createElement('div');
    const artistLinkCategoryOrder = [
        'official homepage',
        'discography',
        'lyrics',
        'online data',
        'get the music',
        'other databases',
    ] as const;
    const artistLinkCategoryTypes = new Map<string, string>([
        ['official homepage', 'official homepage'],
        ['fanpage', 'official homepage'],
        ['biography', 'official homepage'],
        ['interview', 'official homepage'],
        ['image', 'official homepage'],
        ['discography', 'discography'],
        ['discography page', 'discography'],
        ['bbc music page', 'discography'],
        ['lyrics', 'lyrics'],
        ['online data', 'online data'],
        ['social network', 'online data'],
        ['myspace', 'online data'],
        ['purevolume', 'online data'],
        ['soundcloud', 'online data'],
        ['video channel', 'online data'],
        ['youtube', 'online data'],
        ['online community', 'online data'],
        ['art gallery', 'online data'],
        ['blog', 'online data'],
        ['crowdfunding', 'online data'],
        ['patronage', 'online data'],
        ['ticketing', 'online data'],
        ['get the music', 'get the music'],
        ['purchase for mail-order', 'get the music'],
        ['purchase for download', 'get the music'],
        ['download for free', 'get the music'],
        ['free streaming', 'get the music'],
        ['streaming', 'get the music'],
        ['apple music', 'get the music'],
        ['bandcamp', 'get the music'],
        ['cd baby', 'get the music'],
        ['youtube music', 'get the music'],
        ['other databases', 'other databases'],
        ['allmusic', 'other databases'],
        ['bandsintown', 'other databases'],
        ['bookbrainz', 'other databases'],
        ['cpdl', 'other databases'],
        ['discogs', 'other databases'],
        ['imdb', 'other databases'],
        ['imslp', 'other databases'],
        ['last.fm', 'other databases'],
        ['secondhandsongs', 'other databases'],
        ['setlistfm', 'other databases'],
        ['songkick', 'other databases'],
        ['vgmdb', 'other databases'],
        ['viaf', 'other databases'],
        ['wikidata', 'other databases'],
        ['wikipedia', 'other databases'],
        ['rateyourmusic', 'other databases'],
        ['sonemic', 'other databases'],
    ]);
    const artistLinkCategoryHosts = new Map<string, string>([
        ['musicbrainz.org', 'online data'],
        ['www.musicbrainz.org', 'online data'],
        ['discogs.com', 'other databases'],
        ['www.discogs.com', 'other databases'],
        ['rateyourmusic.com', 'other databases'],
        ['www.rateyourmusic.com', 'other databases'],
        ['sonemic.com', 'other databases'],
        ['www.sonemic.com', 'other databases'],
        ['allmusic.com', 'other databases'],
        ['www.allmusic.com', 'other databases'],
        ['bandsintown.com', 'other databases'],
        ['www.bandsintown.com', 'other databases'],
        ['bookbrainz.org', 'other databases'],
        ['www.bookbrainz.org', 'other databases'],
        ['cpdl.org', 'other databases'],
        ['www.cpdl.org', 'other databases'],
        ['imdb.com', 'other databases'],
        ['www.imdb.com', 'other databases'],
        ['imslp.org', 'other databases'],
        ['www.imslp.org', 'other databases'],
        ['last.fm', 'other databases'],
        ['www.last.fm', 'other databases'],
        ['secondhandsongs.com', 'other databases'],
        ['www.secondhandsongs.com', 'other databases'],
        ['setlist.fm', 'other databases'],
        ['www.setlist.fm', 'other databases'],
        ['songkick.com', 'other databases'],
        ['www.songkick.com', 'other databases'],
        ['vgmdb.net', 'other databases'],
        ['www.vgmdb.net', 'other databases'],
        ['viaf.org', 'other databases'],
        ['www.viaf.org', 'other databases'],
        ['wikidata.org', 'other databases'],
        ['www.wikidata.org', 'other databases'],
        ['wikipedia.org', 'other databases'],
        ['www.wikipedia.org', 'other databases'],
        ['en.wikipedia.org', 'other databases'],
        ['spotify.com', 'get the music'],
        ['www.spotify.com', 'get the music'],
        ['open.spotify.com', 'get the music'],
        ['spotify.link', 'get the music'],
        ['music.apple.com', 'get the music'],
        ['itunes.apple.com', 'get the music'],
        ['bandcamp.com', 'get the music'],
        ['www.bandcamp.com', 'get the music'],
        ['cdbaby.com', 'get the music'],
        ['www.cdbaby.com', 'get the music'],
        ['music.youtube.com', 'get the music'],
        ['youtube.com', 'online data'],
        ['www.youtube.com', 'online data'],
        ['youtu.be', 'online data'],
        ['soundcloud.com', 'online data'],
        ['www.soundcloud.com', 'online data'],
        ['myspace.com', 'online data'],
        ['www.myspace.com', 'online data'],
        ['purevolume.com', 'online data'],
        ['www.purevolume.com', 'online data'],
        ['facebook.com', 'online data'],
        ['www.facebook.com', 'online data'],
        ['instagram.com', 'online data'],
        ['www.instagram.com', 'online data'],
        ['x.com', 'online data'],
        ['www.x.com', 'online data'],
        ['twitter.com', 'online data'],
        ['www.twitter.com', 'online data'],
        ['tiktok.com', 'online data'],
        ['www.tiktok.com', 'online data'],
        ['amazon.com', 'get the music'],
        ['www.amazon.com', 'get the music'],
        ['music.amazon.com', 'get the music'],
        ['amazon.co.uk', 'get the music'],
        ['www.amazon.co.uk', 'get the music'],
        ['amazon.de', 'get the music'],
        ['www.amazon.de', 'get the music'],
        ['amazon.co.jp', 'get the music'],
        ['www.amazon.co.jp', 'get the music'],
    ]);

    artistInfoContextMenu.className = 'artist-info-links-context-menu';
    artistInfoContextMenu.hidden = true;
    artistInfoContextMenu.setAttribute('role', 'menu');
    artistInfoContextMenu.setAttribute('aria-label', 'Artist link actions');
    ownerDocument.body.append(artistInfoContextMenu);

    const normalizeArtistUrlType = (rawType?: string): string => {
        const trimmed = (rawType || '').trim();
        return trimmed !== '' ? trimmed : 'link';
    };

    const closeArtistInfoContextMenu = (): void => {
        artistInfoContextMenu.hidden = true;
        artistInfoContextMenu.replaceChildren();
        artistInfoContextMenuCopyText = '';
    };

    const fallbackCopyTextToClipboard = (text: string): void => {
        const textarea = ownerDocument.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        ownerDocument.body.append(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);

        const copied = typeof ownerDocument.execCommand === 'function'
            ? ownerDocument.execCommand('copy')
            : false;

        textarea.remove();

        if (!copied) {
            throw new Error('Clipboard text copy is not available in this environment');
        }
    };

    const copyTextToClipboard = async (text: string): Promise<void> => {
        const clipboard = ownerWindow.navigator.clipboard as Clipboard | undefined;
        let browserClipboardError: unknown;

        if (clipboard?.writeText) {
            try {
                await clipboard.writeText(text);
                return;
            } catch (error) {
                browserClipboardError = error;
            }
        }

        try {
            fallbackCopyTextToClipboard(text);
        } catch (fallbackError) {
            if (browserClipboardError) {
                throw browserClipboardError;
            }

            throw fallbackError;
        }
    };

    const positionArtistInfoContextMenu = (clientX: number, clientY: number): void => {
        const margin = 10;
        const rect = artistInfoContextMenu.getBoundingClientRect();
        const clampedX = Math.min(clientX, ownerWindow.innerWidth - rect.width - margin);
        const clampedY = Math.min(clientY, ownerWindow.innerHeight - rect.height - margin);

        artistInfoContextMenu.style.left = `${Math.max(margin, clampedX)}px`;
        artistInfoContextMenu.style.top = `${Math.max(margin, clampedY)}px`;
    };

    const openArtistInfoContextMenu = (clientX: number, clientY: number, label: string, copyText: string): void => {
        artistInfoContextMenuCopyText = copyText.trim();

        const actionButton = ownerDocument.createElement('button');
        actionButton.className = 'artist-info-links-context-menu-item';
        actionButton.type = 'button';
        actionButton.setAttribute('role', 'menuitem');
        actionButton.dataset.artistInfoContextAction = 'copy';
        actionButton.textContent = label;
        actionButton.disabled = artistInfoContextMenuCopyText === '';

        artistInfoContextMenu.replaceChildren(actionButton);
        artistInfoContextMenu.hidden = false;
        positionArtistInfoContextMenu(clientX, clientY);
    };

    const copyableArtistResources = (urls: ArtistExternalUrl[]): string => (
        urls
            .map(({ resource }) => resource.trim())
            .filter((resource) => resource !== '')
            .join('\n')
    );

    const categoryForArtistUrl = (url: ArtistExternalUrl): string => {
        const normalizedType = normalizeArtistUrlType(url.type);
        const mappedByType = artistLinkCategoryTypes.get(normalizedType.toLowerCase());
        if (mappedByType) {
            return mappedByType;
        }

        const host = hostForArtistUrl(url.resource);
        if (host !== '') {
            const mappedByHost = artistLinkCategoryHosts.get(host);
            if (mappedByHost) {
                return mappedByHost;
            }

            if (host.endsWith('.wikipedia.org')) {
                return 'other databases';
            }

            if (host.endsWith('.amazon.com') || host.endsWith('.amazon.co.uk') || host.endsWith('.amazon.de') || host.endsWith('.amazon.co.jp')) {
                return 'get the music';
            }
        }

        return normalizedType;
    };

    const hostForArtistUrl = (resource: string): string => {
        const trimmed = resource.trim();
        if (trimmed === '') {
            return '';
        }

        try {
            const parsed = new URL(trimmed);
            return parsed.hostname.toLowerCase();
        } catch {
            return '';
        }
    };

    const createArtistLinkButton = (url: ArtistExternalUrl, titlePrefix?: string): HTMLButtonElement => {
        const button = document.createElement('button');
        button.className = 'artist-link-btn';
        button.type = 'button';
        button.dataset.artistLinkResource = url.resource;

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

        const typeLabel = titlePrefix || normalizeArtistUrlType(url.type);
        button.title = `${typeLabel}: ${url.resource}`;
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            void options.openUrl(url.resource);
        });
        return button;
    };

    const animateArtistLinkGroupPanel = (panel: HTMLElement, isExpanded: boolean): void => {
        const existingTimer = artistLinkPanelResetTimers.get(panel);
        if (existingTimer !== undefined) {
            window.clearTimeout(existingTimer);
            artistLinkPanelResetTimers.delete(panel);
        }

        panel.setAttribute('aria-hidden', isExpanded ? 'false' : 'true');
        panel.style.overflow = 'hidden';

        const currentHeight = panel.getBoundingClientRect().height;
        panel.style.height = `${currentHeight}px`;

        void panel.offsetHeight;

        if (isExpanded) {
            const targetHeight = panel.scrollHeight;
            panel.style.opacity = '1';
            panel.style.height = `${targetHeight}px`;

            const resetTimer = window.setTimeout(() => {
                if (panel.getAttribute('aria-hidden') === 'false') {
                    panel.style.height = 'auto';
                }
                artistLinkPanelResetTimers.delete(panel);
            }, artistLinkPanelAnimationMs);

            artistLinkPanelResetTimers.set(panel, resetTimer);
            return;
        }

        if (currentHeight === 0) {
            panel.style.opacity = '0';
            panel.style.height = '0px';
            return;
        }

        panel.style.opacity = '0';
        panel.style.height = '0px';
    };

    const applyExpandedArtistLinkGroup = (groupKey: string | null): void => {
        expandedArtistLinkGroup = groupKey;
        const groups = artistInfoLinks.querySelectorAll<HTMLElement>('.artist-link-group');
        groups.forEach((group) => {
            const isExpanded = group.dataset.groupKey === groupKey;
            group.dataset.expanded = isExpanded ? 'true' : 'false';

            const toggle = group.querySelector<HTMLButtonElement>('.artist-link-group-toggle');
            if (toggle) {
                toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            }

            const panel = group.querySelector<HTMLElement>('.artist-link-group-panel');
            if (panel) {
                animateArtistLinkGroupPanel(panel, isExpanded);
            }
        });
    };

    const renderArtistUrlIcons = (urls?: ArtistExternalUrl[]): void => {
        closeArtistInfoContextMenu();
        artistInfoLinks.innerHTML = '';

        if (!urls || urls.length === 0) {
            artistInfoLinks.hidden = true;
            expandedArtistLinkGroup = null;
            return;
        }

        const groupedUrls = new Map<string, ArtistExternalUrl[]>();
        for (const url of urls) {
            const groupKey = categoryForArtistUrl(url);
            const existingGroup = groupedUrls.get(groupKey);
            if (existingGroup) {
                existingGroup.push(url);
            } else {
                groupedUrls.set(groupKey, [url]);
            }
        }

        artistInfoLinks.hidden = false;
        const orderedGroupKeys = [
            ...artistLinkCategoryOrder.filter((groupKey) => groupedUrls.has(groupKey)),
            ...Array.from(groupedUrls.keys())
                .filter((groupKey) => !artistLinkCategoryOrder.includes(groupKey as typeof artistLinkCategoryOrder[number]))
                .sort((left, right) => left.localeCompare(right)),
        ];

        for (const groupType of orderedGroupKeys) {
            const groupUrls = groupedUrls.get(groupType);
            if (!groupUrls || groupUrls.length === 0) {
                continue;
            }

            const group = document.createElement('section');
            group.className = 'artist-link-group';
            group.dataset.groupKey = groupType;

            const toggle = document.createElement('button');
            toggle.className = 'artist-link-group-toggle';
            toggle.type = 'button';
            toggle.setAttribute('aria-expanded', 'false');

            const toggleLabel = document.createElement('span');
            toggleLabel.className = 'artist-link-group-label';
            toggleLabel.textContent = groupType;

            const toggleCount = document.createElement('span');
            toggleCount.className = 'artist-link-group-count';
            toggleCount.textContent = String(groupUrls.length);

            const toggleChevron = document.createElement('span');
            toggleChevron.className = 'artist-link-group-chevron';
            toggleChevron.innerHTML = '<svg class="overlay-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M7.41 8.59C7.8 8.2 8.43 8.2 8.82 8.59L12 11.77L15.18 8.59C15.57 8.2 16.2 8.2 16.59 8.59C16.98 8.98 16.98 9.61 16.59 10L12.71 13.88C12.32 14.27 11.69 14.27 11.3 13.88L7.41 10C7.02 9.61 7.02 8.98 7.41 8.59Z"/></svg>';

            toggle.append(toggleLabel, toggleCount, toggleChevron);

            toggle.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openArtistInfoContextMenu(event.clientX, event.clientY, 'Copy all', copyableArtistResources(groupUrls));
            });

            const panel = document.createElement('div');
            panel.className = 'artist-link-group-panel';
            panel.setAttribute('aria-hidden', 'true');
            panel.style.height = '0px';
            panel.style.opacity = '0';

            const strip = document.createElement('div');
            strip.className = 'artist-link-strip';

            groupUrls.forEach((url) => {
                const linkButton = createArtistLinkButton(url, groupType);
                linkButton.addEventListener('contextmenu', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openArtistInfoContextMenu(event.clientX, event.clientY, 'Copy link', url.resource);
                });
                strip.append(linkButton);
            });
            panel.append(strip);

            toggle.addEventListener('click', (event) => {
                event.stopPropagation();
                applyExpandedArtistLinkGroup(expandedArtistLinkGroup === groupType ? null : groupType);
            });

            group.append(toggle, panel);
            artistInfoLinks.append(group);
        }

        applyExpandedArtistLinkGroup(null);
    };

    const reset = (): void => {
        closeArtistInfoContextMenu();
        artistInfoName.textContent = 'No artist info';
        artistInfoType.textContent = 'Type: —';
        artistInfoCountry.textContent = 'Country: —';
        artistInfoLifeSpan.textContent = 'Life span: —';
        artistInfoGenres.textContent = 'Genres: —';
        artistInfoSummary.textContent = 'Flip back after MBID lookup to see details.';
        renderArtistUrlIcons();
    };

    const renderArtistInfoPanel = (details: ArtistDetails): void => {
        artistInfoName.textContent = details.name || 'No artist info';
        artistInfoType.textContent = `Type: ${details.type || '—'}`;
        artistInfoCountry.textContent = `Country: ${details.country || '—'}`;
        artistInfoLifeSpan.textContent = `Life span: ${details.lifeSpan || '—'}`;
        artistInfoGenres.textContent = `Genres: ${details.genres?.length ? details.genres.join(', ') : '—'}`;
        artistInfoSummary.textContent = '';
        renderArtistUrlIcons(details.urls);
    };

    const hydrate = async (index: number): Promise<void> => {
        const tracks = options.getTracks();
        if (index < 0 || index >= tracks.length) {
            return;
        }

        const mbid = tracks[index].artistMbids[0];
        if (!mbid) {
            reset();
            return;
        }

        const cached = artistInfoByMBID.get(mbid);
        if (cached) {
            renderArtistInfoPanel(cached);
            return;
        }

        artistInfoSummary.textContent = 'Loading artist details from MusicBrainz…';
        const requestVersion = options.getRequestVersion();

        try {
            const details = await options.lookupArtistByMBID(mbid);
            if (requestVersion !== options.getRequestVersion() || index !== options.getCurrentTrackIndex()) {
                return;
            }

            if (!details.found) {
                artistInfoSummary.textContent = 'No artist details found for this MBID.';
                return;
            }

            artistInfoByMBID.set(mbid, details);
            renderArtistInfoPanel(details);
        } catch (error) {
            console.error(error);
            if (requestVersion === options.getRequestVersion() && index === options.getCurrentTrackIndex()) {
                artistInfoSummary.textContent = 'Unable to load artist details right now.';
            }
        }
    };

    artistInfoContextMenu.addEventListener('click', (event) => {
        const actionButton = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.artist-info-links-context-menu-item');
        if (!actionButton || actionButton.disabled || artistInfoContextMenuCopyText === '') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const copyText = artistInfoContextMenuCopyText;
        closeArtistInfoContextMenu();
        void copyTextToClipboard(copyText).catch((error) => {
            console.error(error);
        });
    });

    ownerDocument.addEventListener('mousedown', (event) => {
        if (artistInfoContextMenu.hidden) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Node) || artistInfoContextMenu.contains(target)) {
            return;
        }

        closeArtistInfoContextMenu();
    }, { capture: true });

    ownerDocument.addEventListener('contextmenu', (event) => {
        if (artistInfoContextMenu.hidden) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element) || artistInfoContextMenu.contains(target)) {
            return;
        }

        const trigger = target.closest('.artist-link-group-toggle, .artist-link-btn');
        if (trigger && artistInfoLinks.contains(trigger)) {
            return;
        }

        closeArtistInfoContextMenu();
    }, { capture: true });

    ownerDocument.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !artistInfoContextMenu.hidden) {
            closeArtistInfoContextMenu();
        }
    });

    ownerDocument.addEventListener('scroll', () => {
        if (!artistInfoContextMenu.hidden) {
            closeArtistInfoContextMenu();
        }
    }, { capture: true });

    ownerWindow.addEventListener('blur', () => {
        if (!artistInfoContextMenu.hidden) {
            closeArtistInfoContextMenu();
        }
    });

    return {
        clearCache: (): void => {
            artistInfoByMBID.clear();
        },
        hydrate,
        reset,
    };
};
