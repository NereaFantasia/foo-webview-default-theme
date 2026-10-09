import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { hostCommand, settle } from '../../host/hostCall.ts';
import { hasPlaycountComponent } from '../../host/playcountComponent.ts';
import { waitForHost } from '../../host/waitForHost.ts';
import type { Translate } from '../../i18n/translate.ts';
import type { Store } from '../../kit/store.ts';
import { copyInfoFields } from './trackInfoRows.ts';
import {
  copyInfoTags,
  emptyTrackInfo,
  infoFilePath,
  infoMediaKind,
  infoTags,
  INITIAL_INFO_SECTIONS,
  INFO_SECTIONS,
  type InfoRead,
  type InfoSection,
  type TrackInfoState,
} from './trackInfoModel.ts';

export interface TrackInfoDeps {
  readonly track: Atom<Track | null>;
  readonly active: Atom<boolean>;
}

export type TrackInfoHost = Pick<
  typeof fb,
  | 'metadata'
  | 'titleformat'
  | 'file'
  | 'config'
  | 'playcount'
  | 'replaygain'
  | 'rating'
  | 'clipboard'
  | 'shell'
  | 'on'
  | 'isAvailable'
  | 'ready'
>;

export interface TrackInfoService {
  readonly state: Atom<TrackInfoState>;
  readonly sections: Atom<readonly InfoSection[]>;
  readonly ready: Promise<void>;
  setSections(sections: readonly InfoSection[]): void;
  refresh(): void;
  copy(text: string): Promise<boolean>;
  copyTags(): Promise<boolean>;
  copyAll(t: Translate, locale: string): Promise<boolean>;
  openFolder(): Promise<boolean>;
  dispose(): void;
}

const AUDIO_FIELDS = { bitDepth: '%__bitspersample%', encoding: '%__encoding%' };
const formattedValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' && value !== '?' ? value : undefined;

function failedRead(answer: { code?: string } | null): InfoRead<never> {
  return {
    status:
      answer?.code === 'NOT_SUPPORTED' || answer?.code === 'METHOD_NOT_FOUND'
        ? 'unavailable'
        : 'failed',
  };
}

export function startTrackInfo(
  store: Store,
  deps: TrackInfoDeps,
  host: TrackInfoHost = fb,
): TrackInfoService {
  const state = atom(emptyTrackInfo(store.get(deps.track)));
  const sections = atom<readonly InfoSection[]>(INITIAL_INFO_SECTIONS);
  const waiter = waitForHost(host);
  let disposed = false;
  let connected = false;
  let generation = 0;
  let active = false;
  let track: Track | null = null;
  let reads: Promise<void>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let components: Promise<Awaited<ReturnType<typeof host.config.getComponents>> | null> | undefined;
  const offs: (() => void)[] = [];

  const valid = (id: number) => !disposed && active && id === generation;
  function update(id: number, patch: Partial<TrackInfoState>) {
    if (valid(id)) store.set(state, (current) => ({ ...current, ...patch }));
  }

  async function loadMetadata(target: Track, id: number, raw: boolean) {
    const answer = await settle(() =>
      raw ? host.metadata.readRaw(target.handle) : host.metadata.read(target.handle),
    );
    update(id, {
      metadata: answer?.success === true ? { status: 'ready', value: answer } : failedRead(answer),
      tagSource: raw ? 'file' : 'host',
    });
  }

  async function loadAudio(target: Track, id: number) {
    const answer = await settle(() => host.titleformat.evalFields(target.handle, AUDIO_FIELDS));
    update(id, {
      audio:
        answer?.success === true && answer.infoAvailable !== false
          ? {
              status: 'ready',
              value: {
                bitDepth: formattedValue(answer['bitDepth']),
                encoding: formattedValue(answer['encoding']),
              },
            }
          : failedRead(answer?.success === false ? answer : null),
    });
  }

  async function loadRating(target: Track, id: number) {
    const answer = await settle(() => host.rating.get(target.handle));
    update(id, {
      rating: answer?.success === true ? { status: 'ready', value: answer } : failedRead(answer),
    });
  }

  async function loadFile(target: Track, id: number) {
    const path = infoFilePath(target);
    if (!path) {
      update(id, { file: { status: 'notApplicable' } });
      return;
    }
    const answer = await settle(() => host.file.getInfo(path));
    update(id, {
      file: answer?.success === true ? { status: 'ready', value: answer } : failedRead(answer),
    });
  }

  async function loadStatistics(target: Track, id: number) {
    components ??= settle(() => host.config.getComponents());
    const installed = await components;
    if (!valid(id)) return;
    if (!installed || installed.success === false) {
      components = undefined;
      update(id, { statistics: failedRead(installed) });
      return;
    }
    const available = hasPlaycountComponent(installed.components);
    if (!available) {
      update(id, { statistics: { status: 'unavailable' } });
      return;
    }
    const answer = await settle(() => host.playcount.get(target.handle));
    const row = answer?.success === true ? answer.results[0] : undefined;
    update(id, {
      statistics: row?.success
        ? { status: 'ready', value: row }
        : failedRead(answer?.success === false ? answer : null),
    });
  }

  async function loadReplayGain(target: Track, id: number) {
    const answer = await settle(() => host.replaygain.get(target.handle));
    const row = answer?.success === true ? answer.results[0] : undefined;
    update(id, {
      replayGain: row?.success
        ? { status: 'ready', value: row }
        : failedRead(answer?.success === false ? answer : null),
    });
  }

  function loadSections(requested = store.get(sections)) {
    if (!connected || !active || !track || disposed || infoMediaKind(track) === 'stream') return;
    const target = track;
    const id = generation;
    const loaders = { file: loadFile, statistics: loadStatistics, replayGain: loadReplayGain };
    for (const key of ['file', 'statistics', 'replayGain'] as const) {
      if (!requested.includes(key) || store.get(state)[key].status !== 'idle') continue;
      update(id, { [key]: { status: 'loading' } });
      reads.push(loaders[key](target, id));
    }
  }

  function load(raw: boolean) {
    generation += 1;
    reads = [];
    const id = generation;
    store.set(state, emptyTrackInfo(track));
    if (!connected || !active || !track || disposed) return;
    // 网络流不能交给同步打开文件的端点，否则网络超时会阻塞宿主主线程。
    if (infoMediaKind(track) === 'stream') {
      const skipped = { status: 'notApplicable' } as const;
      update(id, {
        metadata: skipped,
        audio: skipped,
        file: skipped,
        statistics: skipped,
        replayGain: skipped,
        rating: skipped,
      });
      return;
    }
    update(id, {
      metadata: { status: 'loading' },
      audio: { status: 'loading' },
      rating: { status: 'loading' },
    });
    reads.push(loadMetadata(track, id, raw), loadAudio(track, id), loadRating(track, id));
    loadSections();
  }

  function follow() {
    if (disposed) return;
    const next = store.get(deps.track);
    const visible = store.get(deps.active);
    if (next === track && active === visible) return;
    track = next;
    active = visible;
    clearTimeout(timer);
    load(false);
  }

  function invalidate() {
    if (!active || disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => load(false), 60);
  }

  async function copy(text: string): Promise<boolean> {
    if (disposed) return false;
    const id = generation;
    const success = await hostCommand(() => host.clipboard.write(text));
    update(id, { action: success ? 'copied' : 'copyFailed' });
    return success;
  }

  offs.push(store.sub(deps.track, follow), store.sub(deps.active, follow));
  follow();
  const ready = (async () => {
    if (!(await waiter.done) || disposed) return;
    connected = true;
    offs.push(
      host.on('metadb:changed', (event) => {
        if (
          track &&
          (event.count > event.tracks.length ||
            event.tracks.some((item) => item.handle === track?.handle))
        )
          invalidate();
      }),
      host.on('metadata:writeComplete', (event) => {
        if (
          event.success &&
          track &&
          event.subsong === track.subsong &&
          [track.handle, track.path, track.absolutePath].includes(event.path)
        )
          invalidate();
      }),
    );
    load(false);
  })();

  return {
    state,
    sections,
    ready,
    setSections(value) {
      if (disposed) return;
      store.set(sections, value);
      loadSections();
    },
    refresh() {
      if (!disposed) {
        clearTimeout(timer);
        load(true);
      }
    },
    copy,
    copyTags() {
      const data = store.get(state).metadata;
      return data.status === 'ready'
        ? copy(copyInfoTags(infoTags(data.value.tags)))
        : Promise.resolve(false);
    },
    async copyAll(t, locale) {
      const id = generation;
      if (!valid(id) || !connected || !track || store.get(state).action === 'copying') return false;
      update(id, { action: 'copying' });
      loadSections(INFO_SECTIONS);
      await Promise.all(reads);
      if (!valid(id)) return false;
      return copy(copyInfoFields(store.get(state), t, locale));
    },
    async openFolder() {
      const path = track && infoFilePath(track);
      if (disposed || !path) return false;
      const id = generation;
      const success = await hostCommand(() => host.shell.showInExplorer(path));
      update(id, { action: success ? 'idle' : 'openFailed' });
      return success;
    },
    dispose() {
      disposed = true;
      generation += 1;
      waiter.cancel();
      clearTimeout(timer);
      for (const off of offs.splice(0)) off();
    },
  };
}
