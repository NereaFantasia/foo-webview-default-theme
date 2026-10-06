import { useAtomValueRawSync, useStore } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { DURATION_MS } from '../../motion/timing.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import type { ColorScheme } from '../../theme/themes.ts';
import { coverRampAtom as accentRampAtom } from '../../theme/accentState.ts';
import { rgbaOf } from '../frame/cssColor.ts';
import { immersiveWashAtom } from '../page/immersivePrefs.ts';
import { coverSourceAtom } from './coverSource.ts';
import { PaperCoverFlow } from './PaperCoverFlow.tsx';
import { PaperCoverStatic } from './PaperCoverStatic.tsx';
import styles from './PaperCoverWash.module.css';
import { offer, retire, reveal, type WashLayer, type WashLayerState } from './washLayers.ts';
import { flowUnavailableAtom, markFlowUnavailable, washModeOf } from './washMode.ts';

type Linear = readonly [number, number, number];

// 只关心在不在播：每 100 ms 一次的进度更新不叫醒这一层。
const playingAtom = atom((get) => get(playbackAtom).state === 'playing');

/** 封面混进纸面的比例：深色纸面上同样的比例显得更艳，降一档。 */
const WASH_STRENGTH: Readonly<Record<ColorScheme, number>> = { light: 0.5, dark: 0.4 };
/** 撤旧层比淡入淡出多等这么久（毫秒），让新层最后一帧落定再撤，免得露出一帧纸面色。 */
const SETTLE_MS = 50;
/** 纸面色的初值；挂载时在第一层挂上之前就读到真值，这个值画不出来。 */
const NO_PAPER: Linear = [0, 0, 0];

/** 被盖住的旧层保持不透明，新层在它之上淡入；待显与淡出中的层透明。 */
const HIDDEN_CLASS = styles.layer;
const VISIBLE_CLASS = `${styles.layer} ${styles.visible}`;
const LAYER_CLASS: Readonly<Record<WashLayerState, string>> = {
  pending: HIDDEN_CLASS,
  shown: VISIBLE_CLASS,
  covered: VISIBLE_CLASS,
  leaving: HIDDEN_CLASS,
};

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** 算好的颜色（可能是 `oklab()`、`color()` 这类写法）换成线性光的三个分量。 */
function linearOf(css: string): Linear {
  const [red, green, blue] = rgbaOf(css);
  return [toLinear(red), toLinear(green), toLinear(blue)];
}

/**
 * 图纸的封面底色：当前封面贴在一张慢慢变形的网格上、重度模糊后铺满场景（画法见 `coverWarp.ts`），压在纸面染色之上、
 * 山脊图之下。颜色直接来自封面，形状被变形与模糊打散，认不出人脸与文字。偏好选了「关」时上层不挂这一件。
 *
 * 两档（`washMode.ts`）：WebGL 可用时是流动档（`PaperCoverFlow`），只在播放时流动、暂停定格；WebGL 不可用、跑不动、
 * 开了减弱动效或偏好选了静态档时是静态档（`PaperCoverStatic`）。流动档出过一次问题，本次运行里就一直用静态档。
 *
 * 画面不透明、自己混入纸面色：纸面色是 `--paper-tint` 算好的值换成线性光，比例按深浅取 `WASH_STRENGTH`，封面 ramp
 * 与深浅变了都重读。源图跟着罗盘那份封面走（`coverSource.ts`），下一首是同一张图时身份不变，底色层照留。
 *
 * 换层按 `washLayers.ts`：新源图先挂成不可见的一层，画出第一帧才在旧层之上淡入（`--motion-faster`，线性），
 * 淡入走完再撤旧层；没有新封面时现有的层淡出。减弱动效下过渡缩到 1 ms，同样等落定一帧再撤。
 */
export function PaperCoverWash() {
  const store = useStore();
  const source = useAtomValueRawSync(coverSourceAtom);
  const choice = useAtomValueRawSync(immersiveWashAtom);
  const unavailable = useAtomValueRawSync(flowUnavailableAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const playing = useAtomValueRawSync(playingAtom);
  const ramp = useAtomValueRawSync(accentRampAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const mode = washModeOf(reduced, unavailable, choice === 'static');
  const strength = WASH_STRENGTH[scheme];
  // 减弱动效下过渡是 1 ms，也等新层落定一帧再撤，免得撤旧层跑在新层显出来之前。
  const retireMs = (reduced ? 1 : DURATION_MS.faster) + SETTLE_MS;
  const root = useRef<HTMLDivElement>(null);
  const [paper, setPaper] = useState<Linear>(NO_PAPER);
  const [layers, setLayers] = useState<WashLayer[]>([]);
  /** 撤层的计时器，按层的 key 记；淡入淡出走完才撤。 */
  const [timers] = useState(() => new Map<string, ReturnType<typeof setTimeout>>());

  // 根元素的 color 取 `--paper-tint`，计算值就是算好的颜色。主题的样式规则在同一次提交里先于各 effect 写进
  // 文档，封面 ramp 或深浅一变，这里现读就是新值。
  // 值没变就留着原来的数组：各层按它重算色场，静态档的逐像素计算不便宜。
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const next = linearOf(getComputedStyle(element).color);
    setPaper((current) =>
      current.every((value, index) => value === next[index]) ? current : next,
    );
  }, [ramp, scheme]);

  useEffect(() => {
    setLayers((current) => offer(current, source, mode));
  }, [source, mode]);

  useEffect(() => {
    for (const { key, state } of layers) {
      if ((state !== 'covered' && state !== 'leaving') || timers.has(key)) continue;
      const timer = setTimeout(() => {
        timers.delete(key);
        setLayers((current) => retire(current, key));
      }, retireMs);
      timers.set(key, timer);
    }
  }, [layers, timers, retireMs]);

  useEffect(
    () => () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
    [timers],
  );

  const show = (key: string): void => setLayers((current) => reveal(current, key));
  const fallBack = (): void => markFlowUnavailable(store);
  return (
    <div ref={root} className={styles.wash} data-wash={mode} aria-hidden>
      {layers.map((layer) =>
        layer.mode === 'flow' ? (
          <PaperCoverFlow
            key={layer.key}
            className={LAYER_CLASS[layer.state]}
            cover={layer.source.image}
            paper={paper}
            strength={strength}
            playing={playing}
            onReady={() => show(layer.key)}
            onFallback={fallBack}
          />
        ) : (
          <PaperCoverStatic
            key={layer.key}
            className={LAYER_CLASS[layer.state]}
            cover={layer.source.image}
            paper={paper}
            strength={strength}
            onReady={() => show(layer.key)}
          />
        ),
      )}
    </div>
  );
}
