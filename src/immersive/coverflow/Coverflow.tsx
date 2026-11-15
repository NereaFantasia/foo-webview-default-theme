import { useAtomValueRawSync, useStore } from 'jotai/react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type WheelEvent,
} from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { playbackKey } from '../../playback/playbackContract.ts';
import { pathOf } from '../../playback/queue/queueMenu.ts';
import type { RowPoint } from '../../playback/queue/QueueRow.tsx';
import { queueKey } from '../../playback/queue/queueServices.ts';
import { upEarlierAtom, upNextAtom } from '../../playback/queue/upNext.ts';
import { createWheelStepper } from '../../playback/volume/wheelSteps.ts';
import { coverflowItemsAtom } from '../scene/coverflowAtoms.ts';
import { currentIndexOf, selectedIndexOf } from '../scene/coverflowItems.ts';
import { SCENE_COVER_LAYER } from '../scene/coverHolders.ts';
import { sceneStateAtom } from '../scene/sceneActions.ts';
import { useSceneActions, useSceneFrame } from '../scene/sceneContext.ts';
import { useCoverHolder } from '../scene/useCoverHolder.ts';
import styles from './Coverflow.module.css';
import { CoverflowCard, coverRequestSizes } from './CoverflowCard.tsx';
import { CoverflowMenu } from './CoverflowMenu.tsx';
import { createCoverflowEngine, type EngineCard, type EngineClock } from './engine.ts';
import { menuTargetOf, type CoverflowMenuTarget } from './menuTarget.ts';
import { playPlanOf, type PlayPlan } from './playPlan.ts';
import { RENDER_RADIUS, coverflowLayout, inViewRange, visibleIndexes } from './slots.ts';
import { useSettledItems } from './useSettledItems.ts';

/** 无交互自动回位至当前播放曲目的超时时间（毫秒） */
const IDLE_MS = 3000;
/** 前向预读深度增量；除两侧基础视界外，为补间动画预留额外缓冲卡片 */
const EARLIER_AHEAD = RENDER_RADIUS * 2;

const browserClock: EngineClock = {
  now: () => performance.now(),
  frame(callback) {
    const handle = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(handle);
  },
};

export interface CoverflowProps {
  /** 模式退出退场状态；退场期间释放共享封面标识与按键捕获，当前曲目即刻隐藏，其余卡片在 167 ms 内淡出 */
  readonly leaving?: boolean;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * Coverflow 封面流交互容器
 *
 * 以当前焦点项为视心中轴，两侧卡片按槽位规格递减缩放、渐隐与偏转；左侧为历史已播序列，右侧为队列与接下来曲目；
 * 支持方向键、滚轮与点击卡片切换焦点；Enter 或点击视心卡片触发播放（若处于当前播放曲目则切换播放/暂停）；
 * 闲置 3 秒自动回位至正在播放曲目，Esc 优先回位、再次触发退出模式；动效调度解耦于独立引擎
 */
export function Coverflow({ leaving = false }: CoverflowProps) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const frame = useSceneFrame();
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const earlier = useAtomValueRawSync(upEarlierAtom);
  const upNext = useAtomValueRawSync(upNextAtom);
  const items = useSettledItems(
    useAtomValueRawSync(coverflowItemsAtom),
    earlier.refreshing || upNext.refreshing,
  );
  const { browsed } = useAtomValueRawSync(sceneStateAtom);
  const sceneActions = useSceneActions();
  const queue = useService(queueKey);
  const playback = useService(playbackKey);
  const holder = useCoverHolder(SCENE_COVER_LAYER);
  const baseId = useId();
  const root = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const settle = useRef<() => void>(() => {});
  const [engine] = useState(() =>
    createCoverflowEngine(browserClock, { onSettle: () => settle.current() }),
  );
  const [stepper] = useState(createWheelStepper);
  const [menu, setMenu] = useState<CoverflowMenuTarget | null>(null);
  const selected = selectedIndexOf(items, browsed);
  const layout = coverflowLayout(frame);
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  const sizes = coverRequestSizes(layout.cover, ratio);
  // 选中项与当前播放曲目重合或键已失效时视为默认状态，Esc 无需二次回位
  const currentAt = currentIndexOf(items);
  // 仅当当前播放曲目位于视口时赋予共享封面标识，以便退出时执行位置飞移；若已移出视口则释放标识，退出时走淡入淡出过渡
  const nameInView = currentAt >= 0 && inViewRange(currentAt - selected);
  useEffect(() => {
    if (browsed !== null && selected === currentAt) sceneActions.browse(null);
  }, [browsed, selected, currentAt, sceneActions]);
  // 沿列表顺序浏览历史曲目时，按浏览深度动态向前预读缓存数据
  const depth = Math.max(0, currentAt - selected);
  useEffect(() => {
    if (earlier.total <= 0) return;
    const wanted = depth + EARLIER_AHEAD;
    void queue.upNext.readEarlier(Math.max(0, earlier.total - wanted), earlier.total - 1);
  }, [queue, earlier.total, earlier.version, earlier.refreshing, depth]);
  // 补间过渡期间的可见渲染跨度（首尾两端可见窗口并集）
  const [span, setSpan] = useState({ from: selected, to: selected });
  const indexes = visibleIndexes(span.from, span.to, items.length);

  const attach = useCallback((key: string, element: HTMLElement | null) => {
    if (element) elements.current.set(key, element);
    else elements.current.delete(key);
  }, []);

  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touch = () => {
    clearTimeout(idleTimer.current);
    if (store.get(sceneStateAtom).browsed === null) return;
    idleTimer.current = setTimeout(() => sceneActions.browse(null), IDLE_MS);
  };
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  useEffect(() => {
    if (browsed === null) clearTimeout(idleTimer.current);
  }, [browsed]);

  const selectedNow = () =>
    selectedIndexOf(store.get(coverflowItemsAtom), store.get(sceneStateAtom).browsed);
  const selectIndex = (index: number) => {
    const list = store.get(coverflowItemsAtom);
    const item = list[Math.min(list.length - 1, Math.max(0, index))];
    if (!item) return;
    // 选中当前播放曲目时清除显式浏览状态，保持与默认视心一致
    sceneActions.browse(item.kind === 'current' ? null : item.key);
    touch();
  };
  const step = (delta: number) => selectIndex(selectedNow() + delta);

  const perform = (plan: PlayPlan): Promise<boolean> => {
    if (plan.kind === 'handle') return queue.commands.playHandle(plan.handle);
    if (plan.kind === 'queue') return queue.actions.playNow(plan.entry);
    const { list, refreshing } = store.get(plan.source === 'earlier' ? upEarlierAtom : upNextAtom);
    if (refreshing || list?.guid !== plan.guid) return Promise.resolve(false);
    return queue.commands.playFrom(plan.guid, plan.row, plan.handle);
  };
  /** 播放当前选中项；toggle 控制当前焦点与播放曲目重合时是否切换暂停状态 */
  const play = async (toggle: boolean) => {
    const item = store.get(coverflowItemsAtom)[selectedNow()];
    if (!item) return;
    if (item.kind === 'current') {
      if (toggle && item.track) void playback.playOrPause();
      return;
    }
    const plan = playPlanOf(item);
    // 起播成功后暂存选中状态，避免数据表尚未响应切歌前视心回弹至旧曲目位置；待数据表更新且该曲目转为当前曲目后，由联动副作用重置浏览状态；起播失败时保留选中位置
    if (plan) await perform(plan);
  };
  const activate = (key: string) => {
    const at = store.get(coverflowItemsAtom).findIndex((item) => item.key === key);
    if (at < 0) return;
    if (at === selectedNow()) void play(true);
    else selectIndex(at);
  };
  // 右键呼出上下文菜单时不改变当前焦点选中项
  const openMenu = (key: string, at: RowPoint) => {
    const list = store.get(coverflowItemsAtom);
    const item = list.find((entry) => entry.key === key);
    const track = item?.track;
    if (leaving || !item || !track) return;
    const plan = playPlanOf(item);
    const target = menuTargetOf(item, list, at, () => {
      if (plan) void perform(plan);
      else void queue.commands.playHandle(track.handle);
    });
    if (!target) return;
    setMenu(target);
    void queue.menu.prepare([pathOf(track)]);
  };

  const inside = () => root.current?.contains(document.activeElement) ?? false;
  const listening = () => !leaving && inside();
  useCommand({
    id: 'immersive.coverflow.previous',
    layer: 'widget',
    keys: [{ key: 'ArrowLeft' }],
    enabled: listening,
    run: () => step(-1),
  });
  useCommand({
    id: 'immersive.coverflow.next',
    layer: 'widget',
    keys: [{ key: 'ArrowRight' }],
    enabled: listening,
    run: () => step(1),
  });
  useCommand({
    id: 'immersive.coverflow.play',
    layer: 'widget',
    keys: [{ key: 'Enter' }],
    enabled: listening,
    run: () => void play(false),
  });
  useCommand({
    id: 'immersive.coverflow.menu',
    layer: 'widget',
    keys: [{ key: 'ContextMenu' }, { key: 'F10', shift: true }],
    enabled: listening,
    run: () => {
      const item = store.get(coverflowItemsAtom)[selectedNow()];
      const box = item && elements.current.get(item.key)?.getBoundingClientRect();
      if (item && box) openMenu(item.key, { x: box.left + box.width / 2, y: box.bottom });
    },
  });
  // 注册于 gesture 命令层，优先级高于外壳 overlay 退出层
  useCommand({
    id: 'immersive.coverflow.reset',
    layer: 'gesture',
    keys: [{ key: 'Escape' }],
    enabled: () => !leaving && store.get(sceneStateAtom).browsed !== null,
    run: () => sceneActions.browse(null),
  });

  // 每次渲染提交将最新卡片映射与舞台规格同步至底层动效引擎
  useLayoutEffect(() => {
    const cards: EngineCard[] = [];
    for (const index of indexes) {
      const item = items[index];
      const element = item && elements.current.get(item.key);
      if (item && element) {
        cards.push({ key: item.key, index, element, current: item.kind === 'current' });
      }
    }
    engine.setCards(cards);
    engine.setGeometry({
      width: frame.width,
      cover: layout.cover,
      spread: layout.spread,
      perspective: layout.perspective,
    });
    engine.setVisible(frame.visible);
    engine.setReduced(reduced);
  });
  // 焦点或条目序列变更时触发补间位移
  const prior = useRef<{ keys: readonly string[]; selected: number } | null>(null);
  useLayoutEffect(() => {
    settle.current = () => setSpan({ from: selected, to: selected });
    const keys = items.map((item) => item.key);
    const before = prior.current;
    prior.current = { keys, selected };
    // 退场期间保持视心位置固定，避免关闭模式时因重置为当前曲目而产生滚动
    if (leaving && before) return;
    if (!before) {
      engine.jumpTo(selected);
      if (!leaving) engine.enter(selected);
    } else if (!sameKeys(before.keys, keys)) {
      engine.rekey(before.keys, keys, selected);
      setSpan({ from: engine.position(), to: selected });
    } else if (before.selected !== selected) {
      const from = engine.position();
      // 继承当前动量滑向目标；长距回位（如超时重置）保持恒定过渡时长
      engine.goTo(selected);
      setSpan({ from, to: selected });
    }
  }, [engine, items, selected, leaving]);
  // 提交后重绘以避免新挂载卡片首帧位置闪烁
  useLayoutEffect(() => {
    engine.paint();
  });
  useLayoutEffect(() => {
    if (!leaving) return;
    engine.leave();
    engine.paint();
  }, [leaving, engine]);
  useEffect(() => () => engine.dispose(), [engine]);
  // 进入模式后将焦点转移至舞台容器以拦截方向键
  useLayoutEffect(() => root.current?.focus({ preventScroll: true }), []);

  const style: CSSProperties & Record<`--${string}`, string> = {
    '--cf-cover': `${layout.cover}px`,
    '--cf-top': `${layout.top}px`,
  };
  return (
    <>
      <div
        ref={root}
        className={styles.root}
        style={style}
        role="listbox"
        tabIndex={0}
        aria-label={t('immersive.coverflow')}
        aria-activedescendant={`${baseId}-${selected}`}
        data-scene-element="coverflow"
        data-key-pass
        onWheel={(event: WheelEvent) => {
          const steps = stepper(event);
          if (steps !== 0) step(-steps);
        }}
      >
        {indexes.map((index) => {
          const item = items[index];
          if (!item) return null;
          return (
            <CoverflowCard
              key={item.key}
              item={item}
              id={`${baseId}-${index}`}
              selected={index === selected}
              sizes={sizes}
              distant={Math.abs(index - selected) > 1}
              attach={attach}
              holder={item.kind === 'current' && !leaving && nameInView ? holder : undefined}
              onActivate={activate}
              onMenu={openMenu}
            />
          );
        })}
      </div>
      {/* 脱离列表容器渲染，阻断菜单内部点击与滚轮事件冒泡至封面流 */}
      {menu && <CoverflowMenu target={menu} onClose={() => setMenu(null)} />}
    </>
  );
}
