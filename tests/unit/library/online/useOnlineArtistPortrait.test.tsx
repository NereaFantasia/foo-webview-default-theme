import { atom } from 'jotai/vanilla';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BiographyPhoto } from '../../../../src/library/biography/biographyPhotos.ts';
import type { BiographyMotionState } from '../../../../src/library/biography/online/biographyMotion.ts';
import type { BiographyOnlinePhotoState } from '../../../../src/library/biography/online/biographyOnlinePhoto.ts';
import {
  useOnlineArtistPortrait,
  type OnlinePortraitSource,
} from '../../../../src/library/online/useOnlineArtistPortrait.ts';
import { onlineCoverUrl } from '../../../../src/playback/onlineTracks.ts';

const IDLE: BiographyOnlinePhotoState = { photo: null, loading: false, problem: null, bytes: 0 };
const AVATAR = 'https://p1.music.126.net/avatar/artist.jpg';
const KEY = 'online:wy:100';
const APPLE: BiographyPhoto = {
  key: 'apple:1',
  album: '',
  url: 'https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg',
};

interface Parts {
  readonly online?: Partial<BiographyOnlinePhotoState>;
  readonly hero?: Partial<BiographyOnlinePhotoState>;
  readonly heroExpected?: boolean;
  readonly heroKnown?: boolean;
  readonly color?: string | null;
  readonly motion?: BiographyMotionState;
  readonly searching?: boolean;
}

function source(parts: Parts): OnlinePortraitSource {
  return {
    searching: atom(parts.searching ?? false),
    onlinePhoto: { state: atom({ ...IDLE, ...parts.online }) },
    hero: { state: atom({ ...IDLE, ...parts.hero }) },
    heroSource: atom(parts.heroExpected ? { pending: true } : null),
    heroSeen: atom<ReadonlySet<string>>(new Set(parts.heroKnown ? [KEY] : [])),
    heroColor: atom(parts.color ?? null),
    motion: { state: atom(parts.motion ?? { status: 'idle', url: null }) },
  };
}

/** 服务端渲染一次，取 hook 的返回值；照片的宽高比在浏览器里才量，这里都是还没量完 */
function portrait(bio: OnlinePortraitSource | null, avatar: string | null, key = KEY) {
  const seen: ReturnType<typeof useOnlineArtistPortrait>[] = [];
  function Probe() {
    seen.push(useOnlineArtistPortrait(bio, avatar, key));
    return null;
  }
  renderToStaticMarkup(<Probe />);
  const [first] = seen;
  if (!first) throw new Error('hook 没有返回');
  return first;
}

describe('在线艺人的头像与头部图', () => {
  it('进页先画平台头像，圆形；Apple 的照片还没量完宽高比就不换，查看器里先有这一张', () => {
    const bare = portrait(null, AVATAR);
    expect(bare.shown).toEqual({ url: onlineCoverUrl(AVATAR, 240), shape: 'round' });
    expect(bare.wide).toBe(false);
    expect(bare.pictures).toEqual([]);
    const measuring = portrait(source({ online: { photo: APPLE } }), AVATAR);
    expect(measuring.shown?.url).toBe(onlineCoverUrl(AVATAR, 240));
    expect(measuring.pictures).toEqual([APPLE]);
    expect(measuring.loading).toBe(false);
  });

  it('没有头像地址时，Apple 的照片还在找就转圈；找完没有就不转', () => {
    expect(portrait(source({ online: { loading: true } }), null).loading).toBe(true);
    expect(portrait(source({ online: { loading: false } }), null).loading).toBe(false);
    // 有头像时一直是头像，不转圈
    expect(portrait(source({ online: { loading: true } }), AVATAR).loading).toBe(false);
  });

  it('来源给了宽幅图、还在取：头部先按宽幅铺底色；取失败就回到头像，底色也不再给', () => {
    const pending = portrait(source({ heroExpected: true, color: '1a1a6e' }), AVATAR);
    expect(pending.wide).toBe(true);
    expect(pending.hero).toBeUndefined();
    expect(pending.heroColor).toBe('1a1a6e');
    const failed = portrait(
      source({ heroExpected: true, color: '1a1a6e', hero: { problem: 'network' } }),
      AVATAR,
    );
    expect(failed.wide).toBe(false);
    expect(failed.heroColor).toBeUndefined();
    expect(failed.shown?.shape).toBe('round');
  });

  it('以前取到过宽幅图的艺人重新进页：来源还没认出宽幅图也先按宽幅预留，不先露平台头像；取失败回到头像', () => {
    const held = portrait(source({ heroKnown: true }), AVATAR);
    expect(held.wide).toBe(true);
    expect(held.hero).toBeUndefined();
    expect(portrait(source({}), AVATAR).wide).toBe(false);
    // 名单里是另一位时不预留
    expect(portrait(source({ heroKnown: true }), AVATAR, 'online:wy:200').wide).toBe(false);
    const failed = portrait(source({ heroKnown: true, hero: { problem: 'network' } }), AVATAR);
    expect(failed.wide).toBe(false);
  });

  it('「照片」键的占位跟着简介装配的 searching 走，与头像位的转圈各管各的；没有简介装配时不占位', () => {
    expect(portrait(source({ searching: true }), AVATAR).searching).toBe(true);
    // 有头像时头像位不转圈，键的占位照样转
    expect(portrait(source({ searching: true }), AVATAR).loading).toBe(false);
    expect(portrait(source({ searching: false, online: { loading: true } }), null).searching).toBe(
      false,
    );
    expect(portrait(null, AVATAR).searching).toBe(false);
  });

  it('视频地址只在头部按宽幅画、并且视频已读出时给', () => {
    const motion: BiographyMotionState = { status: 'ready', url: 'https://x/clip.mp4' };
    expect(portrait(source({ heroExpected: true, motion }), AVATAR).video).toBe(
      'https://x/clip.mp4',
    );
    expect(portrait(source({ motion }), AVATAR).video).toBeUndefined();
    expect(
      portrait(source({ heroExpected: true, motion: { status: 'idle', url: null } }), AVATAR).video,
    ).toBeUndefined();
  });
});
