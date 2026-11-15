import { describe, expect, it } from 'vitest';
import type {
  AppleAlbum,
  AppleArtistHit,
} from '../../../../../src/library/biography/apple/appleCatalog.ts';
import {
  APPLE_CANDIDATE_LIMIT,
  appleNameKey,
  appleNameMatches,
  appleTitleKey,
  decideAppleIdentity,
  demoteAppleCandidate,
  listAppleCandidates,
  scoreAppleCandidates,
  selectAppleCandidates,
  type AppleDecision,
  type LocalAlbum,
} from '../../../../../src/library/biography/apple/appleMatch.ts';

function hit(id: number, name: string, genre = '摇滚'): AppleArtistHit {
  return { id: String(id), name, genre, url: `https://music.apple.com/cn/artist/x/${id}` };
}

function album(title: string, year: number | null, trackCount: number | null): AppleAlbum {
  return { title, year, trackCount };
}

function local(name: string, year: number | null, trackCount: number): LocalAlbum {
  return { name, year, trackCount };
}

/** 搜索、选候选、批量 Lookup 比对、判定一条龙，和身份服务里的顺序一致 */
function decide(
  artist: string,
  found: readonly AppleArtistHit[],
  catalog: Record<number, readonly AppleAlbum[]>,
  owned: readonly LocalAlbum[],
  allowAuto = true,
): AppleDecision {
  const chosen = selectAppleCandidates(artist, found);
  const albums = new Map(Object.entries(catalog));
  return decideAppleIdentity(scoreAppleCandidates(artist, chosen, albums, owned), {
    allowAuto,
    localCount: owned.length,
  });
}

/** 给 `grow` 出来的一批标题换个前缀，让两位候选各有各的专辑 */
function rename(prefix: string) {
  return (item: { remote: AppleAlbum; owned: LocalAlbum }) => ({
    remote: { ...item.remote, title: `${prefix} ${item.remote.title}` },
    owned: { ...item.owned, name: `${prefix} ${item.owned.name}` },
  });
}

function resolvedId(decision: AppleDecision): string | null {
  return decision.kind === 'resolved' ? decision.candidate.id : null;
}

function listedIds(decision: AppleDecision): string[] {
  return decision.kind === 'ambiguous' ? decision.candidates.map((item) => item.id) : [];
}

const NIRVANA = [112018, 256176428, 1757499341, 1144913134, 1724751379, 1811259460].map((id) =>
  hit(id, 'Nirvana'),
);
const NIRVANA_CATALOG = {
  112018: [
    album('Nevermind', 1991, 13),
    album('Bleach (20th Anniversary Deluxe Edition)', 2009, 28),
  ],
  256176428: [album('Songs Of Love And Praise', 2013, 9), album('Black Flower', 2015, 10)],
  1811259460: [album('Tender wind - Single', 2020, 1)],
};

describe('Apple 名字与标题的比对键', () => {
  it('名字先繁转简再比，大陆用户的简体名对得上 Apple 的繁体条目', () => {
    expect(appleNameKey('陈奕迅')).toBe(appleNameKey('陳奕迅'));
    expect(appleNameKey('张国荣')).toBe(appleNameKey('張國榮'));
    expect(appleNameKey('The Beatles')).toBe(appleNameKey('beatles'));
    expect(appleNameKey('陈奕迅')).not.toBe(appleNameKey('陈奕'));
  });

  it('标题去掉 Apple 给单曲与 EP 加的后缀，也去掉括号里的版本说明', () => {
    expect(appleTitleKey('Freedom - Single')).toBe(appleTitleKey('Freedom'));
    expect(appleTitleKey('茜紅遊記 - EP')).toBe(appleTitleKey('茜红游记'));
    expect(appleTitleKey('Nevermind (Remastered)')).toBe(appleTitleKey('Nevermind'));
    expect(appleTitleKey('Freedom - Single')).not.toBe(appleTitleKey('Freedom Part 2'));
  });
});

describe('选候选', () => {
  it('名字一致的先入选，不够用排名靠前的补足，一共不超过 8 位', () => {
    const found = [
      hit(1, 'Approaching Nirvana'),
      hit(2, 'Nirvana'),
      hit(3, 'Nirvana UK'),
      hit(4, 'Nirvana'),
      ...Array.from({ length: 10 }, (_, index) => hit(100 + index, `Other ${index}`)),
    ];
    const ids = selectAppleCandidates('Nirvana', found).map((item) => item.id);
    expect(ids.slice(0, 2)).toEqual(['2', '4']);
    expect(ids).toHaveLength(APPLE_CANDIDATE_LIMIT);
    expect(ids).toContain('1');
  });

  it('排在前 8 位之外的同名者也要比到，名字一致的最多占 6 个名额', () => {
    const noise = Array.from({ length: 12 }, (_, index) => hit(100 + index, `Noise ${index}`));
    const ids = selectAppleCandidates('李健', [...noise, hit(7, '李健')]).map((item) => item.id);
    expect(ids[0]).toBe('7');
    const many = Array.from({ length: 9 }, (_, index) => hit(200 + index, 'Genesis'));
    const picked = selectAppleCandidates('Genesis', [hit(1, 'Other'), ...many]);
    expect(picked.filter((item) => item.name === 'Genesis')).toHaveLength(6);
    expect(picked).toHaveLength(7);
  });
});

describe('同名艺人的认定', () => {
  it('标题、年份、曲数都对上：同名者再多也自动认定', () => {
    const result = decide('Nirvana', NIRVANA, NIRVANA_CATALOG, [local('Nevermind', 1991, 13)]);
    expect(resolvedId(result)).toBe('112018');
  });

  it('只有标题对上（重版年份和曲数都对不上），同名者不止一位：认有重合的那位，不列候选', () => {
    const result = decide('Nirvana', NIRVANA, NIRVANA_CATALOG, [local('Nevermind', 2003, 5)]);
    expect(resolvedId(result)).toBe('112018');
    if (result.kind === 'resolved') expect(result.candidate.matched).toEqual(['Nevermind']);
  });

  it('本地没有他的专辑时无从比对：认名字一致的第一位，次序以 Apple 的搜索结果为准', () => {
    expect(resolvedId(decide('Nirvana', NIRVANA, NIRVANA_CATALOG, []))).toBe('112018');
    expect(resolvedId(decide('Nirvana', [...NIRVANA].reverse(), NIRVANA_CATALOG, []))).toBe(
      '1811259460',
    );
  });

  it('本地有专辑而 Apple 上一位也没对上是反证：不足 3 张列名字一致的让用户确认，不少于 3 张查无此人', () => {
    const first = local('Silent Hours', 2009, 8);
    const few = [first];
    const listed = decide('Nirvana', NIRVANA, NIRVANA_CATALOG, few);
    expect(listed.kind).toBe('ambiguous');
    expect(listedIds(listed)).toHaveLength(6);
    const many = [first, local('Quiet Days', 2011, 9), local('Dusk', 2013, 7)];
    expect(decide('Nirvana', NIRVANA, NIRVANA_CATALOG, many)).toEqual({ kind: 'none' });
  });

  it('山寨账号：名字缀了表情、歌曲与真艺人完全不同，哪怕 Apple 上有同名的真艺人也不命中', () => {
    const real = [hit(1, '周杰伦', '国语流行')];
    const catalog = {
      1: [album('范特西', 2001, 10), album('七里香', 2004, 10), album('魔杰座', 2008, 12)],
    };
    const pirate = [
      local('我爱你', 2025, 1),
      local('算了吧!', 2025, 1),
      local('学狗叫', 2025, 1),
      local('若把你!', 2025, 1),
    ];
    expect(decide('周杰伦🫖', real, catalog, pirate)).toEqual({ kind: 'none' });
    // 没有本地专辑可比时，带表情的名字也不算名字一致，不凭名字认
    expect(decide('周杰伦🫖', real, catalog, [])).toEqual({ kind: 'none' });
    // 本地确有这位的专辑时，表情不挡认定
    const genuine = [local('范特西', 2001, 10), local('七里香', 2004, 10)];
    expect(resolvedId(decide('周杰伦🫖', real, catalog, genuine))).toBe('1');
  });

  it('名字一致要连表情与装饰符号也一致；标点与大小写、繁简仍不算差别', () => {
    expect(appleNameMatches('周杰伦', '周杰伦')).toBe(true);
    expect(appleNameMatches('周杰伦🫖', '周杰伦')).toBe(false);
    expect(appleNameMatches('周杰伦♚', '周杰伦')).toBe(false);
    expect(appleNameMatches('周杰伦🫖', '周杰伦🫖')).toBe(true);
    expect(appleNameMatches('P!nk', 'p!NK')).toBe(true);
    expect(appleNameMatches('The Beatles', 'Beatles')).toBe(true);
    expect(appleNameMatches('陈奕迅', '陳奕迅')).toBe(true);
  });

  it('两位同名同曲风的李健靠专辑区分，各认各的', () => {
    const found = [hit(159211091, '李健', '国语流行'), hit(1536590501, '李健', '国语流行')];
    const catalog = {
      159211091: [album('無時無刻', 2021, 15)],
      1536590501: [album('就像在天堂', 2015, 10)],
    };
    expect(resolvedId(decide('李健', found, catalog, [local('就像在天堂', 2015, 10)]))).toBe(
      '1536590501',
    );
    expect(resolvedId(decide('李健', found, catalog, [local('無時無刻', 2021, 15)]))).toBe(
      '159211091',
    );
  });

  it('本地混着两位的专辑、证据完全相当：认 Apple 搜索次序在前的那位，不列候选', () => {
    const found = [hit(159211091, '李健'), hit(1536590501, '李健')];
    const catalog = {
      159211091: [album('無時無刻', 2021, 15)],
      1536590501: [album('就像在天堂', 2015, 10)],
    };
    const owned = [local('就像在天堂', 2015, 10), local('無時無刻', 2021, 15)];
    expect(resolvedId(decide('李健', found, catalog, owned))).toBe('159211091');
    expect(resolvedId(decide('李健', [...found].reverse(), catalog, owned))).toBe('1536590501');
  });

  it('通用标题只有一张撞上、年份和曲数都对不上：重合的那位仍排在没有重合的前面', () => {
    const found = [hit(889841486, 'Genesis'), hit(95966, 'Genesis')];
    const catalog = { 95966: [album('Live', 1973, 8)], 889841486: [album('Other', 2018, 2)] };
    const result = decide('Genesis', found, catalog, [local('Live', 1998, 10)]);
    expect(resolvedId(result)).toBe('95966');
  });

  it('单曲带 - Single 后缀也能对上，年份相同就算可靠', () => {
    const found = [hit(95966, 'Genesis'), hit(889841486, 'Genesis')];
    const catalog = { 889841486: [album('Different League - Single', 2018, 2)] };
    const result = decide('Genesis', found, catalog, [local('Different League', 2018, 2)]);
    expect(resolvedId(result)).toBe('889841486');
  });

  it('曲数相同但不足 3 首不算可靠，本地没有年份也不算', () => {
    const found = [hit(1, 'Solo')];
    const reliableOf = (catalog: Record<number, readonly AppleAlbum[]>, owned: LocalAlbum) =>
      scoreAppleCandidates('Solo', found, new Map(Object.entries(catalog)), [owned])[0]?.reliable;
    expect(
      reliableOf({ 1: [album('Single Song - Single', 2020, 1)] }, local('Single Song', null, 1)),
    ).toBe(0);
    expect(reliableOf({ 1: [album('Disc', 2020, 12)] }, local('Disc', null, 12))).toBe(1);
  });

  it('名字一致的只有一位，标题对上就够：弱证据也自动认定', () => {
    const found = [hit(1, 'Crywolf'), hit(2, 'Crywolf Fans', '另类音乐')];
    const catalog = { 1: [album('Skeleton', 2016, 12)] };
    const result = decide('Crywolf', found, catalog, [local('Skeleton', null, 4)]);
    expect(resolvedId(result)).toBe('1');
  });

  it('唯一同名者：本地没有专辑可比时认它，有专辑却一张没对上就不认', () => {
    const found = [hit(1, 'Felt', '独立摇滚')];
    const catalog = { 1: [album('Let Me Tell You About', 1985, 10)] };
    expect(resolvedId(decide('Felt', found, catalog, []))).toBe('1');
    const result = decide('Felt', found, catalog, [local('茜紅遊記', 2012, 8)]);
    expect(result.kind).toBe('ambiguous');
    expect(listedIds(result)).toEqual(['1']);
  });

  it('名字不一致的候选靠 2 张重合认出：凋叶棕对拼音名', () => {
    const found = [hit(5, 'Diao ye zong', '动漫')];
    const catalog = { 5: [album('Alpha', 2010, 10), album('Beta', 2011, 12)] };
    const result = decide('凋叶棕', found, catalog, [
      local('alpha', 2010, 10),
      local('Beta', 2011, 12),
    ]);
    expect(resolvedId(result)).toBe('5');
  });

  it('名字不一致的候选证据够强，压过名字一致却没有重合的那位', () => {
    const found = [hit(1, '李健'), hit(2, 'Li Jian')];
    const catalog = {
      1: [album('Unrelated', 1999, 3)],
      2: [album('Alpha', 2010, 10), album('Beta', 2011, 12)],
    };
    const result = decide('李健', found, catalog, [
      local('Alpha', 2010, 10),
      local('Beta', 2011, 12),
    ]);
    expect(resolvedId(result)).toBe('2');
  });

  it('名字不一致又只撞上一张通用标题：没有资格被认定，也不压过名字一致的那位，两位都列出来', () => {
    const found = [hit(1, 'Felt'), hit(2, 'Felt Tip')];
    const catalog = { 1: [album('Other', 1985, 10)], 2: [album('Alpha', 2001, 10)] };
    const result = decide('Felt', found, catalog, [local('Alpha', 2010, 4)]);
    expect(result.kind).toBe('ambiguous');
    expect(listedIds(result)).toEqual(['2', '1']);
  });

  it('只有名字不一致又只有弱证据的候选：这是唯一还会列出来的自动情形，让用户确认', () => {
    const found = [hit(5, 'Diao ye zong')];
    const catalog = { 5: [album('Alpha', 2001, 10)] };
    const result = decide('凋叶棕', found, catalog, [local('Alpha', 2010, 4)]);
    expect(result.kind).toBe('ambiguous');
    expect(listedIds(result)).toEqual(['5']);
  });

  it('简体搜索词对繁体条目：名字按繁转简算一致', () => {
    const found = [hit(9, '陳奕迅', '粤语流行')];
    const catalog = { 9: [album('U87', 2005, 12)] };
    const result = decide('陈奕迅', found, catalog, [local('U87', 2005, 12)]);
    expect(resolvedId(result)).toBe('9');
    const [first] = scoreAppleCandidates('陈奕迅', found, new Map(Object.entries(catalog)), []);
    expect(first?.nameMatch).toBe(true);
  });

  it('没有名字一致的、也没有重合的候选：查无此人', () => {
    const result = decide('Nobody', [hit(1, 'Someone Else')], { 1: [album('X', 2000, 3)] }, [
      local('Y', 2000, 3),
    ]);
    expect(result.kind).toBe('none');
    expect(decide('Nobody', [], {}, [])).toEqual({ kind: 'none' });
  });

  it('多位有重合时可靠重合多的认定，候选列表也排在前', () => {
    const found = [hit(1, 'Same'), hit(2, 'Same')];
    const catalog = {
      1: [album('A', 1990, 5)],
      2: [album('A', 2000, 5), album('B', 2001, 5)],
    };
    const owned = [local('A', 2000, 5), local('B', 2001, 5)];
    expect(resolvedId(decide('Same', found, catalog, owned))).toBe('2');
    const scored = scoreAppleCandidates('Same', found, new Map(Object.entries(catalog)), owned);
    expect(listAppleCandidates(scored).map((item) => item.id)).toEqual(['2', '1']);
  });

  it('一位压倒性领先、另一位只撞上一张通用标题：认定领先的那位，候选仍留着', () => {
    const titles = Array.from({ length: 45 }, (_, index) => `重拾 ${index}`);
    const found = [hit(1, '林俊傑', '国语流行'), hit(2, 'Jackson Wang', '国际流行')];
    const catalog = {
      1: titles.map((title, index) => album(title, 2003 + (index % 20), 12)),
      2: [album('過 - Single', 2020, 1), album('Slow - Single', 2022, 1)],
    };
    const owned = [
      ...titles.map((title, index) => local(title, 2003 + (index % 20), 12)),
      local('過', null, 1),
    ];
    const result = decide('林俊杰', found, catalog, owned);
    expect(resolvedId(result)).toBe('1');
    // 认定留下的候选仍在，「不是这位」时可以直接列出来
    const scored = scoreAppleCandidates('林俊杰', found, new Map(Object.entries(catalog)), owned);
    expect(scored.map((item) => item.overlap)).toEqual([45, 1]);
  });

  it('领先不必压倒：只要第一名排在前面就认定，不再要求重合数的倍数', () => {
    const grow = (count: number, year: (index: number) => number | null) =>
      Array.from({ length: count }, (_, index) => ({
        remote: album(`Title ${index}`, year(index), 10),
        owned: local(`Title ${index}`, year(index), 10),
      }));
    const run = (
      top: ReturnType<typeof grow>,
      next: ReturnType<typeof grow>,
      found = [hit(1, 'Same'), hit(2, 'Same')],
    ) =>
      decide(
        'Same',
        found,
        { 1: top.map((item) => item.remote), 2: next.map((item) => item.remote) },
        [...top, ...next].map((item) => item.owned),
      );
    const other = (count: number) => grow(count, () => 1990).map(rename('Other'));
    // 4 对 1、5 对 2：旧规则都要列候选
    expect(
      resolvedId(
        run(
          grow(4, () => 2000),
          other(1),
        ),
      ),
    ).toBe('1');
    expect(
      resolvedId(
        run(
          grow(5, () => 2000),
          other(2),
        ),
      ),
    ).toBe('1');
    // 只有标题对上、年份与曲数都对不上（弱证据）的，一张可靠重合比它排前；双方都是弱证据时重合数多的胜出
    const weak = (count: number) =>
      grow(count, () => 2000).map((item) => ({
        ...item,
        owned: { ...item.owned, year: 1950, trackCount: 4 },
      }));
    expect(resolvedId(run(weak(6), other(1)))).toBe('2');
    expect(resolvedId(run(weak(6), weak(1).map(rename('Other'))))).toBe('1');
    // 完全并列时看 Apple 的搜索次序
    expect(
      resolvedId(
        run(
          grow(3, () => 2000),
          other(3),
        ),
      ),
    ).toBe('1');
    expect(
      resolvedId(
        run(
          grow(3, () => 2000),
          other(3),
          [hit(2, 'Same'), hit(1, 'Same')],
        ),
      ),
    ).toBe('2');
  });

  it('用户说过「不是这位」：不自动认定，只列名字一致的和有重合的', () => {
    const owned = [local('Nevermind', 1991, 13)];
    const result = decide('Nirvana', NIRVANA, NIRVANA_CATALOG, owned, false);
    expect(result.kind).toBe('ambiguous');
    expect(listedIds(result)[0]).toBe('112018');
    expect(listedIds(result)).toHaveLength(6);
    expect(decideAppleIdentity([], { allowAuto: false })).toEqual({ kind: 'none' });
  });

  it('候选行要的信息：专辑数、年份范围、前三张专辑名', () => {
    const catalog = {
      1: [album('A', 2001, 5), album('B', 1999, 5), album('C', null, 5), album('D', 2010, 5)],
    };
    const [scored] = scoreAppleCandidates('X', [hit(1, 'X')], new Map(Object.entries(catalog)), []);
    expect(scored).toMatchObject({
      albumCount: 4,
      years: [1999, 2010],
      samples: ['A', 'B', 'C'],
    });
  });
});

describe('不是这位', () => {
  it('被否定的那位排到最后，其余保持原次序', () => {
    const list = scoreAppleCandidates('X', [hit(1, 'X'), hit(2, 'X'), hit(3, 'X')], new Map(), []);
    expect(demoteAppleCandidate(list, '1').map((item) => item.id)).toEqual(['2', '3', '1']);
  });
});
