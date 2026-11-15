import { useAtomValueRawSync } from 'jotai/react';
import { useArtists } from '../artistsContext.ts';
import { usePhotoShape } from './photoShape.ts';

/** 宽幅图拉取失败或被拒绝时的标记，回退至普通艺术照 */
const HERO_FAILED = 'failed';

/**
 * 艺人照片与头像状态解析：
 * 优先选取用户指定的头像，未指定时默认使用首张照片；合辑不展示照片；头部头像展示与页面取色均依赖此结果
 *
 * - `shown`：完成宽高比测量且已就绪的头像；测量中或失败时为空，调用方据此暂缓渲染以防圆形与横幅切换跳变
 * - `searching`：照片检索中（包含本地扫描未完，或网络认定、简介与图像拉取未完）
 * - `measuring`：已获取头像数据但仍在测量宽高比
 * - `hero`：头部铺满宽幅图（特定数据源提供），测量完成且可渲染时给出；存在宽幅图时，其就绪前暂缓渲染普通头像，拉取失败则回退至普通艺术照
 * - `wide`：头部是否按宽幅模式渲染（已就绪或正在拉取中）；拉取中时先使用 `heroColor` 底色撑开高度并在静帧到达后淡入
 * - `video`：动态艺术照 mp4 地址，在静帧加载完成后开始拉取
 */
export function useArtistPortrait() {
  const services = useArtists();
  const name = useAtomValueRawSync(services.places.selected);
  const compilation = useAtomValueRawSync(services.compilation);
  const photos = useAtomValueRawSync(services.biography.photos.state);
  const heroExpected = useAtomValueRawSync(services.biography.heroSource) !== null;
  const heroState = useAtomValueRawSync(services.biography.hero.state);
  const heroColor = useAtomValueRawSync(services.biography.heroColor) ?? undefined;
  const sourceSearching = useAtomValueRawSync(services.biography.searching);
  const motion = useAtomValueRawSync(services.biography.motion.state);
  const prefs = useAtomValueRawSync(services.prefs.state);
  const pictures = !compilation && photos.artist === name ? photos.photos : [];
  const chosen = prefs.portraits[name ?? ''];
  const portrait = pictures.find((item) => item.key === chosen) ?? pictures[0];
  const heroUrl = !compilation ? heroState.photo?.url : undefined;
  const heroShape = usePhotoShape(heroUrl);
  const hero = heroUrl && heroShape !== null && heroShape !== HERO_FAILED ? heroUrl : undefined;
  const heroPending =
    !compilation &&
    heroExpected &&
    !hero &&
    heroState.problem === null &&
    heroShape !== HERO_FAILED;
  const shape = usePhotoShape(portrait?.url);
  const shown =
    portrait && !heroPending && (shape === 'round' || shape === 'rect')
      ? { photo: portrait, shape }
      : undefined;
  const searching =
    !compilation &&
    (photos.artist !== name ||
      photos.loading ||
      photos.onlineLoading === true ||
      sourceSearching ||
      heroPending);
  const wide = !compilation && (!!hero || heroPending);
  return {
    wide,
    heroColor: wide ? heroColor : undefined,
    video: wide && motion.status === 'ready' ? (motion.url ?? undefined) : undefined,
    pictures,
    portrait,
    chosen,
    shown,
    hero,
    searching,
    measuring: !!portrait && shape === null,
  };
}
