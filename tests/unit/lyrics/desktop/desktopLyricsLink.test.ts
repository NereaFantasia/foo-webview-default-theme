import { describe, expect, it } from 'vitest';
import {
  DESKTOP_LYRICS_LABELS,
  desktopLyricsMessage,
  desktopLyricsViewJson,
  parseDesktopLyricsLines,
  parseDesktopLyricsMessage,
  parseDesktopLyricsView,
  type DesktopLyricsView,
} from '../../../../src/lyrics/desktop/desktopLyricsLink.ts';
import { DEFAULT_LYRICS_DISPLAY } from '../../../../src/lyrics/lyricsDisplay.ts';

const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const VIEW: DesktopLyricsView = {
  labels: Object.fromEntries(DESKTOP_LYRICS_LABELS.map((key) => [key, key])) as Record<
    (typeof DESKTOP_LYRICS_LABELS)[number],
    string
  >,
  locked: false,
  align: 'right',
  motionPreset: 'amll',
  mode: 'multi',
  multilineSize: null,
  fontSize: 34,
  translationFontSize: 18,
  motionCustom: { blur: false, scale: true, hidePassedLines: true, alignPosition: 0.35 },
  font: 'Georgia',
  fontWeight: 450,
  uiFont: 'Inter',
  cjkFont: 'DengXian',
  sung: '#78d7ce',
  unsung: null,
  tint: null,
  plate: true,
  plateOpacity: 0.7,
  glow: null,
  showTranslation: true,
  showRomanization: false,
  offset: -0.3,
  title: 'Quiet Light',
  artist: 'Sample Artist',
  hidden: false,
  process: {
    optimize: { ...DEFAULT_LYRICS_DISPLAY.optimize, normalizeSpaces: false },
    maskMode: 'partial-mask',
    maskChar: '#',
  },
};

const LINE = {
  words: [{ word: 'Every ', startTime: 0, endTime: 400, romanWord: '', obscene: false }],
  translatedLyric: '每扇窗',
  romanLyric: '',
  startTime: 0,
  endTime: 3000,
  isBG: false,
  isDuet: true,
};

describe('parseDesktopLyricsView', () => {
  it('经 JSON 往返后原样读回', () => {
    expect(parseDesktopLyricsView(wire(desktopLyricsViewJson(VIEW)))).toEqual(VIEW);
  });

  it('译文字号与自定义动效往返；旧版主窗口没有这两项时取正文的 0.6 倍与 AMLL 档的四项', () => {
    const json = desktopLyricsViewJson(VIEW);
    expect(parseDesktopLyricsView(wire(json))).toMatchObject({
      translationFontSize: 18,
      motionCustom: { blur: false, scale: true, hidePassedLines: true, alignPosition: 0.35 },
    });
    expect(
      parseDesktopLyricsView({ ...json, translationFontSize: undefined, motionCustom: undefined }),
    ).toMatchObject({
      translationFontSize: 20,
      motionCustom: { blur: true, scale: true, hidePassedLines: false, alignPosition: 0.5 },
    });
    expect(
      parseDesktopLyricsView({
        ...json,
        translationFontSize: 5,
        motionCustom: { alignPosition: 9 },
      }),
    ).toMatchObject({
      translationFontSize: 10,
      motionCustom: { blur: true, scale: true, hidePassedLines: false, alignPosition: 1 },
    });
  });

  it('字体与字重往返；旧版主窗口没有这几项、或取值不合法时回到缺省，不影响其余显示', () => {
    const json = desktopLyricsViewJson(VIEW);
    const plain = { ...VIEW, font: '', fontWeight: null, uiFont: '', cjkFont: '' };
    expect(
      parseDesktopLyricsView({
        ...json,
        font: undefined,
        fontWeight: undefined,
        uiFont: undefined,
        cjkFont: undefined,
      }),
    ).toEqual(plain);
    expect(
      parseDesktopLyricsView({ ...json, font: 'bad\nname', fontWeight: 5000, uiFont: 7 }),
    ).toEqual({ ...plain, cjkFont: 'DengXian' });
  });

  it('内容整理与屏蔽缺项或不合法时回到缺省，不影响其余显示', () => {
    const json = desktopLyricsViewJson(VIEW);
    const defaults = {
      optimize: DEFAULT_LYRICS_DISPLAY.optimize,
      maskMode: DEFAULT_LYRICS_DISPLAY.maskMode,
      maskChar: DEFAULT_LYRICS_DISPLAY.maskChar,
    };
    expect(parseDesktopLyricsView({ ...json, process: undefined })).toEqual({
      ...VIEW,
      process: defaults,
    });
    expect(
      parseDesktopLyricsView({ ...json, process: { maskMode: 'bad', maskChar: 'ab' } })?.process,
    ).toEqual(defaults);
  });

  it('缺文案、对齐不认识或开关不是布尔时整份不收', () => {
    const json = desktopLyricsViewJson(VIEW);
    expect(parseDesktopLyricsView({ ...json, labels: { ...json.labels, close: 1 } })).toBeNull();
    expect(parseDesktopLyricsView({ ...json, align: 'justify' })).toBeNull();
    expect(parseDesktopLyricsView({ ...json, hidden: 'no' })).toBeNull();
  });

  it('颜色不是 #rrggbb 时当没给', () => {
    expect(
      parseDesktopLyricsView({ ...desktopLyricsViewJson(VIEW), sung: 'red' })?.sung,
    ).toBeNull();
  });
});

describe('parseDesktopLyricsLines', () => {
  it('收带时间轴的歌词与表示没有歌词的 null', () => {
    expect(parseDesktopLyricsLines({ id: 'a:1', lines: [LINE] })).toEqual({
      id: 'a:1',
      lines: [LINE],
    });
    expect(parseDesktopLyricsLines({ id: 'a:2', lines: null })).toEqual({ id: 'a:2', lines: null });
  });

  it('有一行不合格就整份不收', () => {
    expect(
      parseDesktopLyricsLines({ id: 'a:1', lines: [LINE, { ...LINE, startTime: '0' }] }),
    ).toBeNull();
    expect(parseDesktopLyricsLines({ id: '', lines: [] })).toBeNull();
  });
});

describe('desktopLyricsMessage', () => {
  it('命令经 JSON 往返后读回', () => {
    for (const command of [
      { type: 'offset', delta: 0.1 },
      { type: 'seek', id: 'track:lyrics', seconds: 12.3 },
      { type: 'mode', mode: 'single', bounds: { x: 10, y: 20, width: 800, height: 500 } },
      { type: 'lock', locked: true },
      { type: 'bounds', bounds: { x: -10, y: 20, width: 640, height: 472 } },
      { type: 'close' },
      { type: 'recenter' },
    ] as const)
      expect(parseDesktopLyricsMessage(wire(desktopLyricsMessage(command)))).toEqual(command);
  });

  it('别的频道、未知命令与离谱的偏移不认', () => {
    for (const seconds of [-1, Infinity, NaN])
      expect(
        parseDesktopLyricsMessage(
          desktopLyricsMessage({ type: 'seek', id: 'track:lyrics', seconds }),
        ),
      ).toBeNull();
    expect(parseDesktopLyricsMessage({ channel: 'other', command: { type: 'close' } })).toBeNull();
    expect(
      parseDesktopLyricsMessage(desktopLyricsMessage({ type: 'offset', delta: 60 })),
    ).toBeNull();
    expect(
      parseDesktopLyricsMessage({ channel: 'defaultTheme.desktopLyrics', command: { type: 'x' } }),
    ).toBeNull();
  });
});
