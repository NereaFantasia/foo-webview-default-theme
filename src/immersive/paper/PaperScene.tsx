import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useMemo, useRef } from 'react';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { PaperDecor } from '../decor/PaperDecor.tsx';
import { useDecorGuards } from '../decor/useDecorGuards.ts';
import { immersiveTerrainAtom, immersiveWashAtom } from '../page/immersivePrefs.ts';
import { ALPHA_FAR } from '../terrain/terrain.ts';
import { TerrainCanvas } from '../terrain/TerrainCanvas.tsx';
import { TerrainRuler } from '../terrain/TerrainRuler.tsx';
import { PaperCoverWash } from '../wash/PaperCoverWash.tsx';
import { paperGeometry } from './paperTiers.ts';
import styles from './PaperScene.module.css';
import { PaperSheet } from './PaperSheet.tsx';
import { PaperStage } from './PaperStage.tsx';
import { reportSceneTier } from './sceneTier.ts';
import { useSceneSize } from './useSceneSize.ts';

/**
 * 仪表图纸场景：铺满整个视图的纸面，定义各件共用的纸面变量，再按容器尺寸放背景各层与内容层。
 *
 * 内容层随容器分六档（`paperTiers.ts`，档名写在 `data-tier` 上）：full 是 1920 × 1080 的舞台，整幅等比缩放、
 * 居中（`PaperStage`）；其余五档按原 1280 × 800 版心的几何排、不缩放文字（`PaperSheet`）：compact 左环右表、
 * 罗盘件缩到 0.8，narrow 单栏，竖版三档上环下表。内容层之外多出来的由背景铺满。档位每次变了报给
 * `sceneTier.ts`，取数服务按它决定要不要舞台才用的数据。
 *
 * 纸面变量：数据墨与热色直接取品牌 token，随封面 ramp 换；染色与垫纸由品牌色与中性底 `color-mix` 出来，
 * 深色档只换两个百分数。canvas 件读不到 CSS 变量，各自按 token 名现读。
 *
 * 背景自下而上：纸面染色（根底色）→ 封面底色（罗盘封面的模糊放大，偏好关掉时不挂）→ 山脊图（只描边，
 * 偏好关掉时不挂；竖版三档里沉到底部）→ 生成式网格 → 山脊图底边的频段标尺（只在 full 档，别的档里版心底部
 * 会压上来）→ 内容层。网格的护区取内容层里标了 `data-decor-guard` 的元素盒子（`useDecorGuards`），格线对齐
 * 内容层原点，三段弧随档位挪；舞台上格子、护区与弧跟着缩放，记号按网页版像素换算。
 */
export function PaperScene() {
  const store = useStore();
  const root = useRef<HTMLDivElement>(null);
  const { width, height } = useSceneSize(root);
  const dark = useAtomValueRawSync(colorSchemeAtom) === 'dark';
  const wash = useAtomValueRawSync(immersiveWashAtom) !== 'off';
  const terrain = useAtomValueRawSync(immersiveTerrainAtom);
  const geometry = useMemo(() => paperGeometry(width, height), [width, height]);
  const { tier, origin, scale } = geometry;
  const stage = tier === 'full';
  const guards = useDecorGuards(root, { origin, scale, tier });

  // 换档只报新档，不在两档之间插一个 null：取数服务会把它当成不要了，停掉手上的解码。
  useEffect(() => {
    reportSceneTier(store, tier);
  }, [store, tier]);
  useEffect(() => () => reportSceneTier(store, null), [store]);

  return (
    <div ref={root} className={styles.paper} data-tier={tier} data-dark={dark || undefined}>
      {wash && <PaperCoverWash />}
      {terrain && (
        <TerrainCanvas
          className={geometry.sunkTerrain ? styles.sunk : undefined}
          alphaNear={ALPHA_FAR}
          alphaFar={ALPHA_FAR}
        />
      )}
      <PaperDecor
        guards={guards}
        origin={origin}
        sheet={geometry.sheet}
        arcs={geometry.arcs}
        scale={scale}
        unit={stage ? scale : undefined}
      />
      {terrain && stage && <TerrainRuler />}
      {stage ? <PaperStage scale={scale} origin={origin} /> : <PaperSheet geometry={geometry} />}
    </div>
  );
}
