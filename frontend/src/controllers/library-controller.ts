import type {
    ImageLibraryFile,
    LibraryNode,
    LibrarySearchTreeNode,
    TextLibraryFile,
    Track,
} from '../types/app-types';

type RenderDirection = 'none' | 'forward' | 'back';

type LibraryControllerOptions = {
    app: HTMLElement;
    sidebarToggle: HTMLButtonElement;
    librarySidebar: HTMLElement;
    libraryBack: HTMLButtonElement;
    libraryPath: HTMLParagraphElement;
    librarySearch: HTMLInputElement;
    libraryBrowser: HTMLElement;
    getTracks: () => Track[];
    getTextFiles: () => TextLibraryFile[];
    getImageFiles: () => ImageLibraryFile[];
    getCurrentTrackIndex: () => number;
    onTrackChosen: (index: number) => void;
    onTextFileChosen: (index: number) => void;
    onImageFileChosen: (index: number) => void;
    onQueueRequested: (clientX: number, clientY: number, trackIndexes: number[]) => void;
    onSidebarClosed: () => void;
};

export type LibraryController = ReturnType<typeof createLibraryController>;

export const createLibraryController = (options: LibraryControllerOptions) => {
    const {
        app,
        sidebarToggle,
        librarySidebar,
        libraryBack,
        libraryPath,
        librarySearch,
        libraryBrowser,
    } = options;

    let sidebarOpen = false;
    let libraryRootName = '';
    let currentFolderPath = '';
    let sidebarAutoFolderPath = '';
    let libraryIndexTruncated = false;
    let libraryLoading = false;
    let librarySearchQuery = '';
    let librarySearchPending = false;
    let librarySearchResultQuery = '';
    let librarySearchResult: LibrarySearchTreeNode | null = null;
    let librarySearchRequestVersion = 0;
    let librarySearchDebounceHandle: number | undefined;
    const libraryNodeByPath = new Map<string, LibraryNode>();
    const expandedSearchFolders = new Set<string>();

    const librarySearchDebounceMs = 140;
    const librarySearchBatchSize = 300;

    const getTracks = (): Track[] => options.getTracks();
    const getTextFiles = (): TextLibraryFile[] => options.getTextFiles();
    const getImageFiles = (): ImageLibraryFile[] => options.getImageFiles();

    const refreshSidebarToggleState = (): void => {
        sidebarToggle.classList.toggle('is-loading', libraryLoading);
        sidebarToggle.textContent = libraryLoading ? '' : '‣‣‣';

        if (libraryLoading) {
            sidebarToggle.setAttribute('aria-label', 'Loading library');
            sidebarToggle.setAttribute('aria-busy', 'true');
            return;
        }

        sidebarToggle.setAttribute('aria-busy', 'false');
        sidebarToggle.setAttribute('aria-label', sidebarOpen ? 'Close library' : 'Open library');
    };

    const setLibraryLoading = (loading: boolean): void => {
        if (libraryLoading === loading) {
            return;
        }

        libraryLoading = loading;
        refreshSidebarToggleState();
    };

    const normalizedLibrarySearchQuery = (): string => librarySearchQuery.trim().toLowerCase();

    const isLibrarySearchActive = (): boolean => normalizedLibrarySearchQuery() !== '';

    const clearScheduledLibrarySearch = (): void => {
        if (librarySearchDebounceHandle === undefined) {
            return;
        }

        window.clearTimeout(librarySearchDebounceHandle);
        librarySearchDebounceHandle = undefined;
    };

    const cancelLibrarySearch = (): void => {
        librarySearchRequestVersion += 1;
        librarySearchPending = false;
        librarySearchResultQuery = '';
        librarySearchResult = null;
        clearScheduledLibrarySearch();
    };

    const createSearchTreeNode = (name: string, path: string): LibrarySearchTreeNode => ({
        name,
        path,
        folders: [],
        trackIndexes: [],
        textFileIndexes: [],
        imageFileIndexes: [],
    });

    const matchesLibrarySearch = (candidate: string, query: string): boolean => candidate.toLowerCase().includes(query);

    const yieldToUi = async (): Promise<void> => {
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    };

    const runLibrarySearch = async (query: string, requestVersion: number): Promise<void> => {
        const root = createSearchTreeNode(libraryRootName, '');
        const nodeByPath = new Map<string, LibrarySearchTreeNode>();
        nodeByPath.set('', root);

        const searchCanceled = (): boolean => {
            return requestVersion !== librarySearchRequestVersion || query !== normalizedLibrarySearchQuery();
        };

        const ensureNode = (path: string): LibrarySearchTreeNode => {
            const normalizedPath = path || '';
            const existing = nodeByPath.get(normalizedPath);
            if (existing) {
                return existing;
            }

            const segments = normalizedPath.split('/').filter((segment) => segment !== '');
            const name = segments[segments.length - 1] || libraryRootName;
            const parentPath = segments.slice(0, -1).join('/');
            const parent = ensureNode(parentPath);
            const created = createSearchTreeNode(name, normalizedPath);
            parent.folders.push(created);
            nodeByPath.set(normalizedPath, created);
            return created;
        };

        const tracks = getTracks();
        for (let index = 0; index < tracks.length; index += 1) {
            if (searchCanceled()) {
                return;
            }

            const track = tracks[index];
            if (!matchesLibrarySearch(track.relativePath, query) && !matchesLibrarySearch(track.name, query) && !matchesLibrarySearch(track.displayTitle, query)) {
                if ((index + 1) % librarySearchBatchSize === 0) {
                    await yieldToUi();
                }
                continue;
            }

            ensureNode(track.folderPath).trackIndexes.push(index);
            if ((index + 1) % librarySearchBatchSize === 0) {
                await yieldToUi();
            }
        }

        const textFiles = getTextFiles();
        for (let index = 0; index < textFiles.length; index += 1) {
            if (searchCanceled()) {
                return;
            }

            const textFile = textFiles[index];
            if (!matchesLibrarySearch(textFile.relativePath, query) && !matchesLibrarySearch(textFile.name, query)) {
                if ((index + 1) % librarySearchBatchSize === 0) {
                    await yieldToUi();
                }
                continue;
            }

            ensureNode(textFile.folderPath).textFileIndexes.push(index);
            if ((index + 1) % librarySearchBatchSize === 0) {
                await yieldToUi();
            }
        }

        const imageFiles = getImageFiles();
        for (let index = 0; index < imageFiles.length; index += 1) {
            if (searchCanceled()) {
                return;
            }

            const imageFile = imageFiles[index];
            if (!matchesLibrarySearch(imageFile.relativePath, query) && !matchesLibrarySearch(imageFile.name, query)) {
                if ((index + 1) % librarySearchBatchSize === 0) {
                    await yieldToUi();
                }
                continue;
            }

            ensureNode(imageFile.folderPath).imageFileIndexes.push(index);
            if ((index + 1) % librarySearchBatchSize === 0) {
                await yieldToUi();
            }
        }

        let folderCounter = 0;
        for (const folderNode of libraryNodeByPath.values()) {
            if (searchCanceled()) {
                return;
            }

            if (!folderNode.path) {
                continue;
            }

            if (matchesLibrarySearch(folderNode.name, query) || matchesLibrarySearch(folderNode.path, query)) {
                ensureNode(folderNode.path);
            }

            folderCounter += 1;
            if (folderCounter % librarySearchBatchSize === 0) {
                await yieldToUi();
            }
        }

        const pruneNode = (node: LibrarySearchTreeNode): boolean => {
            node.folders = node.folders.filter((child) => pruneNode(child));
            return node.folders.length > 0 || node.trackIndexes.length > 0 || node.textFileIndexes.length > 0 || node.imageFileIndexes.length > 0;
        };

        const nextResult = pruneNode(root) ? root : null;
        if (searchCanceled()) {
            return;
        }

        librarySearchPending = false;
        librarySearchResultQuery = query;
        librarySearchResult = nextResult;
        renderFolder('none');
    };

    const clearLibrarySearch = (): void => {
        librarySearchQuery = '';
        expandedSearchFolders.clear();
        librarySearch.value = '';
        cancelLibrarySearch();
    };

    const setLibrarySearchQuery = (nextValue: string): void => {
        if (librarySearchQuery === nextValue) {
            return;
        }

        librarySearchQuery = nextValue;
        expandedSearchFolders.clear();

        const normalizedQuery = normalizedLibrarySearchQuery();
        if (!normalizedQuery) {
            cancelLibrarySearch();
            renderFolder('none');
            return;
        }

        clearScheduledLibrarySearch();
        librarySearchPending = true;
        librarySearchResultQuery = '';
        librarySearchResult = null;
        const requestVersion = ++librarySearchRequestVersion;
        librarySearchDebounceHandle = window.setTimeout(() => {
            librarySearchDebounceHandle = undefined;
            void runLibrarySearch(normalizedQuery, requestVersion);
        }, librarySearchDebounceMs);

        renderFolder('none');
    };

    const setLibraryPathLabel = (): void => {
        const partialSuffix = libraryIndexTruncated ? ' (partial)' : '';
        const folderSegments = currentFolderPath
            .split('/')
            .filter((segment) => segment !== '');

        const appendText = (value: string): void => {
            libraryPath.append(document.createTextNode(value));
        };

        const appendFolderButton = (label: string, folderPath: string): void => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'library-path-segment';
            button.dataset.folderPath = folderPath;
            button.textContent = label;
            libraryPath.append(button);
        };

        const appendSeparator = (): void => {
            const separator = document.createElement('span');
            separator.className = 'library-path-separator';
            separator.textContent = ' / ';
            libraryPath.append(separator);
        };

        if (!libraryRootName) {
            libraryPath.innerHTML = '';
            libraryPath.textContent = 'No folder selected';
            libraryBack.disabled = true;
            return;
        }

        libraryPath.innerHTML = '';

        if (isLibrarySearchActive()) {
            const searchSuffix = librarySearchPending ? ' (searching...)' : '';
            appendText(`${libraryRootName}${partialSuffix} · Search: "${librarySearchQuery.trim()}"${searchSuffix}`);
            libraryBack.disabled = true;
            return;
        }

        if (!currentFolderPath) {
            appendText(`${libraryRootName}${partialSuffix}`);
            libraryBack.disabled = true;
            return;
        }

        appendFolderButton(`${libraryRootName}${partialSuffix}`, '');

        let cumulativePath = '';
        for (const segment of folderSegments) {
            appendSeparator();
            cumulativePath = cumulativePath ? `${cumulativePath}/${segment}` : segment;
            appendFolderButton(segment, cumulativePath);
        }

        libraryBack.disabled = false;
    };

    const createFolderPane = (node: LibraryNode): HTMLUListElement => {
        const pane = document.createElement('ul');
        pane.className = 'library-list-pane';

        const tracks = getTracks();
        const currentTrackIndex = options.getCurrentTrackIndex();
        const textFiles = getTextFiles();
        const imageFiles = getImageFiles();

        const folderRows = node.folders
            .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
            .map((folder) => `<li><button class="library-entry folder" data-folder-path="${folder.path}">📁 ${folder.name}</button></li>`)
            .join('');

        const trackRows = node.trackIndexes
            .map((trackIndex) => ({ trackIndex, track: tracks[trackIndex] }))
            .sort((left, right) => left.track.title.localeCompare(right.track.title, undefined, { sensitivity: 'base' }))
            .map(({ trackIndex, track }) => `<li><button class="library-entry track${trackIndex === currentTrackIndex ? ' active' : ''}" data-track-index="${trackIndex}">🎵 ${track.title}</button></li>`)
            .join('');

        const textRows = node.textFileIndexes
            .map((textFileIndex) => ({ textFileIndex, file: textFiles[textFileIndex] }))
            .sort((left, right) => left.file.name.localeCompare(right.file.name, undefined, { sensitivity: 'base' }))
            .map(({ textFileIndex, file }) => `<li><button class="library-entry text-file" data-text-file-index="${textFileIndex}">📄 ${file.name}</button></li>`)
            .join('');

        const imageRows = node.imageFileIndexes
            .map((imageFileIndex) => ({ imageFileIndex, file: imageFiles[imageFileIndex] }))
            .sort((left, right) => left.file.name.localeCompare(right.file.name, undefined, { sensitivity: 'base' }))
            .map(({ imageFileIndex, file }) => `<li><button class="library-entry image-file" data-image-file-index="${imageFileIndex}">🖼️ ${file.name}</button></li>`)
            .join('');

        const content = `${folderRows}${trackRows}${textRows}${imageRows}`;
        if (!content) {
            pane.innerHTML = '<li class="empty">Folder is empty</li>';
            return pane;
        }

        pane.innerHTML = content;
        return pane;
    };

    const appendSearchTreeRows = (list: HTMLUListElement, node: LibrarySearchTreeNode): void => {
        const tracks = getTracks();
        const textFiles = getTextFiles();
        const imageFiles = getImageFiles();

        const sortedFolders = [...node.folders].sort((left, right) => left.name.localeCompare(right.name, undefined, {
            sensitivity: 'base',
            numeric: true,
        }));

        for (const folder of sortedFolders) {
            const folderItem = document.createElement('li');
            folderItem.className = 'library-tree-node';

            const hasChildren = folder.folders.length > 0 || folder.trackIndexes.length > 0 || folder.textFileIndexes.length > 0 || folder.imageFileIndexes.length > 0;
            const isExpanded = hasChildren && expandedSearchFolders.has(folder.path);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'library-tree-folder';
            button.textContent = `${hasChildren ? (isExpanded ? '▾' : '▸') : '•'} 📁 ${folder.name}`;
            if (hasChildren) {
                button.dataset.searchFolderPath = folder.path;
            } else {
                button.classList.add('is-leaf');
            }

            folderItem.append(button);

            if (hasChildren && isExpanded) {
                const childList = document.createElement('ul');
                childList.className = 'library-tree-list';
                appendSearchTreeRows(childList, folder);
                if (childList.childElementCount > 0) {
                    folderItem.append(childList);
                }
            }

            list.append(folderItem);
        }

        const currentTrackIndex = options.getCurrentTrackIndex();
        const sortedTrackIndexes = [...node.trackIndexes].sort((left, right) => tracks[left].name.localeCompare(tracks[right].name, undefined, {
            sensitivity: 'base',
            numeric: true,
        }));
        for (const trackIndex of sortedTrackIndexes) {
            const track = tracks[trackIndex];
            if (!track) {
                continue;
            }

            const row = document.createElement('li');
            row.className = 'library-tree-entry';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `library-entry track${trackIndex === currentTrackIndex ? ' active' : ''}`;
            button.dataset.trackIndex = String(trackIndex);
            button.textContent = `🎵 ${track.displayTitle || track.title}`;
            row.append(button);
            list.append(row);
        }

        const sortedTextFileIndexes = [...node.textFileIndexes].sort((left, right) => textFiles[left].name.localeCompare(textFiles[right].name, undefined, {
            sensitivity: 'base',
            numeric: true,
        }));
        for (const textFileIndex of sortedTextFileIndexes) {
            const textFile = textFiles[textFileIndex];
            if (!textFile) {
                continue;
            }

            const row = document.createElement('li');
            row.className = 'library-tree-entry';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'library-entry text-file';
            button.dataset.textFileIndex = String(textFileIndex);
            button.textContent = `📄 ${textFile.name}`;
            row.append(button);
            list.append(row);
        }

        const sortedImageFileIndexes = [...node.imageFileIndexes].sort((left, right) => imageFiles[left].name.localeCompare(imageFiles[right].name, undefined, {
            sensitivity: 'base',
            numeric: true,
        }));
        for (const imageFileIndex of sortedImageFileIndexes) {
            const imageFile = imageFiles[imageFileIndex];
            if (!imageFile) {
                continue;
            }

            const row = document.createElement('li');
            row.className = 'library-tree-entry';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'library-entry image-file';
            button.dataset.imageFileIndex = String(imageFileIndex);
            button.textContent = `🖼️ ${imageFile.name}`;
            row.append(button);
            list.append(row);
        }
    };

    const trackRelativePathWithinFolder = (track: Track, folderPath: string): string => {
        if (!folderPath) {
            return track.relativePath;
        }

        const normalizedFolderPrefix = `${folderPath.toLowerCase()}/`;
        const normalizedRelativePath = track.relativePath.toLowerCase();
        if (!normalizedRelativePath.startsWith(normalizedFolderPrefix)) {
            return track.relativePath;
        }

        return track.relativePath.slice(folderPath.length + 1);
    };

    const collectFolderTrackIndexes = (folderPath: string): number[] => {
        const folderNode = libraryNodeByPath.get(folderPath);
        if (!folderNode) {
            return [];
        }

        const tracks = getTracks();
        const collected: number[] = [];
        const stack: LibraryNode[] = [folderNode];
        while (stack.length > 0) {
            const node = stack.pop() as LibraryNode;
            collected.push(...node.trackIndexes);
            for (const child of node.folders) {
                stack.push(child);
            }
        }

        const uniqueIndexes = Array.from(new Set(collected)).filter((trackIndex) => (
            Number.isInteger(trackIndex)
            && trackIndex >= 0
            && trackIndex < tracks.length
        ));

        uniqueIndexes.sort((leftIndex, rightIndex) => {
            const leftTrack = tracks[leftIndex];
            const rightTrack = tracks[rightIndex];
            return trackRelativePathWithinFolder(leftTrack, folderPath).localeCompare(
                trackRelativePathWithinFolder(rightTrack, folderPath),
                undefined,
                {
                    sensitivity: 'base',
                    numeric: true,
                },
            );
        });

        return uniqueIndexes;
    };

    const firstTrackIndexFromRandomAlbumFolder = (): number => {
        const tracks = getTracks();
        const folderCandidates = Array.from(libraryNodeByPath.values())
            .filter((node) => node.trackIndexes.length > 0);

        if (folderCandidates.length === 0) {
            return 0;
        }

        const randomFolder = folderCandidates[Math.floor(Math.random() * folderCandidates.length)];
        const orderedTrackIndexes = [...randomFolder.trackIndexes].sort((leftIndex, rightIndex) => (
            tracks[leftIndex].name.localeCompare(tracks[rightIndex].name, undefined, {
                sensitivity: 'base',
                numeric: true,
            })
        ));

        return orderedTrackIndexes[0] ?? 0;
    };

    const sidebarQueueTrackIndexesForTarget = (target: HTMLButtonElement): number[] => {
        const tracks = getTracks();

        const trackIndexValue = target.dataset.trackIndex;
        if (trackIndexValue !== undefined) {
            const trackIndex = Number(trackIndexValue);
            if (Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < tracks.length) {
                return [trackIndex];
            }
            return [];
        }

        const folderPath = target.dataset.folderPath ?? target.dataset.searchFolderPath;
        if (folderPath === undefined) {
            return [];
        }

        return collectFolderTrackIndexes(folderPath);
    };

    const createLibrarySearchPane = (): HTMLUListElement => {
        const pane = document.createElement('ul');
        pane.className = 'library-list-pane library-search-pane';

        const query = normalizedLibrarySearchQuery();
        if (librarySearchPending || librarySearchResultQuery !== query) {
            pane.innerHTML = '<li class="empty">Searching...</li>';
            return pane;
        }

        if (!librarySearchResult) {
            pane.innerHTML = '<li class="empty">No files match your search</li>';
            return pane;
        }

        const rootList = document.createElement('ul');
        rootList.className = 'library-tree-list library-tree-root';
        appendSearchTreeRows(rootList, librarySearchResult);

        if (rootList.childElementCount === 0) {
            pane.innerHTML = '<li class="empty">No files match your search</li>';
            return pane;
        }

        pane.append(rootList);
        return pane;
    };

    const renderFolder = (direction: RenderDirection): void => {
        setLibraryPathLabel();

        if (isLibrarySearchActive()) {
            const nextPane = createLibrarySearchPane();
            libraryBrowser.innerHTML = '';
            nextPane.classList.add('current');
            libraryBrowser.append(nextPane);
            return;
        }

        const node = libraryNodeByPath.get(currentFolderPath);
        if (!node) {
            libraryBrowser.innerHTML = '';
            return;
        }

        const nextPane = createFolderPane(node);
        const existingPanes = Array.from(libraryBrowser.querySelectorAll('.library-list-pane')) as HTMLUListElement[];
        if (existingPanes.length > 1) {
            // Keep only the newest pane as the visual baseline when rapid clicks overlap transitions.
            existingPanes.slice(0, -1).forEach((pane) => pane.remove());
        }

        const currentPane = (libraryBrowser.querySelector('.library-list-pane:last-of-type') as HTMLUListElement | null);
        if (currentPane) {
            currentPane.classList.remove('from-right', 'from-left', 'to-left', 'to-right');
            currentPane.classList.add('current');
        }

        if (!currentPane || direction === 'none') {
            libraryBrowser.innerHTML = '';
            nextPane.classList.add('current');
            libraryBrowser.append(nextPane);
            return;
        }

        currentPane.classList.remove('current');
        nextPane.classList.add('current');
        if (direction === 'forward') {
            nextPane.classList.add('from-right');
            currentPane.classList.add('to-left');
        } else {
            nextPane.classList.add('from-left');
            currentPane.classList.add('to-right');
        }

        libraryBrowser.append(nextPane);

        requestAnimationFrame(() => {
            nextPane.classList.remove('from-right', 'from-left');
        });

        const cleanup = (): void => {
            currentPane.remove();
        };

        nextPane.addEventListener('transitionend', cleanup, { once: true });
        window.setTimeout(cleanup, 260);
    };

    const navigateToFolder = (nextFolderPath: string): void => {
        const hadSearch = isLibrarySearchActive();
        if (hadSearch) {
            clearLibrarySearch();
        }

        if (nextFolderPath === currentFolderPath) {
            if (hadSearch) {
                renderFolder('none');
            }
            return;
        }

        const segmentCount = (path: string): number => path.split('/').filter((segment) => segment !== '').length;
        const nextDepth = segmentCount(nextFolderPath);
        const currentDepth = segmentCount(currentFolderPath);

        currentFolderPath = nextFolderPath;
        if (nextDepth < currentDepth) {
            renderFolder('back');
            return;
        }

        if (nextDepth > currentDepth) {
            renderFolder('forward');
            return;
        }

        renderFolder('none');
    };

    const setSidebarOpen = (open: boolean): void => {
        const wasOpen = sidebarOpen;

        if (!open && wasOpen) {
            options.onSidebarClosed();
            sidebarAutoFolderPath = currentFolderPath;
        }

        sidebarOpen = open;

        if (sidebarOpen && !wasOpen) {
            currentFolderPath = sidebarAutoFolderPath;
            renderFolder('none');
        }

        app.classList.toggle('sidebar-open', sidebarOpen);
        librarySidebar.setAttribute('aria-hidden', sidebarOpen ? 'false' : 'true');
        refreshSidebarToggleState();
    };

    const rebuildLibraryTree = (
        rootName: string,
        truncated: boolean,
        tracks: Track[],
        textFiles: TextLibraryFile[],
        imageFiles: ImageLibraryFile[],
    ): void => {
        libraryRootName = rootName || 'Selected folder';
        libraryIndexTruncated = truncated;

        clearLibrarySearch();
        libraryNodeByPath.clear();

        const rootNode: LibraryNode = {
            name: libraryRootName,
            path: '',
            folders: [],
            trackIndexes: [],
            textFileIndexes: [],
            imageFileIndexes: [],
        };
        libraryNodeByPath.set('', rootNode);

        const getOrCreateFolder = (path: string, name: string, parent: LibraryNode): LibraryNode => {
            const existing = libraryNodeByPath.get(path);
            if (existing) {
                return existing;
            }

            const created: LibraryNode = {
                name,
                path,
                folders: [],
                trackIndexes: [],
                textFileIndexes: [],
                imageFileIndexes: [],
            };
            libraryNodeByPath.set(path, created);
            parent.folders.push(created);
            return created;
        };

        const appendToFolder = (folderPath: string, appendIndex: (node: LibraryNode) => void): void => {
            const segments = folderPath
                .split('/')
                .filter((segment) => segment !== '');
            let parent = rootNode;
            let cumulativePath = '';

            for (const segment of segments) {
                cumulativePath = cumulativePath ? `${cumulativePath}/${segment}` : segment;
                parent = getOrCreateFolder(cumulativePath, segment, parent);
            }

            appendIndex(parent);
        };

        tracks.forEach((track, index) => {
            appendToFolder(track.folderPath, (node) => {
                node.trackIndexes.push(index);
            });
        });

        textFiles.forEach((textFile, index) => {
            appendToFolder(textFile.folderPath, (node) => {
                node.textFileIndexes.push(index);
            });
        });

        imageFiles.forEach((imageFile, index) => {
            appendToFolder(imageFile.folderPath, (node) => {
                node.imageFileIndexes.push(index);
            });
        });
    };

    const resetLibraryState = (): void => {
        libraryRootName = '';
        currentFolderPath = '';
        sidebarAutoFolderPath = '';
        libraryIndexTruncated = false;
        clearLibrarySearch();
        libraryNodeByPath.clear();
        libraryBrowser.innerHTML = '';
    };

    sidebarToggle.addEventListener('click', () => {
        setSidebarOpen(!sidebarOpen);
    });

    librarySearch.addEventListener('input', () => {
        setLibrarySearchQuery(librarySearch.value);
    });

    librarySearch.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || librarySearch.value === '') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        clearLibrarySearch();
        renderFolder('none');
    });

    libraryBrowser.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        const searchFolderPath = target.dataset.searchFolderPath;
        if (searchFolderPath !== undefined) {
            if (expandedSearchFolders.has(searchFolderPath)) {
                expandedSearchFolders.delete(searchFolderPath);
            } else {
                expandedSearchFolders.add(searchFolderPath);
            }

            renderFolder('none');
            return;
        }

        const nextFolder = target.dataset.folderPath;
        if (nextFolder !== undefined) {
            currentFolderPath = nextFolder;
            renderFolder('forward');
            return;
        }

        const rawIndex = target.dataset.trackIndex;
        if (rawIndex !== undefined) {
            const index = Number(rawIndex);
            if (Number.isInteger(index)) {
                options.onTrackChosen(index);
            }
            return;
        }

        const rawTextFileIndex = target.dataset.textFileIndex;
        if (rawTextFileIndex !== undefined) {
            const textFileIndex = Number(rawTextFileIndex);
            if (Number.isInteger(textFileIndex)) {
                options.onTextFileChosen(textFileIndex);
            }
            return;
        }

        const rawImageFileIndex = target.dataset.imageFileIndex;
        if (rawImageFileIndex === undefined) {
            return;
        }

        const imageFileIndex = Number(rawImageFileIndex);
        if (Number.isInteger(imageFileIndex)) {
            options.onImageFileChosen(imageFileIndex);
        }
    });

    libraryBrowser.addEventListener('contextmenu', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest('button');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const trackIndexes = sidebarQueueTrackIndexesForTarget(button);
        if (trackIndexes.length === 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        options.onQueueRequested(event.clientX, event.clientY, trackIndexes);
    });

    libraryBack.addEventListener('click', () => {
        if (isLibrarySearchActive()) {
            clearLibrarySearch();
            renderFolder('none');
            return;
        }

        if (!currentFolderPath) {
            return;
        }

        const segments = currentFolderPath.split('/');
        segments.pop();
        currentFolderPath = segments.join('/');
        renderFolder('back');
    });

    libraryPath.addEventListener('click', (event) => {
        if (isLibrarySearchActive()) {
            return;
        }

        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        const nextPath = target.dataset.folderPath;
        if (nextPath === undefined || nextPath === currentFolderPath) {
            return;
        }

        const segmentCount = (path: string): number => path.split('/').filter((segment) => segment !== '').length;
        const nextDepth = segmentCount(nextPath);
        const currentDepth = segmentCount(currentFolderPath);

        currentFolderPath = nextPath;
        if (nextDepth < currentDepth) {
            renderFolder('back');
            return;
        }

        if (nextDepth > currentDepth) {
            renderFolder('forward');
            return;
        }

        renderFolder('none');
    });

    return {
        clearLibrarySearch,
        firstTrackIndexFromRandomAlbumFolder,
        getLibraryRootName: () => libraryRootName,
        getSidebarAutoFolderPath: () => sidebarAutoFolderPath,
        getCurrentFolderPath: () => currentFolderPath,
        isLibrarySearchActive,
        isSidebarOpen: () => sidebarOpen,
        navigateToFolder,
        refreshSidebarToggleState,
        rebuildLibraryTree,
        renderFolder,
        resetLibraryState,
        setCurrentFolderPath: (path: string) => {
            currentFolderPath = path;
        },
        setLibraryLoading,
        setLibraryPathMessage: (message: string) => {
            libraryPath.innerHTML = '';
            libraryPath.textContent = message;
        },
        setLibraryRootName: (rootName: string) => {
            libraryRootName = rootName;
        },
        setLibraryIndexTruncated: (truncated: boolean) => {
            libraryIndexTruncated = truncated;
        },
        setSidebarAutoFolderPath: (folderPath: string) => {
            sidebarAutoFolderPath = folderPath;
        },
        setSidebarOpen,
    };
};
