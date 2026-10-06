import type { CSSProperties } from 'react';
import { StageDial } from '../dial/StageDial.tsx';
import { PaperFileInfo } from '../fields/PaperFileInfo.tsx';
import { StageFields } from '../fields/StageFields.tsx';
import { PaperGauges } from '../gauges/PaperGauges.tsx';
import { LyricCard } from '../lyrics/LyricCard.tsx';
import { PaperSpectrum } from '../spectrum/PaperSpectrum.tsx';
import { StageStereo } from '../stereo/StageStereo.tsx';
import { PaperWaveform } from '../waveform/PaperWaveform.tsx';
import { STAGE_CROSSES, STAGE_HEIGHT, STAGE_PAD, STAGE_WIDTH } from './paperStage.ts';
import { PaperMarks } from './PaperMarks.tsx';
import styles from './PaperStage.module.css';
import { StageScaleContext } from './stageScale.ts';

export interface PaperStageProps {
  /** 舞台缩放：宽高两个比值里较小的那个。 */
  readonly scale: number;
  /** 舞台左上角在场景里的位置，CSS 像素。 */
  readonly origin: { readonly x: number; readonly y: number };
}

/**
 * full 档的图纸内容：1920 × 1080 的舞台，整幅 `scale(s)` 等比缩放、居中放进场景，里面一律写舞台坐标
 * （`paperStage.ts`）。s 经 `StageScaleContext` 交给舞台里的 canvas 件，canvas 的物理尺寸按它开。
 *
 * 罗盘左区、右栏上半与仪表第一行、歌词卡各自按舞台坐标定位；频谱、整轨波形、量表与文件信息放进这里定位好的
 * 外框，外框上给全它们的几何变量（件里不写缺省，别的档在自己的外框上另给一套）。
 */
export function PaperStage({ scale, origin }: PaperStageProps) {
  const frame: CSSProperties = {
    left: origin.x,
    top: origin.y,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    transform: `scale(${scale})`,
  };
  return (
    <StageScaleContext value={scale}>
      <div className={styles.stage} style={frame} data-paper-content>
        <PaperMarks crosses={STAGE_CROSSES} pad={STAGE_PAD} />
        <StageDial />
        <StageFields stereo={<StageStereo />} />
        <div className={`${styles.slot} ${styles.spectrum}`}>
          <PaperSpectrum />
        </div>
        <div className={`${styles.slot} ${styles.waveform}`}>
          <PaperWaveform />
        </div>
        <div className={`${styles.slot} ${styles.gauges}`}>
          <PaperGauges />
        </div>
        <div className={`${styles.slot} ${styles['file-info']}`}>
          <PaperFileInfo />
        </div>
        <LyricCard />
      </div>
    </StageScaleContext>
  );
}
