import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { currentTrackAtom } from '../../playback/playback.ts';
import { MISSING } from '../paper/paperScale.ts';
import { StageBpm } from '../tempo/StageBpm.tsx';
import { durationTextAtom, remainingTextAtom } from './clockText.ts';
import styles from './StageMeterRow.module.css';

/** 右对齐到 x 1780 的 Duration 格，附行是剩余时间；行里只有这一格跟着播放位置走。 */
function DurationCell() {
  const duration = useAtomValueRawSync(durationTextAtom);
  const remaining = useAtomValueRawSync(remainingTextAtom);
  return (
    <div className={styles['duration-cell']}>
      <span className={`${styles.key} ${styles['duration-key']}`}>Duration</span>
      <span className={styles.clock} data-field="duration">
        {duration}
      </span>
      <div className={styles.remain}>
        <span className={styles['sub-key']}>Remain</span>
        <span className={styles['remain-value']} data-field="remaining">
          {remaining}
        </span>
      </div>
    </div>
  );
}

export interface StageMeterRowProps {
  /** 左格里的声场件。 */
  readonly stereo: ReactNode;
}

/**
 * full 档舞台右栏 By 行下面的仪表第一行（y 296–451）：主行小标的顶边与声场图顶边齐平在 y 296，这一线就是
 * 本行的上沿，不另画横线。四格：声场 | BPM（`StageBpm`）| Genre（下面上下排 Album artist，与 Artist 相同或
 * 为空时不出）| Duration（附行剩余时间）。本身是铺满舞台的定位层，各件按舞台坐标绝对定位，字按基线落位。
 * 缺值写 `—`，键名保留。
 */
export function StageMeterRow({ stereo }: StageMeterRowProps) {
  const track = useAtomValueRawSync(currentTrackAtom);
  const albumArtist =
    track?.albumArtist && track.albumArtist !== track.artist ? track.albumArtist : '';
  return (
    <div className={styles.meter}>
      <div className={styles['stereo-cell']}>{stereo}</div>
      <span className={`${styles.divider} ${styles.first}`} aria-hidden />
      <StageBpm />
      <span className={`${styles.divider} ${styles.second}`} aria-hidden />
      <span className={`${styles.base} ${styles.key} ${styles['genre-key']}`}>Genre</span>
      <div className={`${styles.base} ${styles.genre}`} data-field="genre">
        {track?.genre || MISSING}
      </div>
      {albumArtist && (
        <>
          <span className={`${styles.base} ${styles['sub-key']} ${styles['album-artist-key']}`}>
            Album artist
          </span>
          <div className={`${styles.base} ${styles['album-artist']}`} data-field="albumArtist">
            {albumArtist}
          </div>
        </>
      )}
      <DurationCell />
    </div>
  );
}
