import { atom, type Atom } from 'jotai/vanilla';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import { onlineCoverUrl } from '../../playback/onlineTracks.ts';
import type { BiographyOnlinePhotoState } from '../biography/online/biographyOnlinePhoto.ts';
import { usePhotoShape } from '../artists/page/photoShape.ts';
import type { BiographyMotionState } from '../biography/online/biographyMotion.ts';

const NO_SOURCE = atom(null);
const NO_SEARCHING = atom(false);
const NO_SEEN: Atom<ReadonlySet<string>> = atom(new Set<string>());
const NO_COLOR = atom<string | null>(null);
const NO_MOTION = atom<BiographyMotionState>({ status: 'idle', url: null });
const NO_PHOTO = atom<BiographyOnlinePhotoState>({
  photo: null,
  loading: false,
  problem: null,
  bytes: 0,
});

/** 头像与头部图用到的简介状态；在线艺人的简介装配满足它 */
export interface OnlinePortraitSource {
  readonly onlinePhoto: { readonly state: Atom<BiographyOnlinePhotoState> };
  readonly hero: { readonly state: Atom<BiographyOnlinePhotoState> };
  /** 有值表示这位艺人的来源给了宽幅图，还在取 */
  readonly heroSource: Atom<unknown>;
  readonly heroColor: Atom<string | null>;
  readonly motion: { readonly state: Atom<BiographyMotionState> };
  /** 照片还在找：认定、取正文、取照片还有没做完的，做完后还可能有照片 */
  readonly searching: Atom<boolean>;
  /**
   * 本次运行中获取过宽幅图的艺人身份键集合：重新进页时在来源识别宽幅图前预先保留宽幅布局
   * 因页面首次渲染时尚未登记艺人，此处保存完整集合供页面按键查询
   */
  readonly heroSeen?: Atom<ReadonlySet<string>>;
}

/** 圆形头像的直径，CSS 像素，按它向平台要图 */
const AVATAR_PIXELS = 240;
/** 「照片」键占位的最长时间，毫秒：超过就不再转圈，照片晚到了键再亮起来 */
const SEARCH_MAX_MS = 10_000;
/** 取到过宽幅图的艺人重新进页时，来源认出宽幅图之前头部按宽幅预留的最长时间，毫秒：这次没有宽幅图了就回到头像 */
const KNOWN_HERO_MAX_MS = 2_000;

/**
 * 在线艺人的头像与头部图：先展示平台头像（方形裁剪为圆形，不测量宽高比），Apple 照片测量宽高比完成且可绘制后再行替换
 * 宽幅图完成测量后铺满头部；若缺少头像地址且正在检索 Apple 照片，头像位置展示转圈加载
 * `searching` 用于「照片」按钮占位，自进入页面起直至认定、正文与照片加载完成，最长持续 `SEARCH_MAX_MS`
 * `key` 为艺人身份键（`onlineArtistKey`），更换艺人时重置计时
 */
export function useOnlineArtistPortrait(
  bio: OnlinePortraitSource | null,
  avatar: string | null,
  key = '',
) {
  const searchingNow = useAtomValueRawSync(bio?.searching ?? NO_SEARCHING);
  const [giveUp, setGiveUp] = useState<string | null>(null);
  const [released, setReleased] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setGiveUp(key), SEARCH_MAX_MS);
    const hold = setTimeout(() => setReleased(key), KNOWN_HERO_MAX_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(hold);
    };
  }, [key]);
  const holding = useAtomValueRawSync(bio?.heroSeen ?? NO_SEEN).has(key) && released !== key;
  const online = useAtomValueRawSync(bio?.onlinePhoto.state ?? NO_PHOTO);
  const heroState = useAtomValueRawSync(bio?.hero.state ?? NO_PHOTO);
  const heroExpected = useAtomValueRawSync(bio?.heroSource ?? NO_SOURCE) !== null;
  const heroColor = useAtomValueRawSync(bio?.heroColor ?? NO_COLOR) ?? undefined;
  const motion = useAtomValueRawSync(bio?.motion.state ?? NO_MOTION);
  const heroUrl = heroState.photo?.url;
  const heroShape = usePhotoShape(heroUrl);
  const hero = heroUrl && heroShape !== null && heroShape !== 'failed' ? heroUrl : undefined;
  const photoShape = usePhotoShape(online.photo?.url);
  const apple =
    online.photo && (photoShape === 'round' || photoShape === 'rect')
      ? { url: online.photo.url, shape: photoShape }
      : undefined;
  const platform = avatar
    ? {
        url: onlineCoverUrl(avatar, AVATAR_PIXELS * (globalThis.devicePixelRatio || 1)),
        shape: 'round' as const,
      }
    : undefined;
  const shown = apple ?? platform;
  // 存在宽幅图且正在加载时，头部先以宽幅占位并铺底色，静帧就绪后淡入，加载失败则回退至头像展示；
  // 曾加载过宽幅图的艺人重新进页时同样等待，避免先展示平台头像再淡出过渡
  const heroPending =
    (heroExpected || holding) && !hero && heroState.problem === null && heroShape !== 'failed';
  const wide = !!hero || heroPending;
  return {
    shown,
    hero,
    wide,
    heroColor: wide ? heroColor : undefined,
    video: wide && motion.status === 'ready' ? (motion.url ?? undefined) : undefined,
    /** 查看器里的照片：Apple 的一张 */
    pictures: online.photo ? [online.photo] : [],
    loading: !shown && (online.loading || (!!online.photo && photoShape === null)),
    searching: searchingNow && giveUp !== key,
  };
}
