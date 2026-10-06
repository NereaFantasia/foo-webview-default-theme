import { describe, expect, it } from 'vitest';
import {
  compareArtist,
  compareDuration,
  compareName,
  compareTrack,
  DEFAULT_MINIMUM,
  levelRank,
  rankCandidates,
  type MatchLevel,
} from '../../../../src/lyrics/online/lyricsMatch.ts';
import type { LyricsCandidate, LyricsQuery } from '../../../../src/lyrics/online/lyricsSource.ts';

const query = (
  title: string,
  artists: string[],
  album: string,
  durationMs: number,
): LyricsQuery => ({ title, artists, album, albumArtists: [], durationMs });

const candidate = (
  title: string,
  artists: string[],
  album: string,
  durationMs: number,
  ref = '',
): LyricsCandidate => ({ source: 'netease', ref, title, artists, album, durationMs });

describe('曲名比较', () => {
  it('规整后相同为完全一致：大小写、全角括号、方括号、多余空格与繁简', () => {
    expect(compareName('Song  [Live]', 'song（live）')).toBe('perfect');
    expect(compareName('後來', '后来')).toBe('perfect');
  });

  it('「曲名 - 注记」与「曲名 (注记)」、只多一个 deluxe / feat 之类的注记为很高', () => {
    expect(compareName('Song - Remastered 2011', 'Song (Remastered 2011)')).toBe('veryHigh');
    expect(compareName('Song (feat. B)', 'Song')).toBe('veryHigh');
    expect(compareName('Song (Deluxe)', 'Song')).toBe('veryHigh');
  });

  it('两边各带 feat 但嘉宾不同为高；只多一个别的括号注记为中', () => {
    expect(compareName('Song (feat. B)', 'Song (feat. C)')).toBe('high');
    expect(compareName('Song (Off Vocal)', 'Song')).toBe('medium');
  });

  it('等长时逐位比对兜异体字：2、3 字过半相同即为高', () => {
    expect(compareName('晴天', '雨天')).toBe('high');
    expect(compareName('晴天', '雨夜')).toBe('none');
  });

  it('其余按最长公共子序列的占比分档；任一边为空不计', () => {
    expect(compareName('Bohemian Rhapsody', 'Bohemian Rhapsodi')).toBe('high');
    expect(compareName('Idol', 'アイドル')).toBe('none');
    expect(compareName('', 'Song')).toBeNull();
  });
});

describe('艺人比较', () => {
  it('完全相同为完全一致，繁简与大小写不计', () => {
    expect(compareArtist(['周杰倫'], ['周杰伦'])).toBe('perfect');
    expect(compareArtist(['YOASOBI'], ['yoasobi'])).toBe('perfect');
  });

  it('本地两位、候选少一位为很高；本地一位、候选两位含它为高', () => {
    expect(compareArtist(['YOASOBI', 'Ayase'], ['YOASOBI'])).toBe('veryHigh');
    expect(compareArtist(['YOASOBI'], ['YOASOBI', 'Ayase'])).toBe('high');
  });

  it('本地写成一整串、候选拆开时，按第一位是否打头判高', () => {
    expect(compareArtist(['Alpha & Beta'], ['Alpha', 'Beta'])).toBe('high');
  });

  it('不同的人、译名都对不上；任一边为空不计', () => {
    expect(compareArtist(['周杰伦'], ['某翻唱'])).toBe('none');
    expect(compareArtist(['Jay Chou'], ['周杰伦'])).toBe('none');
    expect(compareArtist([], ['A'])).toBeNull();
  });
});

describe('时长比较', () => {
  it('按 0、300、700、1500、3500 毫秒分档；任一边未知不计', () => {
    expect(compareDuration(200_000, 200_000)).toBe('perfect');
    expect(compareDuration(200_000, 200_299)).toBe('veryHigh');
    expect(compareDuration(200_000, 200_699)).toBe('high');
    expect(compareDuration(200_000, 201_499)).toBe('medium');
    expect(compareDuration(200_000, 203_499)).toBe('low');
    expect(compareDuration(200_000, 203_500)).toBe('none');
    expect(compareDuration(0, 200_000)).toBeNull();
  });
});

describe('整首比较与边界场景', () => {
  const original = query('晴天', ['周杰伦'], '叶惠美', 269_000);

  const cases: [string, LyricsQuery, LyricsCandidate, MatchLevel][] = [
    ['原版', original, candidate('晴天', ['周杰伦'], '叶惠美', 269_200), 'perfect'],
    [
      '精选集收录：专辑不同、时长相同',
      original,
      candidate('晴天', ['周杰伦'], '精选', 269_100),
      'perfect',
    ],
    ['候选不带专辑：专辑不计', original, candidate('晴天', ['周杰伦'], '', 269_100), 'perfect'],
    [
      '繁体标签对简体候选',
      query('晴天', ['周杰倫'], '葉惠美', 269_000),
      candidate('晴天', ['周杰伦'], '叶惠美', 269_000),
      'perfect',
    ],
    [
      '现场版：同名、专辑不同、时长差 20 秒',
      original,
      candidate('晴天', ['周杰伦'], '演唱会 (Live)', 249_000),
      'medium',
    ],
    [
      '现场版：时长只差 1 秒时挡不住',
      original,
      candidate('晴天', ['周杰伦'], '演唱会 (Live)', 270_000),
      'veryHigh',
    ],
    [
      '翻唱：同名不同艺人、时长差 2 秒',
      original,
      candidate('晴天', ['某翻唱'], '', 271_000),
      'low',
    ],
    [
      '翻唱：同名不同艺人、时长恰好相同',
      original,
      candidate('晴天', ['某翻唱'], '', 269_000),
      'prettyHigh',
    ],
    [
      '翻唱：本地没有时长',
      query('晴天', ['周杰伦'], '叶惠美', 0),
      candidate('晴天', ['某翻唱'], '', 269_000),
      'medium',
    ],
    [
      '同名同艺人的另一首：时长差 40 秒',
      query('Intro', ['某乐队'], '专辑A', 90_000),
      candidate('Intro', ['某乐队'], '专辑B', 130_000),
      'prettyHigh',
    ],
    [
      '同艺人、两字曲名差一字、时长差 20 秒',
      original,
      candidate('雨天', ['周杰伦'], '叶惠美', 249_000),
      'prettyHigh',
    ],
    [
      '同艺人、两字曲名差一字、时长只差 0.5 秒时挡不住',
      original,
      candidate('雨天', ['周杰伦'], '', 269_500),
      'veryHigh',
    ],
    [
      '艺人是译名',
      query('晴天', ['Jay Chou'], 'Ye Hui Mei', 269_000),
      candidate('晴天', ['周杰伦'], '叶惠美', 269_000),
      'medium',
    ],
    [
      '曲名是译名',
      query('アイドル', ['YOASOBI'], 'アイドル', 213_000),
      candidate('Idol', ['YOASOBI'], 'Idol', 213_000),
      'medium',
    ],
    [
      'TV 版：时长差 150 秒',
      query('Song (TV Size)', ['Alpha'], 'X', 90_000),
      candidate('Song', ['Alpha'], 'X', 240_000),
      'medium',
    ],
  ];

  it.each(cases)('%s', (_name, wanted, found, level) => {
    expect(compareTrack(wanted, found).level).toBe(level);
  });

  it('缺省门槛挡掉翻唱、长度不同的现场版与另一首，放过精选集与繁简', () => {
    const accepted = cases
      .filter(([, wanted, found]) => {
        const { level } = compareTrack(wanted, found);
        return levelRank(level) <= levelRank(DEFAULT_MINIMUM);
      })
      .map(([name]) => name);
    expect(accepted).toEqual([
      '原版',
      '精选集收录：专辑不同、时长相同',
      '候选不带专辑：专辑不计',
      '繁体标签对简体候选',
      '现场版：时长只差 1 秒时挡不住',
      '同艺人、两字曲名差一字、时长只差 0.5 秒时挡不住',
    ]);
  });

  it('本地艺人栏按「, 」再拆一次', () => {
    const wanted = query('Song', ['Alpha, Beta'], 'X', 200_000);
    expect(compareTrack(wanted, candidate('Song', ['Alpha', 'Beta'], 'X', 200_000)).level).toBe(
      'perfect',
    );
  });
});

describe('候选排序', () => {
  it('只留达到门槛的，按档从高到低；同档保留来源的顺序', () => {
    const wanted = query('晴天', ['周杰伦'], '叶惠美', 269_000);
    const ranked = rankCandidates(
      wanted,
      [
        candidate('晴天', ['某翻唱'], '', 269_000, 'cover'),
        candidate('晴天', ['周杰伦'], '精选', 269_100, 'compilation'),
        candidate('晴天', ['周杰伦'], '叶惠美', 269_000, 'first'),
        candidate('晴天', ['周杰伦'], '叶惠美', 269_000, 'second'),
      ],
      'high',
    );
    expect(ranked.map((item) => item.candidate.ref)).toEqual(['compilation', 'first', 'second']);
  });
});
