import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, type CSSProperties } from 'react';
import { currentTrackAtom } from '../../playback/playback.ts';
import { COVER_SIZE, DIAL_CENTER } from '../paper/paperLayout.ts';
import { formatTrackNo } from '../paper/paperScale.ts';
import { COMPACT_SCALE, type DialPlacement } from '../paper/paperTiers.ts';
import { DialCover } from './DialCover.tsx';
import { PaperBrackets } from './PaperBrackets.tsx';
import styles from './PaperDial.module.css';
import { PaperOrbit } from './PaperOrbit.tsx';
import { PaperTransport } from './PaperTransport.tsx';

/** 原尺寸下的环半径；圆心与封面边长同 `paperLayout.ts` 的 `DIAL_CENTER`、`COVER_SIZE`。 */
const RINGS: readonly number[] = [196, 236, 276];
/** 原尺寸下刻度字的中心（版心坐标），逐个手排，不是等距的。 */
const TICKS = [
  { text: 'W', x: 270, y: 124 },
  { text: 'N', x: 12, y: 380 },
  { text: '270', x: 93, y: 380 },
  { text: '90', x: 521, y: 380 },
  { text: 'v', x: 270, y: 624 },
] as const;
/** 原尺寸下专辑名、曲号两个文字块的顶边到圆心的竖直距离，以及文字块的半宽。 */
const ALBUM_TOP = -206;
const TRACK_NO_TOP = 195;
const TEXT_HALF_WIDTH = 210;
/** 传输键一组在原尺寸下的外框。 */
const TRANSPORT = { width: 240, height: 80 } as const;
/** narrow 档那一行：封面边长与顶边、封面与右侧文字列的间距、右侧三行各自的顶边。 */
const NARROW = {
  cover: 160,
  top: 24,
  gap: 16,
  albumTop: 44,
  transportTop: 76,
  trackNoTop: 152,
} as const;
/** 四角括号在封面外扩 8 处，每个角的臂长 14（含线宽）。 */
const BRACKET_OUTSET = 8;
const BRACKET_ARM = 14;

interface Positioned {
  readonly text: string;
  readonly style: CSSProperties;
}

interface DialLayout {
  /** 传输键的缩放：有罗盘时跟罗盘，narrow 档固定 0.8。 */
  readonly scale: number;
  readonly cover: { readonly left: number; readonly top: number; readonly size: number };
  readonly album: CSSProperties;
  readonly trackNo: CSSProperties;
  readonly transport: CSSProperties;
  readonly rings: readonly { readonly radius: number; readonly style: CSSProperties }[];
  readonly ticks: readonly Positioned[];
}

function narrowLayout(column: { x: number; width: number }): DialLayout {
  const { x, width } = column;
  const right = x + NARROW.cover + NARROW.gap;
  const textWidth = width - NARROW.cover - NARROW.gap;
  const transportLeft = Math.min(right, x + width - TRANSPORT.width * COMPACT_SCALE);
  return {
    scale: COMPACT_SCALE,
    cover: { left: x, top: NARROW.top, size: NARROW.cover },
    album: { left: right, top: NARROW.albumTop, width: textWidth },
    trackNo: { left: right, top: NARROW.trackNoTop, width: textWidth },
    transport: { left: transportLeft, top: NARROW.transportTop },
    rings: [],
    ticks: [],
  };
}

function dialLayout(dial: DialPlacement): DialLayout {
  const s = dial.scale;
  const cover = COVER_SIZE * s;
  const textLeft = dial.x - TEXT_HALF_WIDTH * s;
  const textWidth = TEXT_HALF_WIDTH * 2 * s;
  return {
    scale: s,
    cover: { left: dial.x - cover / 2, top: dial.y - cover / 2, size: cover },
    album: { left: textLeft, top: dial.y + ALBUM_TOP * s, width: textWidth },
    trackNo: { left: textLeft, top: dial.y + TRACK_NO_TOP * s, width: textWidth },
    transport: {
      left: dial.x - (TRANSPORT.width * s) / 2,
      top: dial.y + dial.transportOffset - (TRANSPORT.height * s) / 2,
    },
    rings: RINGS.map((radius) => ({
      radius,
      style: { left: dial.x, top: dial.y, width: radius * 2 * s, height: radius * 2 * s },
    })),
    ticks: TICKS.map((tick) => ({
      text: tick.text,
      style: {
        left: dial.x + (tick.x - DIAL_CENTER.x) * s,
        top: dial.y + (tick.y - DIAL_CENTER.y) * s,
      },
    })),
  };
}

export interface PaperDialProps {
  /** 罗盘圆心与缩放；narrow 档没有罗盘，为 null。 */
  readonly dial: DialPlacement | null;
  /** 单栏的左缘与宽，narrow 档排封面那一行用。 */
  readonly column: { readonly x: number; readonly width: number };
}

/**
 * 收缩档与竖版的图纸左栏：罗盘环套封面。三圈实线环与刻度字是版式，两圈虚线环、辐条与四个轨道点在转动层
 * `PaperOrbit` 上，封面压在转动层之上；环内上下是专辑名与曲号，环下是三颗圆键 `PaperTransport`。
 * 本身是版心原点上的零尺寸定位锚，各件按版心坐标绝对定位。
 *
 * 各件的位置按档位给的 `dial` 算：缩放作用于环、封面、刻度与两个文字块到圆心的距离，字号不缩。
 * narrow 档没有罗盘：单栏左上一块 160 的封面，右侧依次是专辑名（最多两行）、传输键与曲号，排在 `column` 的宽里。
 *
 * 封面标了 `data-decor-guard`：图纸的生成式网格不在它周围放装饰。
 */
export function PaperDial({ dial, column }: PaperDialProps) {
  const track = useAtomValueRawSync(currentTrackAtom);
  const layout = useMemo(() => (dial ? dialLayout(dial) : narrowLayout(column)), [dial, column]);
  const { left, top, size } = layout.cover;
  const coverBox: CSSProperties = { left, top, width: size, height: size };
  const bracketBox = {
    left: left - BRACKET_OUTSET,
    top: top - BRACKET_OUTSET,
    size: size + 2 * BRACKET_OUTSET,
  };
  return (
    <div className={dial ? styles.dial : `${styles.dial} ${styles.narrow}`}>
      {layout.rings.map((ring) => (
        <span
          key={ring.radius}
          className={styles.ring}
          style={ring.style}
          data-dial-ring
          aria-hidden
        />
      ))}
      {dial && <PaperOrbit center={dial} scale={dial.scale} />}
      {layout.ticks.map((tick) => (
        <span key={tick.text} className={styles.tick} style={tick.style} aria-hidden>
          {tick.text}
        </span>
      ))}
      <div className={`${styles.text} ${styles.album}`} style={layout.album} data-field="dialAlbum">
        {track?.album ?? ''}
      </div>
      <DialCover box={coverBox} guard={47} />
      <PaperBrackets box={bracketBox} arm={BRACKET_ARM} />
      <div className={styles.text} style={layout.trackNo} data-field="trackNo">
        {formatTrackNo(track?.trackNumber)}
      </div>
      <PaperTransport className={styles.transport} scale={layout.scale} style={layout.transport} />
    </div>
  );
}
