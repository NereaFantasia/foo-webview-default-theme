import { atom, createStore, type Atom } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type {
  AppleApiResult,
  AppleClient,
} from '../../../../../src/library/biography/apple/appleClient.ts';
import type { AppleArtistHit } from '../../../../../src/library/biography/apple/appleCatalog.ts';
import { startAppleIdentity } from '../../../../../src/library/biography/apple/appleIdentity.ts';
import {
  APPLE_IDENTITY_CACHE_FILE,
  type AppleManualIdentity,
} from '../../../../../src/library/biography/apple/appleIdentityRecord.ts';
import type { LocalAlbum } from '../../../../../src/library/biography/apple/appleMatch.ts';
import { lookupAnswer, searchAnswer } from '../../../../fixtures/appleCatalog.ts';
import { artistFile, installArtistFiles } from '../../../../fixtures/artistFilesHost.ts';

const FILE = artistFile(APPLE_IDENTITY_CACHE_FILE);
const NIRVANA = { id: 112018, name: 'Nirvana', genre: '另类音乐' };
const OTHER = { id: 256176428, name: 'Nirvana' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(301);

const data = (value: unknown): AppleApiResult => ({ kind: 'data', data: value });

const SEARCH = data(searchAnswer(NIRVANA, OTHER));
const LOOKUP = data(
  lookupAnswer({
    1: { artist: NIRVANA, albums: [{ title: 'Nevermind', year: 1991, tracks: 13 }] },
    2: { artist: OTHER, albums: [{ title: 'Black Flower', year: 2015, tracks: 10 }] },
  }),
);
const NEVERMIND: LocalAlbum = { name: 'Nevermind', year: 1991, trackCount: 13 };

function setup(
  files: Readonly<Record<string, string>> = {},
  term?: Atom<string | null>,
  language?: Atom<'zh' | 'en'>,
) {
  const { host, files: stored } = installArtistFiles(files);
  const store = createStore();
  const artist = atom<string | null>('Nirvana');
  const albums = atom<readonly LocalAlbum[] | null>([NEVERMIND]);
  const manual = atom<AppleManualIdentity | null>(null);
  const enabled = atom(true);
  const active = atom(true);
  const answers: { search: AppleApiResult; lookup: AppleApiResult } = {
    search: SEARCH,
    lookup: LOOKUP,
  };
  const search = vi.fn<AppleClient['search']>(async (_term, alive) => {
    if (alive && !alive()) return { kind: 'failed', problem: 'network', retryAt: 0 };
    return answers.search;
  });
  const lookup = vi.fn(
    async (_ids: readonly string[], alive?: () => boolean): Promise<AppleApiResult> => {
      if (alive && !alive()) return { kind: 'failed', problem: 'network', retryAt: 0 };
      return answers.lookup;
    },
  );
  const client: Pick<AppleClient, 'search' | 'lookup'> = { search, lookup };
  const deps = {
    artist,
    albums,
    manual,
    enabled,
    active,
    ...(term ? { term } : {}),
    ...(language ? { language } : {}),
  };
  const service = startAppleIdentity(store, deps, client, host.fb);
  onTestFinished(() => service.dispose());
  return {
    ...deps,
    store,
    service,
    search,
    lookup,
    answers,
    stored,
    state: () => store.get(service.state),
  };
}

describe('Apple 身份认定服务', () => {
  it('自动认定后写进缓存；重开时直接用缓存，不再请求', async () => {
    const env = setup();
    await env.service.ready;
    await tick();
    expect(env.state()).toMatchObject({
      artist: 'Nirvana',
      status: 'resolved',
      sourceId: '112018',
      sourceArtist: 'Nirvana',
      manual: false,
    });
    expect(env.search).toHaveBeenCalledTimes(1);
    expect(env.lookup).toHaveBeenCalledTimes(1);
    expect(env.lookup.mock.calls[0]?.[0]).toEqual(['112018', '256176428']);
    const saved = env.stored.get(FILE) ?? '';
    expect(saved).toContain('112018');
    const again = setup({ [FILE]: saved });
    await again.service.ready;
    await tick();
    expect(again.state()).toMatchObject({ status: 'resolved', sourceId: '112018' });
    expect(again.search).not.toHaveBeenCalled();
  });

  it('界面是英文时，自动认定与搜索框的搜索都按英文去要曲风名', async () => {
    const env = setup({}, undefined, atom<'zh' | 'en'>('en'));
    await env.service.ready;
    await tick();
    await env.service.search('nirvana');
    expect(env.search.mock.calls.map((call) => call[2])).toEqual(['en', 'en']);
  });

  it('关着或不在显示时不请求；媒体库没读完时等着，读完再认定', async () => {
    const env = setup();
    env.store.set(env.albums, null);
    env.store.set(env.active, false);
    await tick();
    expect(env.search).not.toHaveBeenCalled();
    env.store.set(env.active, true);
    await tick();
    expect(env.state().status).toBe('resolving');
    expect(env.search).not.toHaveBeenCalled();
    env.store.set(env.albums, [NEVERMIND]);
    await tick();
    expect(env.state()).toMatchObject({ status: 'resolved', sourceId: '112018' });
  });

  it('没有本地专辑可比：认名字一致的第一位；有专辑却一位也没对上不认（不足 3 张列候选，不少于 3 张查无此人）；没有一位名字一致也没有重合时查无此人', async () => {
    const env = setup();
    env.store.set(env.albums, []);
    await tick();
    expect(env.state()).toMatchObject({ status: 'resolved', sourceId: '112018', manual: false });
    const few = setup();
    few.store.set(few.albums, [{ name: 'Silent Hours', year: 2009, trackCount: 8 }]);
    await tick();
    expect(few.state()).toMatchObject({ status: 'ambiguous' });
    const many = setup();
    many.store.set(many.albums, [
      { name: 'Silent Hours', year: 2009, trackCount: 8 },
      { name: 'Quiet Days', year: 2011, trackCount: 9 },
      { name: 'Dusk', year: 2013, trackCount: 7 },
    ]);
    await tick();
    expect(many.state().status).toBe('none');
    const none = setup();
    none.answers.search = data(searchAnswer({ id: 7, name: 'Someone Else' }));
    none.answers.lookup = data(lookupAnswer({}));
    await tick();
    expect(none.state().status).toBe('none');
  });

  it('只有名字不一致、又只撞上一张通用标题的候选：列出来让用户确认', async () => {
    const env = setup();
    env.answers.search = data(searchAnswer({ id: 9, name: 'Nirvana UK' }));
    env.answers.lookup = data(
      lookupAnswer({
        1: { artist: { id: 9, name: 'Nirvana UK' }, albums: [{ title: 'Nevermind' }] },
      }),
    );
    await tick();
    expect(env.state()).toMatchObject({ status: 'ambiguous', candidates: [{ id: '9' }] });
  });

  it('防抖从换人那一刻起算：同一位艺人等专辑名单读完后马上认定，不再等一轮；换人仍要停够', async () => {
    const env = setup();
    env.store.set(env.albums, null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.state().status).toBe('resolving');
    expect(env.search).not.toHaveBeenCalled();
    env.store.set(env.albums, [NEVERMIND]);
    await vi.advanceTimersByTimeAsync(1);
    expect(env.search).toHaveBeenCalledTimes(1);
    expect(env.state()).toMatchObject({ status: 'resolved', sourceId: '112018' });
    env.store.set(env.artist, 'Other Band');
    await vi.advanceTimersByTimeAsync(299);
    expect(env.search).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(env.search).toHaveBeenCalledTimes(2);
  });

  it('名字唯一一致时把命中交给提前取页，调用方放弃后 alive 为假', async () => {
    const { host } = installArtistFiles();
    const store = createStore();
    const prefetch = vi.fn<(hit: AppleArtistHit, alive: () => boolean) => void>();
    const deps = {
      artist: atom<string | null>('Nirvana'),
      albums: atom<readonly LocalAlbum[] | null>([NEVERMIND]),
      manual: atom<AppleManualIdentity | null>(null),
      enabled: atom(true),
      active: atom(true),
      prefetch,
    };
    const answers = data(searchAnswer(NIRVANA));
    const client: Pick<AppleClient, 'search' | 'lookup'> = {
      search: async () => answers,
      lookup: async () => LOOKUP,
    };
    const service = startAppleIdentity(store, deps, client, host.fb);
    onTestFinished(() => service.dispose());
    await service.ready;
    await tick();
    expect(prefetch).toHaveBeenCalledTimes(1);
    const [hit, alive] = prefetch.mock.calls[0] ?? [];
    expect(hit).toMatchObject({ id: '112018', name: 'Nirvana' });
    expect(alive?.()).toBe(true);
    store.set(deps.artist, 'Other Band');
    expect(alive?.()).toBe(false);
  });

  it('手选的直接用，不请求；「这些都不是」不显示简介也不再请求；手选删掉后回到自动认定', async () => {
    const env = setup();
    env.store.set(env.manual, {
      artist: 'Nirvana',
      sourceId: '256176428',
      sourceArtist: 'Nirvana',
      url: 'https://music.apple.com/cn/artist/nirvana/256176428',
    });
    await tick();
    expect(env.state()).toMatchObject({ status: 'resolved', sourceId: '256176428', manual: true });
    expect(env.search).not.toHaveBeenCalled();
    env.store.set(env.manual, { artist: 'Nirvana', declined: true });
    await tick();
    expect(env.state().status).toBe('declined');
    expect(env.search).not.toHaveBeenCalled();
    env.store.set(env.manual, null);
    await tick();
    expect(env.state()).toMatchObject({ status: 'resolved', sourceId: '112018', manual: false });
  });

  it('从候选里选一位：交出手选，认定记录改成这一位', async () => {
    const env = setup();
    env.store.set(env.albums, [{ name: 'Silent Hours', year: 2009, trackCount: 8 }]);
    await tick();
    const picked = env.service.pick('256176428');
    expect(picked).toEqual({
      artist: 'Nirvana',
      sourceId: '256176428',
      sourceArtist: 'Nirvana',
      url: 'https://music.apple.com/cn/artist/nirvana/256176428',
    });
    expect(env.service.pick('999')).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    const saved = env.stored.get(FILE) ?? '';
    expect(saved).toContain('"sourceId":"256176428"');
    expect(saved).not.toContain('"sourceId":"112018"');
    expect(env.service.decline()).toEqual({ artist: 'Nirvana', declined: true });
  });

  it('搜索框搜到的候选可以选：交出手选，不改身份状态，也不进认定缓存的候选；换人后不再认', async () => {
    const env = setup();
    env.answers.search = data(searchAnswer({ id: 7, name: 'Someone Else' }));
    env.answers.lookup = data(lookupAnswer({}));
    await tick();
    expect(env.state().status).toBe('none');
    env.answers.search = data(searchAnswer({ id: 9, name: 'Nirvana UK', genre: '流行' }));
    env.answers.lookup = data(
      lookupAnswer({
        1: { artist: { id: 9, name: 'Nirvana UK' }, albums: [{ title: 'Local Garage' }] },
      }),
    );
    const found = await env.service.search('  nirvana uk ');
    expect(env.search.mock.calls.at(-1)?.[0]).toBe('nirvana uk');
    expect(found).toMatchObject({
      ok: true,
      candidates: [{ id: '9', name: 'Nirvana UK', overlap: 0, samples: ['Local Garage'] }],
    });
    expect(env.state().status).toBe('none');
    expect(env.service.pick('9')).toEqual({
      artist: 'Nirvana',
      sourceId: '9',
      sourceArtist: 'Nirvana UK',
      url: 'https://music.apple.com/cn/artist/nirvana%20uk/9',
    });
    env.store.set(env.artist, 'Other Band');
    expect(env.service.pick('9')).toBeNull();
  });

  it('搜索：空关键词不请求；没有结果给空列表；失败说明原因，限流让后面的认定也等着', async () => {
    const env = setup();
    await tick();
    const requests = env.search.mock.calls.length;
    expect(await env.service.search('   ')).toEqual({ ok: true, candidates: [] });
    expect(env.search).toHaveBeenCalledTimes(requests);
    env.answers.search = data(searchAnswer());
    expect(await env.service.search('nobody')).toEqual({ ok: true, candidates: [] });
    env.answers.search = { kind: 'failed', problem: 'rateLimited', retryAt: Date.now() + 600_000 };
    expect(await env.service.search('nirvana')).toEqual({ ok: false, reason: 'rateLimited' });
    env.answers.search = SEARCH;
    env.store.set(env.artist, 'Another');
    await tick();
    expect(env.state()).toMatchObject({ status: 'failed', problem: 'rateLimited' });
  });

  it('「不是这位」：认定时留下的候选直接列出来，被否定的沉到最后，不再请求', async () => {
    const env = setup();
    await tick();
    expect(env.state()).toMatchObject({ status: 'resolved', sourceId: '112018' });
    const requests = env.search.mock.calls.length;
    env.service.reject();
    const state = env.state();
    expect(state.status).toBe('ambiguous');
    if (state.status === 'ambiguous')
      expect(state.candidates.map((item) => item.id)).toEqual(['256176428', '112018']);
    expect(env.search).toHaveBeenCalledTimes(requests);
    // 重开后仍是候选列表：被否定的那位按证据排第一，读回时不能重判成认定
    await vi.advanceTimersByTimeAsync(0);
    const again = setup({ [FILE]: env.stored.get(FILE) ?? '' });
    await again.service.ready;
    await tick();
    expect(again.state()).toMatchObject({ status: 'ambiguous' });
    expect(again.search).not.toHaveBeenCalled();
  });

  it('放宽认定规则之前存下的候选记录：读回时在本机重判成认定，不发请求', async () => {
    const now = Date.now();
    const candidate = (id: number, overlap: number, reliable: number) => ({
      id: String(id),
      name: 'Nirvana',
      genre: '',
      url: `https://music.apple.com/cn/artist/nirvana/${id}`,
      nameMatch: true,
      overlap,
      reliable,
      matched: [],
      albumCount: 3,
      years: null,
      samples: [],
    });
    const record = {
      artist: 'Nirvana',
      status: 'ambiguous',
      candidates: [candidate(256176428, 1, 0), candidate(112018, 4, 2)],
      fetchedAt: now,
      expiresAt: now + 1_000_000,
    };
    const env = setup({ [FILE]: JSON.stringify({ version: 1, entries: [record] }) });
    await env.service.ready;
    await tick();
    expect(env.state()).toMatchObject({ status: 'resolved', sourceId: '112018', manual: false });
    expect(env.search).not.toHaveBeenCalled();
  });

  it('「不是这位」时没有候选可列：重新搜，这次不比对专辑，不会又认回同一位', async () => {
    const now = Date.now();
    const record = {
      artist: 'Nirvana',
      status: 'resolved',
      sourceId: '112018',
      sourceArtist: 'Nirvana',
      url: 'https://music.apple.com/cn/artist/nirvana/112018',
      candidates: [],
      fetchedAt: now,
      expiresAt: now + 1_000_000,
    };
    const env = setup({ [FILE]: JSON.stringify({ version: 1, entries: [record] }) });
    await env.service.ready;
    await tick();
    expect(env.state()).toMatchObject({ status: 'resolved', sourceId: '112018' });
    expect(env.search).not.toHaveBeenCalled();
    env.service.reject();
    await tick();
    expect(env.search).toHaveBeenCalledTimes(1);
    // 本地的 Nevermind 与 112018 对得上，不比对专辑时仍只列候选
    expect(env.state().status).toBe('ambiguous');
  });

  it('限流对所有艺人生效，主动刷新不放行限流；断网只记在出错的那位上，刷新马上重试', async () => {
    const env = setup();
    env.answers.search = { kind: 'failed', problem: 'network', retryAt: Date.now() + 600_000 };
    await tick();
    expect(env.state()).toMatchObject({ status: 'failed', problem: 'network' });
    env.store.set(env.artist, 'Other Band');
    env.answers.search = SEARCH;
    await tick();
    expect(env.state().status).not.toBe('failed');
    env.store.set(env.artist, 'Nirvana');
    await tick();
    expect(env.state()).toMatchObject({ status: 'failed', problem: 'network' });
    env.service.refresh();
    await tick();
    expect(env.state().status).not.toBe('failed');

    const limited = setup();
    limited.answers.search = {
      kind: 'failed',
      problem: 'rateLimited',
      retryAt: Date.now() + 600_000,
    };
    await tick();
    limited.answers.search = SEARCH;
    limited.store.set(limited.artist, 'Another');
    await tick();
    expect(limited.state()).toMatchObject({ status: 'failed', problem: 'rateLimited' });
  });

  it('连续换人只认定最后一位，旧的应答不会盖掉新的', async () => {
    const env = setup();
    env.store.set(env.artist, 'First');
    env.store.set(env.artist, 'Nirvana');
    await tick();
    expect(env.search.mock.calls.map((call) => call[0])).toEqual(['Nirvana']);
    expect(env.state().artist).toBe('Nirvana');
  });

  it('粘贴链接：按 ID 查出名字和页面地址，交出手选；链接不对、查无此人、请求失败分别说明', async () => {
    const env = setup();
    env.answers.lookup = data(lookupAnswer({ 1: { artist: OTHER, albums: [] } }));
    const link = 'https://music.apple.com/cn/artist/nirvana/256176428';
    expect(await env.service.resolveLink(link)).toEqual({
      ok: true,
      identity: {
        artist: 'Nirvana',
        sourceId: '256176428',
        sourceArtist: 'Nirvana',
        url: link,
      },
    });
    expect(await env.service.resolveLink('https://www.last.fm/music/Nirvana')).toEqual({
      ok: false,
      reason: 'link',
    });
    expect(await env.service.resolveLink('https://music.apple.com/cn/artist/nirvana/999')).toEqual({
      ok: false,
      reason: 'missing',
    });
    env.answers.lookup = { kind: 'failed', problem: 'rateLimited', retryAt: 1 };
    expect(await env.service.resolveLink(link)).toEqual({ ok: false, reason: 'rateLimited' });
  });

  it('键与搜索名分开：按搜索名查 Apple，状态与缓存按键存取；同名的另一位在线艺人与同名的本地艺人都不沿用这一位的认定', async () => {
    const term = atom<string | null>('Nirvana');
    const env = setup({}, term);
    env.store.set(env.artist, 'online:ncm:100');
    await tick();
    expect(env.search.mock.calls[0]?.[0]).toBe('Nirvana');
    expect(env.state()).toMatchObject({
      artist: 'online:ncm:100',
      status: 'resolved',
      sourceId: '112018',
    });
    const saved = env.stored.get(FILE) ?? '';
    expect(saved).toContain('online:ncm:100');
    // 同名的另一位在线艺人：键不同，缓存里没有，重新认定
    env.store.set(env.artist, 'online:ncm:200');
    await tick();
    expect(env.search).toHaveBeenCalledTimes(2);
    expect(env.state().artist).toBe('online:ncm:200');
    // 同名的本地艺人：键就是名字，也不读在线艺人的记录
    env.store.set(term, null);
    env.store.set(env.artist, 'Nirvana');
    await tick();
    expect(env.search).toHaveBeenCalledTimes(3);
    expect(env.search.mock.calls[2]?.[0]).toBe('Nirvana');
    // 重开后在线艺人那一条仍按键命中，不再请求
    const again = setup({ [FILE]: env.stored.get(FILE) ?? '' }, atom<string | null>('Nirvana'));
    again.store.set(again.artist, 'online:ncm:100');
    await tick();
    expect(again.state()).toMatchObject({ artist: 'online:ncm:100', status: 'resolved' });
    expect(again.search).not.toHaveBeenCalled();
  });

  it('清理缓存后下次重新认定', async () => {
    const env = setup();
    await tick();
    expect(await env.service.clearCache()).toBe(true);
    expect(env.state().status).toBe('idle');
  });
});
