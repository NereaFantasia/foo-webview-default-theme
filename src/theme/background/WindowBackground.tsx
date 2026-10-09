import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { windowActivityAtom } from '../../host/windowActivity.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { DURATION_MS } from '../../motion/timing.ts';
import { backdropSolidAtom } from '../backdrop.ts';
import { colorSchemeAtom } from '../colorScheme.ts';
import type { ColorScheme } from '../themes.ts';
import { backgroundImageAtom } from './backgroundImage.ts';
import { BackgroundImageLayers } from './BackgroundImageLayers.tsx';
import { PaletteField } from './PaletteField.tsx';
import { backgroundAppearanceAtom } from './backgroundAppearance.ts';
import {
  backgroundCoverAtom,
  backgroundParametersAtom,
  backgroundSourceAtom,
  type BackgroundSource,
} from './windowBackground.ts';
import styles from './WindowBackground.module.css';

interface BackgroundView {
  readonly source: BackgroundSource;
  readonly scheme: ColorScheme;
  readonly solid: boolean;
  readonly url: string;
  readonly variables: CSSProperties & Record<`--${string}`, string | number>;
}
interface Layer {
  readonly id: number;
  // 退出层沿用切换前的滤镜和遮罩，避免来源变更时旧画面先跳色。
  readonly view: BackgroundView;
}
interface Scene {
  readonly serial: number;
  readonly current: Layer;
  readonly previous: Layer | null;
  readonly phase: 'waiting' | 'fading' | 'steady';
}
const sameSource = (a: BackgroundView, b: BackgroundView) =>
  a.source === b.source && a.solid === b.solid;

function BackgroundLayer({
  layer,
  leaving,
  entering,
  reduced,
  ready,
  element,
}: {
  readonly layer: Layer;
  readonly leaving: boolean;
  readonly entering: boolean;
  readonly reduced: boolean;
  readonly ready: (id: number) => void;
  readonly element: (id: number, node: HTMLDivElement | null) => void;
}) {
  const { id, view } = layer;
  const presented = useCallback(() => ready(id), [ready, id]);
  const register = useCallback((node: HTMLDivElement | null) => element(id, node), [element, id]);
  useLayoutEffect(() => {
    if (view.source === 'material') presented();
  }, [view.source, presented]);
  return (
    <div
      ref={register}
      className={`${styles.root} ${view.solid ? styles.solid : ''} ${view.source === 'material' && !view.solid ? styles.material : ''}`}
      style={view.variables}
      data-window-background={
        leaving || (view.source === 'material' && !view.solid)
          ? undefined
          : view.solid
            ? 'solid'
            : view.source
      }
      data-background-source={view.source}
      data-background-leaving={leaving || undefined}
      data-background-pending={entering || undefined}
      data-scheme={view.scheme}
      aria-hidden="true"
    >
      {view.source !== 'material' && (
        <>
          <div className={styles.art}>
            {view.source === 'palette' ? (
              <PaletteField onReady={presented} />
            ) : (
              <BackgroundImageLayers url={view.url} reduced={reduced} onReady={presented} />
            )}
          </div>
          <div className={styles.shade} data-background-shade />
          <div className={styles.inactive} data-background-inactive />
        </>
      )}
    </div>
  );
}

export function WindowBackground({ solidColor }: { readonly solidColor: string }) {
  const source = useAtomValueRawSync(backgroundSourceAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const solid = useAtomValueRawSync(backdropSolidAtom);
  const parameters = useAtomValueRawSync(backgroundParametersAtom);
  const appearance = useAtomValueRawSync(backgroundAppearanceAtom);
  const cover = useAtomValueRawSync(backgroundCoverAtom);
  const image = useAtomValueRawSync(backgroundImageAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const { focused } = useAtomValueRawSync(windowActivityAtom);
  const view = useMemo<BackgroundView>(
    () => ({
      source,
      scheme,
      solid: source === 'material' && solid,
      url: source === 'cover' ? cover.url : image.url,
      variables: {
        '--theme-background-color': solidColor,
        '--background-saturation': appearance.saturation / 100,
        '--background-exposure': appearance.brightness / 100,
        '--background-blur': `${parameters.blur}px`,
        '--background-shade': parameters.shade / 100,
        '--background-inactive': focused ? 0 : parameters.inactive / 100,
      },
    }),
    [source, scheme, solid, solidColor, cover.url, image.url, appearance, parameters, focused],
  );
  const [scene, setScene] = useState<Scene>(() => ({
    serial: 0,
    current: { id: 0, view },
    previous: null,
    phase: source === 'material' ? 'steady' : 'waiting',
  }));
  const elements = useRef(new Map<number, HTMLDivElement>());
  const register = useCallback((id: number, node: HTMLDivElement | null) => {
    if (node) elements.current.set(id, node);
    else elements.current.delete(id);
  }, []);
  const ready = useCallback((id: number) => {
    setScene((current) =>
      current.current.id === id && current.phase === 'waiting'
        ? { ...current, phase: 'fading' }
        : current,
    );
  }, []);

  if (sameSource(scene.current.view, view)) {
    if (scene.current.view !== view) setScene({ ...scene, current: { ...scene.current, view } });
  } else if (scene.phase !== 'fading') {
    // 未显现的目标可直接换掉；已经开始交接时先完成这一程，再采用最新选择，避免叠层累积。
    const previous = scene.phase === 'waiting' ? scene.previous : scene.current;
    setScene(
      previous && sameSource(previous.view, view)
        ? { ...scene, current: { ...previous, view }, previous: null, phase: 'steady' }
        : {
            serial: scene.serial + 1,
            current: { id: scene.serial + 1, view },
            previous,
            phase: 'waiting',
          },
    );
  }

  const currentId = scene.current.id;
  const previousId = scene.previous?.id;
  const toMaterial = scene.current.view.source === 'material' && !scene.current.view.solid;
  useLayoutEffect(() => {
    if (scene.phase !== 'fading') return;
    const finish = () =>
      setScene((current) =>
        current.current.id === currentId && current.phase === 'fading'
          ? { ...current, previous: null, phase: 'steady' }
          : current,
      );
    const target = elements.current.get(toMaterial ? (previousId ?? -1) : currentId);
    if (!target || reduced) {
      finish();
      return;
    }
    const animation = target.animate(
      toMaterial ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: DURATION_MS.faster,
        easing: 'linear',
        fill: 'forwards',
      },
    );
    void animation.finished.then(finish, () => {});
    return () => animation.cancel();
  }, [scene.phase, currentId, previousId, toMaterial, reduced]);

  return (
    <>
      {scene.previous && (
        <BackgroundLayer
          key={scene.previous.id}
          layer={scene.previous}
          leaving
          entering={false}
          reduced={reduced}
          ready={ready}
          element={register}
        />
      )}
      <BackgroundLayer
        key={scene.current.id}
        layer={scene.current}
        leaving={false}
        entering={scene.phase !== 'steady'}
        reduced={reduced}
        ready={ready}
        element={register}
      />
    </>
  );
}
