import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LibraryTrack } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { onTestFinished } from 'vitest';
import { startLibraryMirror } from '../../backend/library/libraryMirror.ts';
import { createMirrorClient } from '../../src/library/mirror/mirrorClient.ts';
import { startMirrorSync, type MirrorLocks } from '../../src/library/mirror/mirrorSync.ts';
import type { LibraryMirrorAction } from '../../src/server/libraryMirrorProtocol.ts';
import type { HostParams } from './fakeHost.ts';
import { hostFailure } from './hostAnswers.ts';
import { installFakeHost } from './unitHost.ts';
import { wholeLibrary } from './wholeLibrary.ts';

// 宿主媒体库的替身（会记录变更，按修订号答 getChanges）加真实的镜像后端与同步服务，镜像同步与读取两边的测试共用

interface Change {
  readonly revision: number;
  readonly changed: readonly string[];
  readonly removed: readonly string[];
}

/** 一台会记录变更的宿主媒体库：修订号随每次改动加一，`getChanges` 按它答差量或要求重建 */
export class FakeLibrary {
  tracks: LibraryTrack[];
  epoch = 'E1';
  revision = 1;
  /** 早于它的修订号已不在宿主的记录里，要重建 */
  floor = 0;
  loading = false;
  hidden = new Set<string>();
  private readonly log: Change[] = [];

  constructor(tracks: LibraryTrack[]) {
    this.tracks = tracks;
  }

  edit(changed: LibraryTrack[], removed: string[] = []): void {
    this.revision += 1;
    for (const track of changed) {
      const at = this.tracks.findIndex((item) => item.handle === track.handle);
      if (at < 0) this.tracks.push(track);
      else this.tracks[at] = track;
    }
    this.tracks = this.tracks.filter((track) => !removed.includes(track.handle));
    this.log.push({ revision: this.revision, changed: changed.map((t) => t.handle), removed });
  }

  search(params: HostParams) {
    const answer = wholeLibrary(this.tracks.filter((track) => !this.hidden.has(track.handle)));
    return typeof answer === 'function' ? answer(params) : answer;
  }

  changes(params: Record<string, unknown>) {
    if (this.loading) return hostFailure('OPERATION_PENDING');
    const epoch = typeof params.epoch === 'string' ? params.epoch : undefined;
    const since = typeof params.since === 'number' ? params.since : undefined;
    if (epoch !== this.epoch || since === undefined || since < this.floor) {
      return {
        success: true as const,
        epoch: this.epoch,
        revision: this.revision,
        resync: true,
        handles: this.tracks.map((track) => track.handle),
      };
    }
    const after = this.log.filter((change) => change.revision > since);
    const alive = new Set(this.tracks.map((track) => track.handle));
    return {
      success: true as const,
      epoch: this.epoch,
      revision: this.revision,
      resync: false,
      changed: [...new Set(after.flatMap((change) => change.changed))].filter((h) => alive.has(h)),
      removed: [...new Set(after.flatMap((change) => change.removed))].filter((h) => !alive.has(h)),
    };
  }
}

export function setupMirror(tracks: LibraryTrack[], options: { locks?: MirrorLocks } = {}) {
  const host = installFakeHost();
  const library = new FakeLibrary(tracks);
  host.answer('library.getChanges', (params) => library.changes(params));
  host.answer('library.getTracks', (params) => {
    const handles = Array.isArray(params.handles) ? params.handles.map(String) : [];
    const found = library.tracks.filter((track) => handles.includes(track.handle));
    return {
      success: true as const,
      tracks: handles.flatMap((h) => found.filter((t) => t.handle === h)),
      missing: handles.filter((h) => !found.some((t) => t.handle === h)),
    };
  });
  host.answer('library.search', (params) => library.search(params));
  const directoryReady = mkdtemp(join(tmpdir(), 'theme-mirror-sync-'));
  return directoryReady.then(async (directory) => {
    const path = await realpath(directory);
    onTestFinished(() => rm(path, { recursive: true, force: true }));
    const backend = startLibraryMirror(path);
    onTestFinished(() => backend.dispose());
    const calls: string[] = [];
    const client = createMirrorClient({
      request: (url, body) => {
        const action = url.slice('/library/'.length) as LibraryMirrorAction;
        calls.push(action);
        const wire: unknown = JSON.parse(JSON.stringify(body ?? {}));
        return Promise.resolve(
          JSON.parse(JSON.stringify(backend.request(action, wire))) as unknown,
        );
      },
    });
    const store = createStore();
    const connected = atom(true);
    const service = startMirrorSync(store, {
      client,
      connected,
      host: host.fb,
      locks: options.locks ?? null,
    });
    onTestFinished(() => service.dispose());
    return { host, library, backend, calls, client, store, connected, service };
  });
}
