import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/translate.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import {
  MUSIC_FAILURE_LIMIT,
  type MusicFailureCode,
  type MusicStreamFailure,
} from '../server/musicProtocol.ts';
import type { MusicClient } from './musicClient.ts';
import { platformName } from './musicPlatforms.ts';
import { onlineKey } from './onlineTracks.ts';
import { playingOnlineKeyAtom } from './playback.ts';

const failuresAtom = atom<readonly MusicStreamFailure[]>([]);

const REASONS: Partial<Record<MusicFailureCode, MessageKey>> = {
  'membership-required': 'online.reason.membership',
  'track-missing': 'online.reason.missing',
  unplayable: 'online.reason.unplayable',
  timeout: 'online.reason.timeout',
  'upstream-unavailable': 'online.reason.upstream',
  'rate-limited': 'online.reason.rateLimited',
  authentication: 'online.reason.login',
  'unblock-missing': 'online.reason.unblockMissing',
};

/** 音频路由打开失败的原因怎么写；跳过提示与关于页的服务状态共用。没列的写成笼统的「无法播放」 */
export function failureReasonKey(code: MusicFailureCode): MessageKey {
  return REASONS[code] ?? 'online.reason.other';
}

/** 一次打开失败写给用户看的原因：超时、连不上、限流这几条带上失败的那首所在的平台 */
export function failureReason(
  t: Translate,
  failure: Pick<MusicStreamFailure, 'code' | 'ref'>,
): string {
  return t(failureReasonKey(failure.code), { platform: platformName(t, failure.ref.platform) });
}

/**
 * 页面载入以来音频路由打开在线曲目的失败，从旧到新，最多留 `MUSIC_FAILURE_LIMIT` 条。入队时 fb2k 也会打开
 * 地址，有记录不代表这首已被跳过，按曲目对照换曲由界面判断
 */
export const onlineFailuresAtom: Atom<readonly MusicStreamFailure[]> = atom((get) =>
  get(failuresAtom),
);

const skipAtom = atom<MusicStreamFailure | null>(null);

/** 最近一次被 fb2k 跳过的在线曲目与原因，提示关掉后为 null */
export const onlineSkipAtom: Atom<MusicStreamFailure | null> = atom((get) => get(skipAtom));

const unblockedAtom = atom<ReadonlySet<string>>(new Set<string>());

/** 音频路由最近一次打开时取到第三方补全地址的在线曲目（`onlineKey`），页面载入以来 */
export const onlineUnblockedAtom: Atom<ReadonlySet<string>> = atom((get) => get(unblockedAtom));

/**
 * 问到之前多久内的失败算刚被跳过，毫秒。fb2k 约 1 秒后跳过取不到地址的一项，跳过引出的事件随即来问
 * ponytail: 按时间窗猜，入队时打开失败、又恰在这几秒里换曲的会被误报；SDK 有「哪一项打不开」的事件后改用它
 */
const SKIP_WINDOW_MS = 5000;

/**
 * 失败发生时那首正是「正在播」的：fb2k 打开失败时要等失败返回才报它换了曲，下一首又要等它自己打开完才报，
 * 间隔常有十几秒（后端等上游超时）。所以这样的失败先记着，等下一次换曲事件里「正在播」的换成别的在线曲目，
 * 才认定它被跳过；超过这个时长、或中途停了播放的不算
 */
const PENDING_WINDOW_MS = 30_000;

// fb2k 跳过打不开的一项时会引出这几个事件；没有专门报「哪一项打不开」的事件
const EVENTS = ['playback:starting', 'playback:trackChanged', 'playback:stopped'] as const;

export interface OnlineFailuresService {
  /** 关掉跳过提示 */
  dismissSkip(): void;
  dispose(): void;
}

/**
 * 换曲或停止时向后端问一次新的失败，不轮询。序号不小于记录时的毫秒数，所以从页面载入的时刻问起就不会
 * 收到载入前的失败；后端重启后序号接着变大，照样接得上。问的时候又来了事件，答完再问一次
 */
export function startOnlineFailures(
  store: Store,
  client: Pick<MusicClient, 'failures'>,
  host: { on: typeof fb.on } = fb,
  playing: Atom<string | null> = playingOnlineKeyAtom,
): OnlineFailuresService {
  store.set(failuresAtom, []);
  store.set(skipAtom, null);
  store.set(unblockedAtom, new Set<string>());
  const lifetime = new AbortController();
  let latest = Date.now();
  let running = false;
  let again = false;
  let pending: MusicStreamFailure | null = null;

  async function poll(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const answer = await client.failures(latest, { signal: lifetime.signal }).catch(() => null);
        if (!answer || lifetime.signal.aborted) continue;
        latest = Math.max(latest, answer.latest);
        if (answer.sources.length) {
          const unblocked = new Set(store.get(unblockedAtom));
          for (const item of answer.sources)
            if (item.unblocked) unblocked.add(onlineKey(item.ref));
            else unblocked.delete(onlineKey(item.ref));
          store.set(unblockedAtom, unblocked);
        }
        const current = store.get(playing);
        const now = Date.now();
        if (pending) {
          if (now - pending.at > PENDING_WINDOW_MS) pending = null;
          else if (current !== null && current !== onlineKey(pending.ref)) {
            store.set(skipAtom, pending);
            pending = null;
          }
        }
        if (!answer.items.length) continue;
        store.set(
          failuresAtom,
          [...store.get(failuresAtom), ...answer.items].slice(-MUSIC_FAILURE_LIMIT),
        );
        const recent = [...answer.items]
          .reverse()
          .filter((item) => now - item.at <= SKIP_WINDOW_MS);
        // 正在播的那首现在不算被跳过：它的失败是别处（入队读信息之类）打开时记下的，或是 fb2k 刚报了它却还没换走
        const skipped = recent.find((item) => onlineKey(item.ref) !== current);
        if (skipped) {
          store.set(skipAtom, skipped);
          pending = null;
        } else {
          pending = recent.find((item) => onlineKey(item.ref) === current) ?? pending;
        }
      } while (again && !lifetime.signal.aborted);
    } finally {
      running = false;
    }
  }

  const offs = EVENTS.map((event) =>
    host.on(event, () => {
      // 停了播放就不是被跳过：下一次开始播放不该再为这次失败提示
      if (event === 'playback:stopped') pending = null;
      void poll();
    }),
  );
  return {
    dismissSkip() {
      store.set(skipAtom, null);
    },
    dispose() {
      lifetime.abort();
      for (const off of offs) off();
    },
  };
}

export const onlineFailuresKey = serviceKey<OnlineFailuresService>('onlineFailures');
