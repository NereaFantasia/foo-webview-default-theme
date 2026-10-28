import { Skeleton, SkeletonItem } from '@fluentui/react-components';
import { Pause16Filled, Play16Filled } from '@fluentui/react-icons';
import type { LibraryTrack } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { PlayingMark } from '../../../track/PlayingMark.tsx';
import { TrackArtists } from '../../../track/TrackCredits.tsx';
import { trackKeyOf, playbackKey } from '../../../playback/playbackContract.ts';
import { playingAudibleAtom, playingTrackKeyAtom } from '../../../playback/playingTrack.ts';
import { discTrackText, durationText, trackNumberText } from '../../../table/cellText.ts';
import { RatingCell } from '../../../table/RatingCell.tsx';
import { ratingsVersionAtom, ratingsKey } from '../../../track/trackRatings.ts';
import styles from './AlbumDropdownTracks.module.css';
import { DROPDOWN_METRICS, trackCell, trackColumns, trackLines } from '../albumDropdown.ts';
import type { MenuPoint } from '../../albumMenu.ts';
import { albumArtistOf, trackPathOf, type Album } from '../../../host/libraryContract.ts';
import { useService } from '../../../kit/useService.ts';
import {
  activate,
  emptySelection,
  menuSelection,
  pruneSelection,
  selectAll,
  type Modifiers,
} from '../../../kit/keyedSelection.ts';

export interface AlbumDropdownTracksProps {
  readonly album: Album;
  /** 专辑所属曲目列表（未加载或加载失败时为 null） */
  readonly tracks: readonly LibraryTrack[] | null;
  readonly failed: boolean;
  /** 骨架屏占位渲染开关（展开过渡完成后才展示） */
  readonly skeleton: boolean;
  /** 起播指定索引曲目回调 */
  readonly onPlay: (index: number) => void;
  /** 呼出曲目快捷操作菜单回调 */
  readonly onMenu: (
    tracks: readonly LibraryTrack[],
    index: number,
    point: MenuPoint,
    ratingStamp: number,
  ) => void;
}

/** 计算单曲特异署名（与专辑艺术家一致时返回空串） */
function creditOf(track: LibraryTrack, album: Album): string {
  const artist = track.artist.trim();
  return artist && artist !== albumArtistOf(album) ? artist : '';
}

interface PlayKeyProps {
  readonly state: 'play' | 'pause' | 'resume';
  readonly label: string;
  onPress(): void;
}

/**
 * 序号格播放控制键（悬浮时替换序号展示）
 *
 * 鼠标点击时阻止默认焦点抢占，确保列表键盘导航连续；拦截双击事件以防止重复触发起播
 */
function PlayKey({ state, label, onPress }: PlayKeyProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={styles.playKey}
      aria-label={label}
      data-dropdown-track-play
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (event.detail < 2) onPress();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {state === 'pause' ? <Pause16Filled /> : <Play16Filled />}
    </button>
  );
}

/** 计算曲目单元格在网格中的定位样式 */
function cellStyle(index: number, count: number): CSSProperties {
  const { row, column } = trackCell(index, count);
  return { gridRow: row, gridColumn: column };
}

/**
 * 下拉面板曲目网格列表
 *
 * 超过 8 首时采用双列排布，超出可视高度时支持内部滚动；支持单击选中、双击/回车起播、上下文菜单与多选组合键；
 * 悬停时序号切换为播放键，尾部时长切换为交互评分组件；正在播放项突出高亮
 */
export function AlbumDropdownTracks(props: AlbumDropdownTracksProps) {
  const { album, tracks, onPlay, onMenu } = props;
  const t = useAtomValueRawSync(translateAtom);
  const playingKey = useAtomValueRawSync(playingTrackKeyAtom);
  const audible = useAtomValueRawSync(playingAudibleAtom);
  const ratings = useService(ratingsKey);
  const playback = useService(playbackKey);
  useAtomValueRawSync(ratingsVersionAtom);
  // 评分代次时间戳：随曲目重取或组件挂载重新生成，避免过期状态覆盖
  const [stamp, setStamp] = useState(() => ratings.stamp());
  const [stamped, setStamped] = useState(tracks);
  if (stamped !== tracks) {
    setStamped(tracks);
    if (stamped !== null) setStamp(ratings.stamp());
  }
  // 针对复合容器曲目，按当前可见曲目注册并监听评分变更
  useEffect(() => (tracks ? ratings.watch(tracks, stamp) : undefined), [ratings, tracks, stamp]);
  const order = useMemo(() => tracks?.map(trackPathOf) ?? [], [tracks]);
  const [stored, setSelection] = useState(() => emptySelection<string>());
  const [focus, setFocus] = useState<string | null>(null);
  const selection = pruneSelection(stored, order);
  if (selection !== stored) setSelection(selection);
  const selected = focus === null ? -1 : order.indexOf(focus);
  if (focus !== null && selected < 0) setFocus(null);
  const baseId = useId();
  const optionId = (index: number) => `${baseId}-${index}`;
  const count = tracks?.length ?? album.trackCount;
  const lines = trackLines(count);
  const layout: CSSProperties & Record<`--${string}`, string> = {
    '--lines': String(lines),
    '--columns': String(trackColumns(count)),
    '--row': `${DROPDOWN_METRICS.rowHeight}px`,
  };

  if (!tracks) {
    if (props.failed) return <p className={styles.failed}>{t('album.menuTracksFailed')}</p>;
    if (!props.skeleton) return null;
    // 骨架屏仅填充当前网格可视行数，不触发滚动
    const shown = Math.min(album.trackCount, trackColumns(count) * lines);
    return (
      <Skeleton className={styles.tracks} style={layout} aria-hidden data-dropdown-skeleton>
        {Array.from({ length: shown }, (_, at) => (
          <div key={at} className={styles.track} style={cellStyle(at, count)}>
            <SkeletonItem className={styles.bar} size={12} />
          </div>
        ))}
      </Skeleton>
    );
  }

  const openMenu = (index: number, point: MenuPoint) => {
    const key = order[index];
    if (key === undefined) return;
    const picked = menuSelection(selection, order, key, index);
    setSelection(picked.selection);
    setFocus(key);
    const wanted = new Set(picked.targets);
    onMenu(
      tracks.filter((track) => wanted.has(trackPathOf(track))),
      index,
      point,
      stamp,
    );
  };
  const menuAt = (index: number) => {
    const box = document.getElementById(optionId(index))?.getBoundingClientRect();
    openMenu(index, { x: box?.left ?? 0, y: box?.bottom ?? 0 });
  };
  const choose = (index: number, modifiers: Modifiers) => {
    const key = order[index];
    if (key === undefined) return;
    setSelection(activate(selection, order, key, modifiers, index));
    setFocus(key);
  };
  const move = (index: number, modifiers: Modifiers) => {
    const next = Math.max(0, Math.min(tracks.length - 1, index));
    choose(next, modifiers);
    document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.altKey || event.nativeEvent.isComposing) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && !event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelection(selectAll(order));
      if (selected < 0) setFocus(order[0] ?? null);
      return;
    }
    if (event.key === 'F10') {
      if (ctrl || !event.shiftKey || selected < 0) return;
      event.preventDefault();
      menuAt(selected);
      return;
    }
    const steps: Record<string, number> = {
      ArrowDown: selected + 1,
      ArrowUp: selected - 1,
      Home: 0,
      End: tracks.length - 1,
    };
    const step = steps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move(step, { ctrl, shift: event.shiftKey });
    } else if (event.key === 'Enter' && !ctrl && !event.shiftKey && selected >= 0) {
      event.preventDefault();
      onPlay(selected);
    }
  };
  const contextMenu = (index: number, event: MouseEvent) => {
    event.preventDefault();
    openMenu(index, { x: event.clientX, y: event.clientY });
  };
  const discs = album.discCount;
  return (
    <ol
      className={styles.tracks}
      style={layout}
      role="listbox"
      aria-multiselectable
      tabIndex={0}
      aria-label={t('album.dropdownTracks', { album: album.name })}
      aria-activedescendant={selected >= 0 ? optionId(selected) : undefined}
      data-dropdown-tracks
      onKeyDown={keydown}
      onKeyUp={(event) => {
        // Menu 键松开时拦截合成 contextmenu，避免原生菜单叠加弹出
        if (event.key !== 'ContextMenu') return;
        event.preventDefault();
        if (selected >= 0) menuAt(selected);
      }}
    >
      {tracks.map((track, index) => {
        const playing = trackKeyOf(track) === playingKey;
        const ratable = ratings.canRate(track);
        const credit = creditOf(track, album);
        const title = track.title || track.path;
        return (
          <li
            key={`${track.path}|${track.subsong}`}
            id={optionId(index)}
            className={styles.track}
            style={cellStyle(index, count)}
            role="option"
            aria-selected={selection.selected.has(trackPathOf(track))}
            data-focused={index === selected || undefined}
            data-dropdown-track
            data-playing={playing || undefined}
            onClick={(event) => {
              if (event.detail < 2)
                choose(index, {
                  ctrl: event.ctrlKey || event.metaKey,
                  shift: event.shiftKey,
                });
            }}
            onDoubleClick={() => onPlay(index)}
            onContextMenu={(event) => contextMenu(index, event)}
          >
            <span className={styles.number}>
              <span className={styles.numberText}>
                {playing ? (
                  <PlayingMark active={audible} label={t('table.nowPlaying')} />
                ) : discs > 1 ? (
                  discTrackText(track, discs)
                ) : (
                  trackNumberText(track)
                )}
              </span>
              <PlayKey
                // 正在播放项切换播放/暂停，非播放项触发起播
                state={playing ? (audible ? 'pause' : 'resume') : 'play'}
                label={t(
                  playing ? (audible ? 'album.tilePause' : 'album.tileResume') : 'album.play',
                )}
                onPress={() => (playing ? void playback.playOrPause() : onPlay(index))}
              />
            </span>
            <span className={styles.title} title={credit ? `${title} — ${credit}` : title}>
              {title}
              {credit && <TrackArtists track={track} className={styles.credit} tabIndex={-1} />}
            </span>
            <span className={styles.end} data-ratable={ratable || undefined}>
              <span className={styles.duration}>{durationText(track.duration)}</span>
              {ratable && (
                <span className={styles.rating} data-dropdown-rating>
                  <RatingCell
                    value={ratings.ratingOf(track, stamp)}
                    label={t('table.rating')}
                    onRate={(value) => void ratings.setRating(track, value)}
                  />
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
