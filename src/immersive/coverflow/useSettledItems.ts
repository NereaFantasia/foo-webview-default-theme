import { useEffect, useState } from 'react';

/** 重读「接下来」与之前的曲目超过这个时长仍未读好，就不再沿用上一份，毫秒 */
const SETTLE_LIMIT_MS = 600;

/**
 * 换曲后，「接下来」与之前的曲目要重读一次。这几十毫秒里，条目表里正在播放的已经是新曲目，两边还是旧的。
 * 若直接排列，刚播完的那张卡会闪成新曲目，新曲目同时出现在两处，读好后又变回来。
 * `settling` 为真期间沿用上一份，读好后一次换上，卡的键不变，引擎才能认出是同一张卡。
 * 读取一直不成功时也不能无限期沿用，超时后放行
 */
export function useSettledItems<T>(items: T, settling: boolean): T {
  const [settled, setSettled] = useState(items);
  const [expired, setExpired] = useState(false);
  const holding = settling && !expired;
  if (!holding && settled !== items) setSettled(items);
  useEffect(() => {
    if (!settling) {
      setExpired(false);
      return undefined;
    }
    const timer = setTimeout(() => setExpired(true), SETTLE_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [settling]);
  return holding ? settled : items;
}
