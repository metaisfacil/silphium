import type { ImageLibraryFile, TextLibraryFile, Track } from '../types/app-types';
import { libraryFolderPathKey } from '../utils/main-helpers';
import type { PastedPathLookupCache } from './library-controller-types';

export const normalizePastedLibraryPath = (value: string): string => {
    const trimmed = value.trim().replace(/^["']+|["']+$/g, '').trim();
    if (!trimmed) {
        return '';
    }

    return trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
};

export const isLikelyAbsoluteLibraryPath = (value: string): boolean => {
    return /^[a-z]:\//i.test(value) || value.startsWith('//');
};

export const createEmptyPastedPathLookupCache = (): PastedPathLookupCache => ({
    indexedFolderPathByKey: new Map<string, string>(),
    indexedFileFolderPathByKey: new Map<string, string>(),
    monitoredRoots: [],
});

export const rebuildPastedPathLookupCache = (
    tracks: Track[],
    textFiles: TextLibraryFile[],
    imageFiles: ImageLibraryFile[],
): PastedPathLookupCache => {
    const indexedFolderPathByKey = new Map<string, string>();
    const indexedFileFolderPathByKey = new Map<string, string>();
    const monitoredRootByKey = new Map<string, { path: string; name: string }>();

    const rememberFolderPath = (folderPath: string): void => {
        const normalizedPath = normalizePastedLibraryPath(folderPath);
        const key = libraryFolderPathKey(normalizedPath);
        if (!key || indexedFolderPathByKey.has(key)) {
            return;
        }

        indexedFolderPathByKey.set(key, normalizedPath);
    };

    const rememberFolderHierarchy = (folderPath: string): void => {
        const normalizedFolderPath = normalizePastedLibraryPath(folderPath);
        if (!normalizedFolderPath) {
            return;
        }

        const segments = normalizedFolderPath.split('/').filter((segment) => segment !== '');
        let cumulativePath = '';
        for (const segment of segments) {
            cumulativePath = cumulativePath ? `${cumulativePath}/${segment}` : segment;
            rememberFolderPath(cumulativePath);
        }
    };

    const rememberIndexedFilePath = (filePath: string, folderPath: string): void => {
        const normalizedFilePath = normalizePastedLibraryPath(filePath);
        const normalizedFolderPath = normalizePastedLibraryPath(folderPath);
        const fileKey = libraryFolderPathKey(normalizedFilePath);
        if (fileKey && !indexedFileFolderPathByKey.has(fileKey)) {
            indexedFileFolderPathByKey.set(fileKey, normalizedFolderPath);
        }
    };

    const rememberIndexedFile = (path: string, relativePath: string, folderPath: string, rootPath: string): void => {
        const normalizedFolderPath = normalizePastedLibraryPath(folderPath);
        const normalizedRootPath = normalizePastedLibraryPath(rootPath);

        rememberIndexedFilePath(path, normalizedFolderPath);
        rememberIndexedFilePath(relativePath, normalizedFolderPath);

        const rootKey = libraryFolderPathKey(normalizedRootPath);
        if (rootKey && !monitoredRootByKey.has(rootKey)) {
            const rootSegments = normalizedFolderPath.split('/').filter((segment) => segment !== '');
            monitoredRootByKey.set(rootKey, {
                path: normalizedRootPath,
                name: rootSegments[0] || '',
            });
        }

        rememberFolderHierarchy(normalizedFolderPath);
    };

    for (const track of tracks) {
        rememberIndexedFile(track.path, track.relativePath, track.folderPath, track.rootPath);
    }

    for (const textFile of textFiles) {
        rememberIndexedFile(textFile.path, textFile.relativePath, textFile.folderPath, textFile.rootPath);
    }

    for (const imageFile of imageFiles) {
        rememberIndexedFile(imageFile.path, imageFile.relativePath, imageFile.folderPath, imageFile.rootPath);
    }

    return {
        indexedFolderPathByKey,
        indexedFileFolderPathByKey,
        monitoredRoots: Array.from(monitoredRootByKey.values()).sort((left, right) => right.path.length - left.path.length),
    };
};

export const resolvePastedLibraryJumpFolder = (
    value: string,
    cache: PastedPathLookupCache,
): string | null => {
    const normalizedPath = normalizePastedLibraryPath(value);
    if (!normalizedPath) {
        return null;
    }

    const pathKey = libraryFolderPathKey(normalizedPath);
    if (!pathKey) {
        return null;
    }

    const {
        indexedFolderPathByKey,
        indexedFileFolderPathByKey,
        monitoredRoots,
    } = cache;

    const exactFileFolderPath = indexedFileFolderPathByKey.get(pathKey);
    if (exactFileFolderPath !== undefined) {
        return exactFileFolderPath;
    }

    const exactFolderPath = indexedFolderPathByKey.get(pathKey);
    if (exactFolderPath !== undefined) {
        return exactFolderPath;
    }

    if (!isLikelyAbsoluteLibraryPath(normalizedPath)) {
        return null;
    }

    for (const monitoredRoot of monitoredRoots) {
        const rootKey = libraryFolderPathKey(monitoredRoot.path);
        if (!rootKey) {
            continue;
        }

        let virtualFolderPath = monitoredRoot.name;
        if (pathKey === rootKey) {
            virtualFolderPath = monitoredRoot.name;
        } else if (pathKey.startsWith(`${rootKey}/`)) {
            const relativeFolderPath = normalizedPath.slice(monitoredRoot.path.length + 1);
            virtualFolderPath = monitoredRoot.name
                ? `${monitoredRoot.name}/${relativeFolderPath}`
                : relativeFolderPath;
        } else {
            continue;
        }

        const indexedFolderPath = indexedFolderPathByKey.get(libraryFolderPathKey(virtualFolderPath));
        if (indexedFolderPath !== undefined) {
            return indexedFolderPath;
        }
    }

    return null;
};
