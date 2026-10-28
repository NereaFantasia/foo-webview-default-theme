import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import { useService } from '../../kit/useService.ts';
import { onlineListKey, onlineListsKey } from '../../playback/onlineLists.ts';
import { onlineCoverUrl } from '../../playback/onlineTracks.ts';
import type { MusicRef } from '../../server/musicObjects.ts';
import { ArtistAvatar } from '../detail/ArtistRow.tsx';

/** 渲染头像基准尺寸（单位 px），拉取图像时结合设备像素比计算实际尺寸 */
const AVATAR_SIZE = 28;

/**
 * 在线艺术家头像组件
 * 专辑元数据不包含艺人头像，仅在激活且进入视口时按需发起艺人详情拉取并复用缓存，就绪前展示占位
 */
export function OnlineArtistAvatar({
  artist,
  active,
}: {
  readonly artist: MusicRef | null;
  readonly active: boolean;
}) {
  const lists = useService(onlineListsKey);
  const states = useAtomValueRawSync(lists.lists);
  const element = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  const platform = artist?.platform;
  const id = artist?.id;
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new IntersectionObserver((entries) =>
      setSeen(entries.some((entry) => entry.isIntersecting)),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!active || !seen || !platform || !id) return;
    return lists.want({ kind: 'artist', ref: { platform, id } });
  }, [lists, active, seen, platform, id]);
  const owner =
    platform && id
      ? states.get(onlineListKey({ kind: 'artist', ref: { platform, id } }))?.owner
      : null;
  const avatar = owner && 'avatar' in owner ? owner.avatar : null;
  return (
    <ArtistAvatar
      ref={element}
      src={avatar ? onlineCoverUrl(avatar, AVATAR_SIZE * (globalThis.devicePixelRatio || 1)) : null}
    />
  );
}
