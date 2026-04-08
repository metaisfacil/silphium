import type { LibraryBrowserEntry } from '../types/app-types';
import type { SearchTreeNode } from './library-controller-types';
import { compareLibraryLabels } from './library-controller-dom-helpers';

export const createSearchTreeNode = (name: string, path: string): SearchTreeNode => ({
    name,
    path,
    musicBrainzTaggedAlbumDir: false,
    folders: [],
    trackEntries: [],
    textFileEntries: [],
    imageFileEntries: [],
});

export const buildSearchTree = (entries: LibraryBrowserEntry[], rootName: string): SearchTreeNode => {
    const root = createSearchTreeNode(rootName, '');
    const nodeByPath = new Map<string, SearchTreeNode>();
    nodeByPath.set('', root);

    const ensureNode = (path: string): SearchTreeNode => {
        const normalizedPath = path.trim();
        if (!normalizedPath) {
            return root;
        }

        const existing = nodeByPath.get(normalizedPath);
        if (existing) {
            return existing;
        }

        const segments = normalizedPath.split('/').filter((segment) => segment !== '');
        let cumulativePath = '';
        let parent = root;

        for (const segment of segments) {
            cumulativePath = cumulativePath ? `${cumulativePath}/${segment}` : segment;
            const cached = nodeByPath.get(cumulativePath);
            if (cached) {
                parent = cached;
                continue;
            }

            const created = createSearchTreeNode(segment, cumulativePath);
            nodeByPath.set(cumulativePath, created);
            parent.folders.push(created);
            parent = created;
        }

        return parent;
    };

    for (const entry of entries) {
        if (entry.kind === 'folder') {
            const folderNode = ensureNode(entry.path);
            folderNode.musicBrainzTaggedAlbumDir = folderNode.musicBrainzTaggedAlbumDir || !!entry.musicBrainzTaggedAlbumDir;
            continue;
        }

        const folderNode = ensureNode(entry.folderPath);
        if (entry.kind === 'track') {
            folderNode.trackEntries.push(entry);
            continue;
        }

        if (entry.kind === 'text-file') {
            folderNode.textFileEntries.push(entry);
            continue;
        }

        folderNode.imageFileEntries.push(entry);
    }

    return root;
};

export const findSearchTreeNode = (root: SearchTreeNode, path: string): SearchTreeNode | null => {
    if (path.trim() === '') {
        return root;
    }

    const segments = path.split('/').filter((segment) => segment !== '');
    let current: SearchTreeNode | null = root;

    for (const segment of segments) {
        current = current.folders.find((folder) => folder.name === segment) || null;
        if (!current) {
            return null;
        }
    }

    return current;
};

export const collectSearchTreeTrackIndexes = (
    node: SearchTreeNode,
    resolveTrackIndex: (path: string) => number,
): number[] => {
    const collectedTrackIndexes: number[] = [];
    const seenTrackIndexes = new Set<number>();

    const visitNode = (currentNode: SearchTreeNode): void => {
        const sortedFolders = [...currentNode.folders].sort((left, right) => compareLibraryLabels(left.name, right.name));
        sortedFolders.forEach((folder) => {
            visitNode(folder);
        });

        const sortedTrackEntries = [...currentNode.trackEntries].sort((left, right) => compareLibraryLabels(left.name, right.name));
        sortedTrackEntries.forEach((entry) => {
            const trackIndex = resolveTrackIndex(entry.path);
            if (trackIndex < 0 || seenTrackIndexes.has(trackIndex)) {
                return;
            }

            seenTrackIndexes.add(trackIndex);
            collectedTrackIndexes.push(trackIndex);
        });
    };

    visitNode(node);
    return collectedTrackIndexes;
};
