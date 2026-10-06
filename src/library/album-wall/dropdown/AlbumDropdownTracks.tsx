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
  /** 取到的曲目；还没到或取失败时为 null。 */
  readonly tracks: readonly LibraryTrack[] | null;
  readonly failed: boolean;
  /** 曲目没到时画不画骨架行：下拉还在展开时先空着，动完了还没到才画。 */
  readonly skeleton: boolean;
  /** 从第 `index` 首起播这张专辑。 */
  readonly onPlay: (index: number) => void;
  /** 按当前曲序排列的选择；右键未选曲目时只作用于它。 */
  readonly onMenu: (
    tracks: readonly LibraryTrack[],
    index: number,
    point: MenuPoint,
    ratingStamp: number,
  ) => void;
}

/** 单曲艺术家与专辑艺术家不同时，灰字接在标题后面；相同或为空时不写。 */
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
 * 序号格里的播放键，指针停在行上时顶替序号出现。不拿焦点：按下时拦住缺省，焦点留在曲目列表上，上下键照常
 * 接着走；它也不在 Tab 次序里，键盘上起播用回车。双击在这里拦下，连点两下不会让整行再起播一次。
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

/** 第 `index` 首在曲目区网格里的位置。 */
function cellStyle(index: number, count: number): CSSProperties {
  const { row, column } = trackCell(index, count);
  return { gridRow: row, gridColumn: column };
}

/**
 * 下拉里的曲目：超过八首分两栏、左栏先排满，行高照下拉的几何（面板高是按它算的）；首数多到露不全时
 * 曲目区自己滚动，按段排（`trackCell`）。单击选中，双击或回车从这一首起播，右键、Shift+F10 与 Menu 键
 * 出选择的菜单；Ctrl 切换单项，Shift 扩选，Ctrl+A 全选。上下键移动焦点，选到露不出来的那首时曲目区
 * 滚过去。选择按曲目身份保留，刷新不随曲序漂移。名字单行截断，悬停出全名。
 * 多碟专辑写「碟.曲」、不加碟头。正在播放的那首用波形记号代替曲号、标题取主色。指针停在行上时，序号换成
 * 播放键（正在播的那首是暂停或继续），行尾的时长换成五颗星、点星写评分；流媒体这类评不了分的一直写时长。
 * 选中随专辑换掉：调用方按专辑键给 `key`。
 */
export function AlbumDropdownTracks(props: AlbumDropdownTracksProps) {
  const { album, tracks, onPlay, onMenu } = props;
  const t = useAtomValueRawSync(translateAtom);
  const playingKey = useAtomValueRawSync(playingTrackKeyAtom);
  const audible = useAtomValueRawSync(playingAudibleAtom);
  const ratings = useService(ratingsKey);
  const playback = useService(playbackKey);
  useAtomValueRawSync(ratingsVersionAtom);
  // 评分戳：下拉挂上时拿一个，打开下拉的那次取曲目就在这之后发出。挂着时曲目又换了（库变了重取），
  // 到了再拿一个新的。
  const [stamp, setStamp] = useState(() => ratings.stamp());
  const [stamped, setStamped] = useState(tracks);
  if (stamped !== tracks) {
    setStamped(tracks);
    if (stamped !== null) setStamp(ratings.stamp());
  }
  // 一个文件里有好几首时，评分事件分不出是哪一首：登记着显示的这几首，逐首补读。
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
    // 骨架只画露得出的那几行，不滚。
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
        // Menu 键在松开时才合成 contextmenu，不拦的话浏览器自己的菜单会叠上来。
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
                // 正在播的这首：出声时是暂停，停着时是继续；别的是从这一首起播。
                state={playing ? (audible ? 'pause' : 'resume') : 'play'}
                label={t(
                  playing ? (audible ? 'album.tilePause' : 'album.tileResume') : 'album.play',
                )}
                onPress={() => (playing ? void playback.playOrPause() : onPlay(index))}
              />
            </span>
            <span className={styles.title} title={credit ? `${title} — ${credit}` : title}>
              {title}
              {credit && <span className={styles.credit}>{credit}</span>}
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
