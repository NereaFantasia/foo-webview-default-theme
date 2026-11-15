import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { onLibraryChanged, trackPathOf, type LibraryEventsFace } from '../host/libraryContract.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';

/**
 * 曲目行里没有、要按 Title Formatting 现算的字段。方括号让字段缺失时整段留空，而不是写成问号。
 * 前五个是标签与技术信息，后两个按文件与播放统计组件
 */
export const TRACK_FIELD_PATTERNS = {
  composer: '[%composer%]',
  performer: '[%performer%]',
  comment: '[%comment%]',
  bitDepth: '[%__bitspersample%]',
  tagType: '[%__tagtype%]',
  lastModified: '[%last_modified%]',
  firstPlayed: '[%first_played%]',
} as const;

export type TrackFieldId = keyof typeof TRACK_FIELD_PATTERNS;
export type TrackFieldValues = Readonly<Partial<Record<TrackFieldId, string>>>;

const FIELD_IDS = Object.keys(TRACK_FIELD_PATTERNS) as readonly TrackFieldId[];

export function isTrackFieldId(value: string): value is TrackFieldId {
  return FIELD_IDS.some((id) => id === value);
}

/** 一次请求带的曲目数；一页行不过百，几屏滚动的量一次取完 */
const BATCH = 200;
/** 字段间的分隔：不会出现在标签值里的控制字符，注释这类多行文本里竖线与换行都可能有 */
const SEPARATOR = '\u001f';

export interface TrackFieldsService {
  /** 取这几首的这几个字段；已取过或正在取的不重取。值到齐后 `version` 加一 */
  ensure(tracks: readonly Pick<Track, 'path' | 'subsong'>[], fields: readonly TrackFieldId[]): void;
  /** 已取到的值；还没取到、宿主读不出的字段缺着 */
  valuesOf(track: Pick<Track, 'path' | 'subsong'>): TrackFieldValues | undefined;
  /** 值到了或缓存被清掉就加一，表格据此重画 */
  readonly version: Atom<number>;
  dispose(): void;
}

export const trackFieldsKey = serviceKey<TrackFieldsService>('trackFields');

export interface TrackFieldsFace extends HostReadyFace {
  titleformat: Pick<typeof fb.titleformat, 'evalBatch'>;
  on?: LibraryEventsFace['on'] | undefined;
}

interface Pending {
  readonly paths: readonly string[];
  readonly fields: readonly TrackFieldId[];
}

/**
 * 表格按列显示的标签字段：只算画在屏上的行，值按曲目路径缓存。库里的标签改了（`library:itemsModified` 等）
 * 整份缓存作废，表格重画时按新的屏上行重取。宿主答不出的行（读不了文件、远程路径没有缓存）字段留空，不重试：
 * 滚动时反复问同一批读不出的行只会拖慢宿主
 */
export function startTrackFields(store: Store, host: TrackFieldsFace = fb): TrackFieldsService {
  const versionAtom = atom(0);
  const values = new Map<string, Partial<Record<TrackFieldId, string>>>();
  const asked = new Map<string, Set<TrackFieldId>>();
  const queue: Pending[] = [];
  let generation = 0;
  let running = false;
  let disposed = false;
  const bump = () => store.set(versionAtom, store.get(versionAtom) + 1);

  async function run() {
    if (running) return;
    running = true;
    try {
      for (let next = queue.shift(); next && !disposed; next = queue.shift()) {
        const mine = generation;
        for (let at = 0; at < next.paths.length && !disposed && mine === generation; at += BATCH) {
          const paths = next.paths.slice(at, at + BATCH);
          const pattern = next.fields.map((field) => TRACK_FIELD_PATTERNS[field]).join(`$char(31)`);
          const answer = await settle(() => host.titleformat.evalBatch(pattern, [...paths]));
          if (disposed || mine !== generation) break;
          if (!answer || answer.success === false) {
            // 整批没答上：让这批能被下次画面变化再问，不留成「已问过」
            for (const path of paths)
              for (const field of next.fields) asked.get(path)?.delete(field);
            continue;
          }
          answer.results.forEach((row, index) => {
            const path = paths[index];
            if (path === undefined || !row.success || row.infoAvailable === false) return;
            const parts = (row.result ?? '').split(SEPARATOR);
            // 每次换一个新对象：表格的行按属性比较，原地改了它看不出值到了
            const found: Partial<Record<TrackFieldId, string>> = { ...values.get(path) };
            next.fields.forEach((field, position) => {
              const text = parts[position];
              if (text) found[field] = text;
            });
            values.set(path, found);
          });
          bump();
        }
      }
    } finally {
      running = false;
    }
  }

  const waiter = waitForHost(host);
  let off: (() => void) | undefined;
  void waiter.done.then((arrived) => {
    if (disposed || !arrived || !host.on) return;
    off = onLibraryChanged({ on: host.on }, () => {
      generation += 1;
      values.clear();
      asked.clear();
      queue.length = 0;
      bump();
    });
  });

  return {
    ensure(tracks, fields) {
      if (disposed || fields.length === 0) return;
      const todo = new Map<string, Set<TrackFieldId>>();
      for (const track of tracks) {
        const path = trackPathOf(track);
        const done = asked.get(path) ?? new Set<TrackFieldId>();
        const missing = fields.filter((field) => !done.has(field));
        if (missing.length === 0) continue;
        for (const field of missing) done.add(field);
        asked.set(path, done);
        todo.set(path, new Set(missing));
      }
      if (todo.size === 0) return;
      // 同一批里各行缺的字段可能不一样，按并集一起算，已有的字段重算一遍比多开一次请求便宜
      const wanted = FIELD_IDS.filter((field) => [...todo.values()].some((set) => set.has(field)));
      queue.push({ paths: [...todo.keys()], fields: wanted });
      void run();
    },
    valuesOf: (track) => values.get(trackPathOf(track)),
    version: versionAtom,
    dispose() {
      disposed = true;
      generation += 1;
      queue.length = 0;
      waiter.cancel();
      off?.();
    },
  };
}
