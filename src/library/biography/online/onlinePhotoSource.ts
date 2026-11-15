import type { AppleIdentityRecord, AppleManualIdentity } from '../apple/appleIdentityRecord.ts';
import { appleArtistIdFromLink } from '../apple/appleIdentityResolver.ts';
import type { BiographyCache } from '../biographyCache.ts';
import {
  biographyArtist,
  type ApplePhoto,
  type BiographyInput,
  type BiographyPhoto,
  type BiographyState,
} from '../biographyModel.ts';
import { lastfmPhotoOf } from './lastfmPhoto.ts';

/**
 * 提取简介中的主图，供右侧卡与艺人页共用
 *
 * 状态可能滞留上一位艺人数据，需校验归属一致性：
 * - Last.fm 依据规范艺人名核对
 * - Apple 数据源因页面显示名可能存在简繁差异，统一按艺人 ID 核对；若附加资料或提前发布的主图缺少独立 ID，则从页面 URL 中解析提取
 */
export function onlinePhotoOf(
  input: BiographyInput | null,
  state: Partial<Pick<BiographyState, 'document' | 'details' | 'photo'>>,
): BiographyPhoto | null {
  if (!input?.sourceId) return null;
  const { document, details, photo: early } = state;
  if (input.source === 'apple') {
    const fromDocument =
      document?.source === 'apple' && document.sourceId === input.sourceId
        ? document.photo
        : undefined;
    const fromDetails =
      details?.source === 'apple' && appleArtistIdFromLink(details.url) === input.sourceId
        ? details.photo
        : undefined;
    const fromPage =
      early?.source === 'apple' && appleArtistIdFromLink(early.pageUrl) === input.sourceId
        ? early
        : undefined;
    const photo = fromDocument ?? fromDetails ?? fromPage;
    return photo?.source === 'apple' ? photo : null;
  }
  const name = input.sourceArtist;
  return lastfmPhotoOf(
    (document?.artist === name ? document.photo : null) ??
      (details?.artist === name ? details.photo : null),
  );
}

/**
 * 从本地缓存中查询指定艺人的 Apple 艺术照（不发起网络请求）：
 * 优先匹配手动指定身份，若标记为不关联则直接返回 null；未手动指定时采纳身份缓存的自动认定结果；合辑条目不拉取
 */
export function cachedApplePhoto(
  artist: string,
  manual: readonly AppleManualIdentity[],
  identities: { get(artist: string): AppleIdentityRecord | undefined },
  texts: Pick<BiographyCache, 'get'>,
): ApplePhoto | null {
  const name = biographyArtist(artist);
  if (!name) return null;
  const chosen = manual.find((item) => item.artist === name);
  const found = chosen ? null : identities.get(name);
  const id = chosen
    ? chosen.declined
      ? null
      : chosen.sourceId
    : found?.status === 'resolved'
      ? found.sourceId
      : null;
  if (!id) return null;
  // 多语言缓存中共享相同图像，按中英文顺序命中即返回
  for (const language of ['zh', 'en'] as const) {
    const entry = texts.get(id, language);
    const photo = entry?.document?.photo ?? entry?.details?.photo;
    if (photo?.source === 'apple') return photo;
  }
  return null;
}

/**
 * 判断在线照片是否就绪可拉取：
 * 当正文与附加资料加载完成，或回退英文期间已提前发布主图时视为就绪
 */
export function onlinePhotoReady(
  state: Pick<BiographyState, 'status' | 'refreshing' | 'detailsLoading' | 'photo'>,
): boolean {
  return (
    (state.status !== 'loading' && !state.refreshing && !state.detailsLoading) || !!state.photo
  );
}
