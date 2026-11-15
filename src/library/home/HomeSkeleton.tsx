import { SkeletonItem } from '@fluentui/react-components';
import type { CSSProperties, ReactNode } from 'react';
import type { RailShape } from './homeRail.ts';
import { HomeRail, TILE_VARS } from './HomeRail.tsx';
import { HomeTrackRail } from './HomeTrackRow.tsx';
import styles from './HomeSkeleton.module.css';

/**
 * 载入中的占位块，尺寸由调用处按读到后的版式给。流光由 Fluent 的骨架项画：深浅跟主题走，
 * 系统要求减弱动效时它自己静止
 */
export function Bone({
  width = '100%',
  height,
  radius = 'var(--borderRadiusSmall)',
}: {
  readonly width?: CSSProperties['width'];
  readonly height: CSSProperties['height'];
  readonly radius?: CSSProperties['borderRadius'];
}) {
  return <SkeletonItem aria-hidden style={{ width, height, borderRadius: radius }} />;
}

const count = (n: number) => Array.from({ length: n }, (_, index) => index);

/**
 * 载入中的一排占位。条目数取读到后会翻页的数量（比一屏多一张），宽度才与读到后一致；
 * 读到后少于一屏的行，条目数按读到后的张数给
 */
export function SkeletonRail({
  id,
  label,
  rowWidth,
  shape,
  items,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly rowWidth: number;
  readonly shape: RailShape;
  readonly items: number;
  readonly children: ReactNode;
}) {
  return (
    <HomeRail
      id={id}
      label={label}
      rowWidth={rowWidth}
      shape={shape}
      items={count(items)}
      keyOf={(index) => `skeleton:${index}`}
      render={() => children}
    />
  );
}

/** 曲目列的占位：四行一列，列数同读到后 */
export function SkeletonTrackRail({
  id,
  label,
  rowWidth,
  tracks,
}: {
  readonly id: string;
  readonly label: string;
  readonly rowWidth: number;
  readonly tracks: number;
}) {
  return (
    <HomeTrackRail
      id={id}
      label={label}
      rowWidth={rowWidth}
      items={count(tracks)}
      keyOf={(index) => `skeleton:${index}`}
      render={(index) => <TrackSkeleton key={index} />}
    />
  );
}

/** 封面图块：方形封面加两行字，边长与行高经 `--tile-size`、`--tile-line` 取自所在的横排行 */
export function TileSkeleton() {
  return (
    <div className={styles.tile} style={TILE_VARS} aria-hidden>
      <Bone height="var(--tile-size)" radius="var(--borderRadiusMedium)" />
      <span className={styles.line}>
        <Bone width="70%" height="12px" />
      </span>
      <span className={styles.line}>
        <Bone width="45%" height="10px" />
      </span>
    </div>
  );
}

/** 首页曲目列里的一行 */
export function TrackSkeleton() {
  return (
    <div className={styles.track} aria-hidden>
      <Bone width="40px" height="40px" />
      <span className={styles.text}>
        <Bone width="60%" height="12px" />
        <Bone width="40%" height="10px" />
      </span>
    </div>
  );
}

/** 榜单卡：榜名、规模、第一名与其下两名，高度同读到后的在线榜单卡 */
export function RankSkeleton() {
  return (
    <div className={styles.rank} aria-hidden>
      <Bone width="45%" height="16px" />
      <Bone width="35%" height="10px" />
      <span className={styles.lead}>
        <Bone width="56px" height="56px" radius="var(--borderRadiusMedium)" />
        <span className={styles.text}>
          <Bone width="70%" height="12px" />
          <Bone width="45%" height="10px" />
        </span>
      </span>
      {[0, 1].map((entry) => (
        <span key={entry} className={styles.lead}>
          <Bone width="32px" height="32px" />
          <span className={styles.text}>
            <Bone width="65%" height="10px" />
            <Bone width="40%" height="10px" />
          </span>
        </span>
      ))}
    </div>
  );
}

/** 快捷入口的一格：封面与两行字，高度同读到后 */
export function QuickSkeleton() {
  return (
    <div className={styles.quick} aria-hidden>
      <Bone width="56px" height="56px" radius="0" />
      <span className={styles.text}>
        <Bone width="60%" height="12px" />
        <Bone width="40%" height="10px" />
      </span>
    </div>
  );
}
