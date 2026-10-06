import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { pageTransition, type LayerMotion } from '../motion/pageTransition.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import styles from './CentralView.module.css';
import { historyAtom, type Arrival, type HistoryEntry } from '../nav/navHistory.ts';
import { dropExiting, showEntry, type PageLayer } from './pageLayers.ts';
import { useShellSlots } from './shellSlots.ts';
import { PlaceholderPage } from './PlaceholderPage.tsx';
import { PageEntryContext } from '../nav/usePageSnapshot.ts';

interface Shown {
  readonly entry: HistoryEntry;
  readonly arrival: Arrival | null;
  readonly layers: readonly PageLayer[];
}

/**
 * 在元素上播一组动画，先停掉它身上还在播的（进场没播完就又要离场，或离场没播完就被接回来）。
 * 全部播完兑现 true；被停掉的兑现 false，调用方据此不去移走一层已经被接回来的页面。
 */
function play(element: HTMLElement, motions: readonly LayerMotion[]): Promise<boolean> {
  for (const running of element.getAnimations()) running.cancel();
  const finished = motions.map((item) => element.animate(item.keyframes, item.options).finished);
  return Promise.allSettled(finished).then((results) =>
    results.every((result) => result.status === 'fulfilled'),
  );
}

/**
 * 中央区域：显示历史当前记录的页面，跨页换记录时播页面切换动效。目录内导航复用页面，其他记录分别建层，
 * 离场的旧层留到动画播完才移走，期间不接指针与焦点。
 */
export function CentralView() {
  const { pages } = useShellSlots();
  const history = useAtomValueRawSync(historyAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [shown, setShown] = useState<Shown>(() => ({
    entry: history.entry,
    arrival: null,
    layers: [{ entry: history.entry, place: history.place, exiting: false }],
  }));
  const current = shown.layers.find((layer) => !layer.exiting);
  if (shown.entry !== history.entry || current?.place !== history.place) {
    const layers = showEntry(shown.layers, history.entry, history.place);
    const next = layers.find((layer) => !layer.exiting);
    const reused =
      current && next && (current.identity ?? current.entry) === (next.identity ?? next.entry);
    setShown({
      entry: history.entry,
      arrival: reused ? null : history.arrival,
      layers,
    });
  }

  const elements = useRef(new Map<HistoryEntry, HTMLElement>());
  const played = useRef(shown.entry);
  // 布局阶段起播，新页面画出来的第一帧就在出场位置上。
  useLayoutEffect(() => {
    if (played.current === shown.entry) return;
    played.current = shown.entry;
    const motion =
      shown.arrival && pageTransition(shown.arrival.kind, shown.arrival.direction, reduced);
    for (const layer of shown.layers) {
      const element = elements.current.get(layer.entry);
      if (!layer.exiting) {
        if (element && motion) void play(element, motion.enter);
        else if (element) for (const animation of element.getAnimations()) animation.cancel();
        continue;
      }
      const done = element && motion ? play(element, motion.exit) : Promise.resolve(true);
      void done.then((finished) => {
        if (!finished) return;
        setShown((state) => ({ ...state, layers: dropExiting(state.layers, layer.entry) }));
      });
    }
  }, [shown, reduced]);

  return (
    <div className={styles.root}>
      {shown.layers.map((layer) => {
        const Page = pages[layer.place.id] ?? PlaceholderPage;
        return (
          <div
            key={(layer.identity ?? layer.entry).key}
            ref={(element) => {
              if (!element) return;
              elements.current.set(layer.entry, element);
              return () => {
                elements.current.delete(layer.entry);
              };
            }}
            className={layer.exiting ? `${styles.layer} ${styles.exiting}` : styles.layer}
            inert={layer.exiting}
            aria-hidden={layer.exiting || undefined}
          >
            <PageEntryContext value={layer.entry}>
              <Page place={layer.place} />
            </PageEntryContext>
          </div>
        );
      })}
    </div>
  );
}
