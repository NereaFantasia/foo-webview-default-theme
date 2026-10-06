import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { TrackTableHandle } from '../table/TrackTable.tsx';
import { createPlaylistTypeSearch, type PlaylistTypeSearch } from './playlistTypeSearch.ts';
import type { PlaylistPageModel } from './usePlaylistPage.ts';
import { useService } from '../kit/useService.ts';
import { playlistPageKey } from './playlistPageServices.ts';

/** 落到一行上的要求：选不选中它，被过滤挡住时清不清过滤。 */
interface RevealRequest {
  readonly row: number;
  readonly select: boolean;
  readonly clearFilter: boolean;
}

/** 为了落到一行上最多改几次条目流（清过滤、再展开它所在的组），多了就作罢。 */
const MAX_STEPS = 3;

export interface PlaylistReveal {
  /**
   * 焦点落到这一行并滚到视口中间。看得见就立刻落；在折起的组里先展开，被过滤挡住且 `clearFilter` 时先清
   * 过滤，等条目流换过再落。落不到答假。
   */
  revealRow(row: number, select: boolean, clearFilter: boolean): boolean;
  /** 这张列表的打字即跳；挂上之前为 undefined。 */
  readonly typeSearch: PlaylistTypeSearch | undefined;
}

/**
 * 播放列表页从外面来的定位：打字即跳找到的行（落焦点并只选它），定位正在播放（只落焦点，被过滤挡住先清
 * 过滤）。定位正在播放要等行取回、分组也到了再落。
 */
export function usePlaylistReveal(
  guid: string,
  model: PlaylistPageModel,
  handle: RefObject<TrackTableHandle | null>,
): PlaylistReveal {
  const page = useService(playlistPageKey);
  const latest = useRef(model);
  useLayoutEffect(() => {
    latest.current = model;
  });
  const pending = useRef<{ request: RevealRequest; steps: number } | null>(null);

  /** 试着落一次：落下了或落不到答 true，改了条目流、要等下一版答 false。 */
  const attempt = useCallback(
    (request: RevealRequest): boolean => {
      const view = latest.current.latest();
      const display = view.displayOf(request.row);
      if (display >= 0) {
        handle.current?.reveal(display, request.select);
        return true;
      }
      if (view.shape === 'filtered') {
        if (!request.clearFilter) return true;
        page.filter.clear(guid);
        return false;
      }
      const key = view.collapsedGroupOf(request.row);
      if (key === null) return true;
      page.groups.toggleCollapsed(guid, key);
      return false;
    },
    [page, guid, handle],
  );

  const revealRow = useCallback(
    (row: number, select: boolean, clearFilter: boolean) => {
      const view = latest.current.latest();
      const request = { row, select, clearFilter };
      const reachable = view.displayOf(row) >= 0 || view.collapsedGroupOf(row) !== null;
      if (!reachable && !(clearFilter && view.shape === 'filtered')) return false;
      pending.current = attempt(request) ? null : { request, steps: 1 };
      return true;
    },
    [attempt],
  );

  // 条目流换过一版：接着落挂着的那一次。
  const { view } = model;
  useEffect(() => {
    const waiting = pending.current;
    if (!waiting) return;
    const done = attempt(waiting.request) || waiting.steps >= MAX_STEPS;
    pending.current = done ? null : { ...waiting, steps: waiting.steps + 1 };
  }, [view, attempt]);

  // 定位正在播放：请求是给这张的，且行与分组都到了。
  const request = useAtomValueRawSync(page.locate.requestAtom);
  const ready = model.rows.status === 'ready' && !model.groups.loading && view.shape !== 'waiting';
  useEffect(() => {
    if (!request || request.guid !== guid || !ready) return;
    page.locate.done(request.tick);
    revealRow(request.row, false, true);
  }, [request, guid, ready, page, revealRow]);

  const [typeSearch, setTypeSearch] = useState<PlaylistTypeSearch>();
  useEffect(() => {
    const created = createPlaylistTypeSearch(
      () => {
        const { rows, filter } = latest.current;
        return { guid, total: rows.total, hits: filter.active ? filter.hits : null };
      },
      (row) => revealRow(row, true, false),
    );
    setTypeSearch(created);
    return () => created.dispose();
  }, [guid, revealRow]);
  // 进出过滤或命中换了一份：打到一半的串、在翻页扫的那一轮都对着旧的一份，清掉。
  const { active, hits } = model.filter;
  useEffect(() => {
    typeSearch?.clear();
  }, [typeSearch, active, hits]);

  return { revealRow, typeSearch };
}
