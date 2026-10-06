import type { LibraryDirectoryNodeInfo, LibraryRootInfo } from 'foo-webview-sdk';
import type { AnswerTable } from './fakeHost.ts';
import { hostFailure } from './hostAnswers.ts';
import { playlistRow, trackRow } from './libraryRows.ts';

export const FOLDER_ROOT: LibraryRootInfo = {
  id: 'E:\\Music',
  absolutePath: 'E:\\Music',
  rawPath: 'E:\\Music',
  displayName: 'Music',
  trackCount: 3,
};
export function folderDirectory(
  pathId: string,
  count = 1,
  hasChildren = false,
): LibraryDirectoryNodeInfo {
  const parts = pathId.split('/');
  return {
    id: `${FOLDER_ROOT.id}::${pathId}`,
    rootId: FOLDER_ROOT.id,
    pathId,
    parentPathId: parts.slice(0, -1).join('/'),
    name: parts.at(-1) ?? '',
    displayName: parts.at(-1) ?? '',
    absolutePath: `${FOLDER_ROOT.absolutePath}\\${parts.join('\\')}`,
    rawPath: pathId,
    relativePath: pathId,
    depth: parts.length,
    trackCount: count,
    childDirectoryCount: hasChildren ? 1 : 0,
    hasChildren,
  };
}
export const FOLDER_TRACKS = [
  trackRow('Alpha', 'Zebra', { path: 'file://E:\\Music\\Alpha\\01.flac', trackNumber: 1 }),
  trackRow('Alpha', 'Amber', { path: 'file://E:\\Music\\Alpha\\Disc\\02.flac', trackNumber: 2 }),
  trackRow('Beta', 'Blue', { trackNumber: 3 }),
];
export const FOLDER_DIRECTORIES = [
  folderDirectory('Alpha', 2, true),
  folderDirectory('Beta'),
  folderDirectory('Huge', 10_001),
];
export function foldersRootsAnswer() {
  return {
    success: true as const,
    enabled: true,
    roots: [FOLDER_ROOT],
    total: 1,
    indexedTracks: 3,
    skippedTracks: 0,
    fromCache: false,
  };
}
export function foldersBrowseAnswer(pathId: string, includeFiles = false) {
  const directories =
    pathId === '' ? FOLDER_DIRECTORIES : pathId === 'Alpha' ? [folderDirectory('Alpha/Disc')] : [];
  const prefix = `E:\\Music${pathId ? `\\${pathId.replace(/\//g, '\\')}` : ''}\\`;
  const files = includeFiles
    ? FOLDER_TRACKS.filter((track) => track.absolutePath.startsWith(prefix))
    : [];
  return {
    success: true as const,
    root: FOLDER_ROOT,
    pathId,
    absolutePath: prefix,
    directories,
    files,
    fromCache: false,
  };
}
export function foldersAnswers(): AnswerTable {
  const list = playlistRow(0, '[Library View]');
  return {
    library: {
      getRoots: foldersRootsAnswer(),
      browseTree: (params) => {
        if (params.rootId !== FOLDER_ROOT.id) return hostFailure('NOT_FOUND');
        const pathId = typeof params.pathId === 'string' ? params.pathId : '';
        return foldersBrowseAnswer(pathId, params.includeFiles === true);
      },
      search: (params) => {
        const text = typeof params.query === 'string' ? params.query.toLowerCase() : '';
        const tracks = FOLDER_TRACKS.filter((track) => track.title.toLowerCase().includes(text));
        return {
          success: true,
          total: tracks.length,
          tracks,
          offset: 0,
          limit: 5000,
          hasMore: false,
        };
      },
      addToPlaylist: (params) => ({
        success: true,
        added: Array.isArray(params.paths) ? params.paths.length : 0,
      }),
    },
    playlist: {
      getAll: { success: true, playlists: [list], count: 1 },
      clear: {
        success: true,
        playlist: 0,
        playlistGuid: list.guid,
        clearedCount: 0,
        remainingCount: 0,
      },
      playTrack: { success: true },
    },
  };
}
