import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { ContextMenuPoint } from '../../kit/context-menu/contextMenuGeometry.ts';
import { trackKeyOf } from '../playbackContract.ts';
import { playbackConnectedAtom } from '../playerAtoms.ts';
import { playingTrackKeyAtom } from '../playingTrack.ts';
import { nowPlayingMenuAtom, nowPlayingMenuKey } from './nowPlayingMenu.ts';
import { useService } from '../../kit/useService.ts';
import { ratingsKey } from '../../track/trackRatings.ts';

/** 当前曲目菜单从哪里触发：由放菜单的界面给，菜单自己不认识界面里的键 */
export interface NowPlayingMenuScope {
  /** 根不是按钮时，菜单开着期间焦点停靠的件 */
  anchor(root: HTMLElement): HTMLElement | null;
  /** 右键、菜单键落在 `target`（已确认在根里）上要不要开菜单 */
  accepts(target: Element): boolean;
}

export function useNowPlayingMenu(track: Track | null, scope: NowPlayingMenuScope) {
  const menu = useService(nowPlayingMenuKey);
  const ratings = useService(ratingsKey);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const key = useAtomValueRawSync(playingTrackKeyAtom);
  const state = useAtomValueRawSync(nowPlayingMenuAtom);
  const [at, setAt] = useState<ContextMenuPoint | null>(null);
  // 戳跟曲目数据走，重新开菜单不能把较新的评分盖回旧标签值
  const [stamped, setStamped] = useState(() => ({ track, stamp: ratings.stamp() }));
  if (stamped.track !== track) setStamped({ track, stamp: ratings.stamp() });
  const enabled = connected && !!track && key === trackKeyOf(track);
  useEffect(() => () => menu.close(), [menu]);
  const close = () => {
    menu.close();
    setAt(null);
  };
  const open = (point: ContextMenuPoint, root: HTMLElement) => {
    if (!enabled || !track) return;
    const trigger = root.matches('button') ? root : scope.anchor(root);
    trigger?.focus({ preventScroll: true });
    void menu.prepare(track, stamped.stamp);
    setAt(point);
  };
  const accepts = (target: EventTarget, root: HTMLElement) =>
    target instanceof Element && root.contains(target) && scope.accepts(target);
  return {
    at: state.track ? at : null,
    close,
    more: {
      disabled: !enabled,
      'aria-haspopup': 'menu' as const,
      'aria-expanded': at !== null && state.track !== null,
      onClick(event: MouseEvent<HTMLButtonElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        open({ x: rect.left, y: rect.bottom }, event.currentTarget);
      },
    },
    trigger: {
      onContextMenu(event: MouseEvent<HTMLElement>) {
        if (!accepts(event.target, event.currentTarget)) return;
        event.preventDefault();
        open({ x: event.clientX, y: event.clientY }, event.currentTarget);
      },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
        if (!accepts(event.target, event.currentTarget)) return;
        event.preventDefault();
        event.stopPropagation();
        const rect =
          event.target instanceof HTMLElement
            ? event.target.getBoundingClientRect()
            : event.currentTarget.getBoundingClientRect();
        open(
          { x: rect.left, y: rect.bottom },
          event.target instanceof HTMLElement && event.target.matches('button')
            ? event.target
            : event.currentTarget,
        );
      },
    },
  };
}
