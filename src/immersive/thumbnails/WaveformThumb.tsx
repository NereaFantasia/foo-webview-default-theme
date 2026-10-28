import styles from './WaveformThumb.module.css';

/** 整轨波形渲染模式，取值与沉浸视图同名；此处独立声明以避免缩略图反向依赖波形模块 */
export type WaveformThumbMode = 'rms' | 'weighted' | 'midHigh' | 'layers' | 'lanes';

type Tone = 'shade' | 'ink' | 'hot';

interface Layer {
  readonly tone: Tone;
  /** 竖线归一化高度，取值范围 0…1 */
  readonly levels: readonly number[];
  /** 从上往下的分道索引；缺省时沿中线上下对称绘制 */
  readonly lane?: number;
}

const VIEW = { width: 160, height: 100 };
const COUNT = 40;
const PITCH = VIEW.width / COUNT;
const BAR_WIDTH = 2.4;
/** 模拟已播放竖线数，播放头位于该索引位置 */
const PLAYED = 14;
const HALF_HEIGHT = 38;
const LANE = { top: 4, pitch: 32, height: 28 };

/** 生成用于示意波形起伏的固定合成包络曲线 */
function envelope(index: number, phase: number): readonly number[] {
  return Array.from({ length: COUNT }, (_, at) => {
    const wave = Math.abs(
      Math.sin((at + index) * 0.46 + phase) * Math.cos(at * 0.17 + phase * 1.9),
    );
    return 0.2 + 0.8 * wave;
  });
}

function nested(outer: readonly number[], scale: number, phase: number): readonly number[] {
  return outer.map(
    (level, at) => level * scale * (0.5 + 0.5 * Math.abs(Math.sin(at * 0.8 + phase))),
  );
}

/** 当前渲染模式的分层定义，按由后到前排序，与沉浸视图分层结构保持一致 */
function layersOf(mode: WaveformThumbMode): readonly Layer[] {
  const full = envelope(0, 0);
  switch (mode) {
    case 'rms':
      return [{ tone: 'ink', levels: full }];
    case 'weighted':
      return [{ tone: 'ink', levels: envelope(2, 0.6).map((level) => level * 0.82) }];
    case 'midHigh':
      return [
        { tone: 'shade', levels: full },
        { tone: 'ink', levels: nested(full, 1, 1.3) },
      ];
    case 'layers':
      return [
        { tone: 'shade', levels: full },
        { tone: 'ink', levels: nested(full, 0.85, 0.4) },
        { tone: 'hot', levels: nested(full, 0.6, 2.1) },
      ];
    case 'lanes':
      return [
        { tone: 'hot', levels: envelope(5, 2.3), lane: 0 },
        { tone: 'ink', levels: envelope(3, 1.1), lane: 1 },
        { tone: 'shade', levels: envelope(0, 0), lane: 2 },
      ];
  }
}

function Bars({ layer }: { readonly layer: Layer }) {
  const { tone, levels, lane } = layer;
  return (
    <>
      {levels.map((level, at) => {
        const x = at * PITCH + (PITCH - BAR_WIDTH) / 2;
        const played = at < PLAYED;
        const height = lane === undefined ? level * HALF_HEIGHT * 2 : level * LANE.height;
        const y =
          lane === undefined
            ? VIEW.height / 2 - height / 2
            : LANE.top + lane * LANE.pitch + LANE.height - height;
        return (
          <rect
            key={at}
            x={x}
            y={y}
            width={BAR_WIDTH}
            height={height}
            rx={BAR_WIDTH / 2}
            className={`${styles[tone]} ${played ? styles.played : styles.idle}`}
          />
        );
      })}
    </>
  );
}

/**
 * 波形渲染模式缩略图
 *
 * 采用固定合成包络绘制模拟竖线波形，高亮已播放区段并附带播放头，直观展示单层、阴影叠画或多道分层的视觉层次
 */
export function WaveformThumb({ mode }: { readonly mode: WaveformThumbMode }) {
  return (
    <svg
      className={styles.root}
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      data-waveform={mode}
      aria-hidden
      focusable="false"
    >
      {layersOf(mode).map((layer) => (
        <Bars key={`${layer.tone}-${layer.lane ?? 'mid'}`} layer={layer} />
      ))}
      <line
        className={styles.head}
        x1={PLAYED * PITCH}
        x2={PLAYED * PITCH}
        y1={0}
        y2={VIEW.height}
      />
    </svg>
  );
}
