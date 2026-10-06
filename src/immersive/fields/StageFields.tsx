import { useAtomValueRawSync } from 'jotai/react';
import { useRef, type ReactNode } from 'react';
import { currentTrackAtom } from '../../playback/playback.ts';
import { MISSING, stageQualityLine } from '../paper/paperScale.ts';
import { STAGE_TITLE, STAGE_TITLE_SOFTNESS, STAGE_TITLE_SPEED } from '../paper/paperStage.ts';
import { trackExtrasAtom } from './trackExtras.ts';
import styles from './StageFields.module.css';
import { StageMeterRow } from './StageMeterRow.tsx';
import { useTitleScroll, type TitleScrollOptions } from './useTitleScroll.ts';

const TITLE_SCROLL: TitleScrollOptions = {
  font: STAGE_TITLE.font,
  speed: STAGE_TITLE_SPEED,
  softness: STAGE_TITLE_SOFTNESS,
};

export interface StageFieldsProps {
  /** 仪表第一行左格里的声场件，格子 332 × 155、左上角在舞台 (760, 296)。 */
  readonly stereo: ReactNode;
}

/**
 * full 档舞台的右栏上半：热色方块、From 行、标题、By 与右对齐到 x 1780 的 Quality，下接仪表第一行
 * （`StageMeterRow`）。本身是铺满舞台的定位层，各件按舞台坐标绝对定位；字按基线落位：字盒底边裁到字母基线，
 * `top` 写的就是基线，要省略的字只在横向裁切，下伸部分照常露出。字段名是等宽英文，是版式的一部分，
 * 不进语言包；缺值写 `—`。
 *
 * 标题字号从 76 起，放不下每次降 3、最小 62，仍放不下就循环滚动与擦除（`useTitleScroll`）。
 * From 行与 By 行标了 `data-decor-guard`，生成式网格不在标题块周围放装饰。
 */
export function StageFields({ stereo }: StageFieldsProps) {
  const track = useAtomValueRawSync(currentTrackAtom);
  const extras = useAtomValueRawSync(trackExtrasAtom);
  const title = track?.title || MISSING;
  const quality = stageQualityLine({
    bitDepth: extras.bitDepth,
    bitrate: track?.bitrate,
    sampleRate: track?.sampleRate,
    encoding: extras.encoding,
  });
  const titleBox = useRef<HTMLHeadingElement>(null);
  const titleText = useRef<HTMLSpanElement>(null);
  const { rolling } = useTitleScroll(titleBox, titleText, title, TITLE_SCROLL);

  return (
    <div className={styles.fields}>
      <span className={styles['hot-square']} aria-hidden />
      <div className={`${styles.base} ${styles.from}`} data-decor-guard="40">
        <span>From:</span> <span data-field="album">{track?.album || MISSING}</span>
      </div>
      <h1
        ref={titleBox}
        className={`${styles.base} ${styles.title}`}
        style={{ width: STAGE_TITLE.width }}
        data-rolling={rolling || undefined}
        data-field="title"
      >
        <span ref={titleText} className={styles['title-text']}>
          {title}
        </span>
      </h1>
      <span className={`${styles.base} ${styles.key} ${styles['by-key']}`} data-decor-guard="40">
        By
      </span>
      <div className={`${styles.base} ${styles.artist}`} data-field="artist" data-decor-guard="40">
        {track?.artist || MISSING}
      </div>
      {quality && (
        <>
          <span className={`${styles.base} ${styles.key} ${styles['quality-key']}`}>Quality</span>
          <div className={`${styles.base} ${styles.quality}`} data-field="quality">
            {quality}
          </div>
        </>
      )}
      <StageMeterRow stereo={stereo} />
    </div>
  );
}
