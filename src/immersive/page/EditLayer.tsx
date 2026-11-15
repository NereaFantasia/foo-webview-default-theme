import { useAtomValueRawSync, useStore } from 'jotai/react';
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type SVGProps,
  type WheelEvent,
} from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { PresetEntry } from '../presets/presets.ts';
import {
  settleValue,
  type EditHandle,
  type EditHandles,
  type EditTarget,
  type HandleGuide,
  type Point,
  type Size,
} from '../scene/editHandles.ts';
import { mergeOptions, withStoredOption, type StoredOptions } from '../scene/presetOptions.ts';
import { useSceneFrame } from '../scene/sceneContext.ts';
import { presetOptionsPref } from '../scene/scenePrefs.ts';
import { chooseEditCategory } from './editSession.ts';
import type { EditLayerProps } from './EditHost.tsx';
import styles from './EditLayer.module.css';
import { hitTarget, useTargets } from './editTargets.ts';
import { withoutOptions, writePresetOptions } from './PresetSections.tsx';

/** 元素边界框标注标签映射表 */
const TARGET_LABELS: Readonly<Record<string, MessageKey>> = {
  cover: 'immersive.edit.target.cover',
  capsule: 'immersive.group.capsule',
};

const NONE: EditHandles = { handles: [], gestures: [] };
const EMPTY: StoredOptions = {};

/** 标签高度（字号 200 行高加内边距）及与线框间距：上方空间充足时外置呈现 */
const NAME_HEIGHT = 20;
const NAME_GAP = 6;

/**
 * 边界线框与标签：`hover` 为非当前分类的悬停元素，显示淡色线框。`current` 为当前分类的选中元素，显示强调色细边框。
 * `name` 为已呈现调节参考线的当前分类元素，仅展示名称标签而不重复绘制边框
 *
 * 边框贴合元素的实际边缘与圆角绘制，线位于元素内侧。贴着或超出窗口边缘的边推到窗外，不绘制半条线
 */
function Outline({
  target,
  box,
  label,
  tone,
}: {
  readonly target: EditTarget;
  readonly box: Size;
  readonly label: string;
  readonly tone: 'hover' | 'current' | 'name';
}) {
  const { rect, radius } = target;
  const left = rect.x <= 0.5 ? -4 : rect.x;
  const top = rect.y <= 0.5 ? -4 : rect.y;
  const right = rect.x + rect.width >= box.width - 0.5 ? box.width + 4 : rect.x + rect.width;
  const bottom = rect.y + rect.height >= box.height - 0.5 ? box.height + 4 : rect.y + rect.height;
  if (right <= left || bottom <= top) return null;
  const shownLeft = Math.max(left, 0);
  const shownTop = Math.max(top, 0);
  const outside = shownTop >= NAME_HEIGHT + NAME_GAP + 2;
  return (
    <>
      {tone !== 'name' && (
        <div
          className={styles.outline}
          data-tone={tone}
          style={{ left, top, width: right - left, height: bottom - top, borderRadius: radius }}
        />
      )}
      <span
        className={styles.name}
        data-tone={tone}
        style={
          outside
            ? { left: shownLeft, top: shownTop - NAME_HEIGHT - NAME_GAP }
            : { left: shownLeft + 8, top: shownTop + 8 }
        }
      >
        {label}
      </span>
    </>
  );
}

type GuideEvents = Pick<
  SVGProps<SVGElement>,
  'onPointerEnter' | 'onPointerLeave' | 'onPointerDown' | 'onDoubleClick'
>;

/** 参考线渲染层：支持直线或由 `clip` 裁剪的椭圆弧 */
function Shape({
  guide,
  className,
  clip,
  events,
}: {
  readonly guide: HandleGuide;
  readonly className: string;
  readonly clip: string | undefined;
  readonly events?: GuideEvents;
}) {
  if (guide.kind === 'line') {
    return (
      <line
        className={className}
        x1={guide.from.x}
        y1={guide.from.y}
        x2={guide.to.x}
        y2={guide.to.y}
        {...events}
      />
    );
  }
  return (
    <ellipse
      className={className}
      cx={guide.center.x}
      cy={guide.center.y}
      rx={guide.rx}
      ry={guide.ry}
      clipPath={clip && `url(#${clip})`}
      {...events}
    />
  );
}

/**
 * 预设配置可视化编辑图层：接管指针交互，绘制元素边界框、交互式调节参考线与数值悬浮读数
 *
 * 指针悬停至可编辑元素时显示淡色线框与标签，点击切换到以它为目标的第一个分类。当前分类元素显示标签，
 * 其可调整的维度与边距通过几何参考线呈现（`PresetEntry.handles`）。参考线平时呈虚线，悬停或拖拽时转为强调色实线，
 * 光标自动切换为水平或垂直调整指示。参考线两侧各 6 像素均为有效拖拽响应区，调整值按步长量化并约束在取值区间内，并在发生变更时持久化
 * 双击参考线重置为默认值。在手势目标区域可直接拖拽或滚轮滚动调节（如满幅封面的取景偏移与画面缩放）
 *
 * 拖动调整期间隐藏配置卡片以避让视图，仅保留当前调节参考线与指针旁的数值读数，参考线、边框与文本标签底下都垫一圈淡的深色，亮色封面上也清晰可辨
 * 所有几何参考线集成于单一 SVG 视图中，可视线段与触控响应区域几何参数严格对齐
 * 本图层不获取键盘焦点，对屏幕阅读器隐藏：所有参数均可在配置卡片中通过表单控件无障碍调节
 */
export function EditLayer({
  categories,
  current,
  onDragging,
  leaving,
  quiet,
  preset,
  centered,
}: EditLayerProps & { readonly preset: PresetEntry; readonly centered: boolean }) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const frame = useSceneFrame();
  const layer = useRef<HTMLDivElement>(null);
  const targets = useTargets(layer);
  const stored = useAtomValueRawSync(presetOptionsPref.atom)[preset.id] ?? EMPTY;
  const values = useMemo(() => mergeOptions(preset.schema, stored), [preset.schema, stored]);
  const box = useMemo(
    () => ({ width: frame.width, height: frame.height }),
    [frame.width, frame.height],
  );
  const plan = useMemo(
    () => preset.handles?.({ box, centered, values, targets }) ?? NONE,
    [preset, box, centered, values, targets],
  );
  const handles = plan.handles.filter((handle) => handle.group === current.id);
  const gesture = plan.gestures.find((candidate) => candidate.group === current.id);
  const [hover, setHover] = useState<string | null>(null);
  /** 指针当前停留的参考线标识。拖拽中的参考线单独跟踪，拖拽过程中指针移出参考线仍保持捕获 */
  const [over, setOver] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [readout, setReadout] = useState<{ readonly text: string; readonly at: Point } | null>(
    null,
  );

  const items = preset.panel.flatMap((group) => group.items);
  const describe = (next: Readonly<Record<string, number>>) =>
    Object.entries(next)
      .map(([key, value]) => {
        const item = items.find((candidate) => candidate.key === key);
        return item ? `${t(item.label)} ${value}${item.unit ?? ''}` : '';
      })
      .filter(Boolean)
      .join(' · ');

  /** 按步长取整、约束到有效区间后写入存储。返回取整后的值，读数使用它 */
  const write = (raw: Readonly<Record<string, number>>): Record<string, number> => {
    const latest = store.get(presetOptionsPref.atom)[preset.id] ?? EMPTY;
    let next = latest;
    const settled: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      const spec = Object.hasOwn(preset.schema, key) ? preset.schema[key] : undefined;
      settled[key] = settleValue(spec, value);
      next = withStoredOption(preset.schema, next, key, settled[key]);
    }
    if (next !== latest) writePresetOptions(store, preset, next);
    return settled;
  };

  const toScene = (event: { readonly clientX: number; readonly clientY: number }): Point => {
    const origin = layer.current?.getBoundingClientRect();
    return { x: event.clientX - (origin?.left ?? 0), y: event.clientY - (origin?.top ?? 0) };
  };

  /** 启动指针拖拽交互：`key` 为当前调节的参考线标识，自由手势交互时不指定标识 */
  const track = (
    event: PointerEvent<Element>,
    apply: (point: Point) => Readonly<Record<string, number>>,
    key: string | null,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    onDragging(true);
    setHeld(key);
    // 拖拽目标可能为 SVG 图元（Element 类型），手动收窄类型以获取指针坐标
    const move = (next: Event) => {
      if (!(next instanceof MouseEvent)) return;
      const point = toScene(next);
      setReadout({ text: describe(write(apply(point))), at: point });
    };
    const end = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      element.removeEventListener('lostpointercapture', end);
      onDragging(false);
      setHeld(null);
      setReadout(null);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', end);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const hit = hitTarget(targets, toScene(event));
    if (gesture && hit === gesture.target) {
      const start = toScene(event);
      const captured = gesture;
      track(event, (point) => captured.drag({ x: point.x - start.x, y: point.y - start.y }), null);
      return;
    }
    const category = categories.find((candidate) => hit !== null && candidate.target === hit);
    if (category) chooseEditCategory(store, category.id);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!gesture || event.deltaY === 0 || hitTarget(targets, toScene(event)) !== gesture.target)
      return;
    write(gesture.wheel(event.deltaY < 0 ? 1 : -1));
  };

  const eventsOf = (handle: EditHandle): GuideEvents => ({
    onPointerEnter: () => setOver(handle.key),
    onPointerLeave: () => setOver((last) => (last === handle.key ? null : last)),
    onPointerDown: (event) =>
      track(event, (point) => ({ [handle.key]: handle.value(point) }), handle.key),
    onDoubleClick: () => writePresetOptions(store, preset, withoutOptions(stored, [handle.key])),
  });

  const dragging = readout !== null;
  const active = held ?? over;
  // 拖动时只绘制正在拖动的那条线。取景时一条也不绘制
  const shown = dragging ? handles.filter((handle) => handle.key === held) : handles;
  const selected = current.target ? targets[current.target] : undefined;
  const hovered = hover && hover !== current.target && !over ? targets[hover] : undefined;
  const busy = quiet || dragging;
  return (
    <div
      ref={layer}
      className={styles.layer}
      aria-hidden
      data-edit-layer
      data-leaving={leaving || undefined}
      data-pan={(gesture && hover === gesture.target && !over) || undefined}
      onPointerMove={(event) => setHover(hitTarget(targets, toScene(event)))}
      onPointerLeave={() => setHover(null)}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
    >
      {!busy && selected && current.target && (
        <Outline
          target={selected}
          box={box}
          label={t(TARGET_LABELS[current.target] ?? 'immersive.settings')}
          tone={handles.length > 0 ? 'name' : 'current'}
        />
      )}
      {!busy && hovered && hover && (
        <Outline
          target={hovered}
          box={box}
          label={t(TARGET_LABELS[hover] ?? 'immersive.settings')}
          tone="hover"
        />
      )}
      {!quiet && (
        <svg className={styles.guides} width={box.width} height={box.height}>
          {shown.map((handle) => (
            <g
              key={handle.key}
              data-handle={handle.key}
              data-axis={handle.axis}
              data-active={active === handle.key || undefined}
            >
              {handle.guides.map((guide, index) => {
                const clip =
                  guide.kind === 'ellipse' ? `edit-clip-${handle.key}-${index}` : undefined;
                return (
                  <g key={index}>
                    {guide.kind === 'ellipse' && clip && (
                      <clipPath id={clip}>
                        <rect
                          x={guide.clip.x}
                          y={guide.clip.y}
                          width={guide.clip.width}
                          height={guide.clip.height}
                        />
                      </clipPath>
                    )}
                    <Shape guide={guide} className={styles.halo} clip={clip} />
                    <Shape guide={guide} className={styles.stroke} clip={clip} />
                    <Shape
                      guide={guide}
                      className={styles.hit}
                      clip={clip}
                      events={eventsOf(handle)}
                    />
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      )}
      {readout && (
        <span className={styles.readout} style={{ left: readout.at.x, top: readout.at.y }}>
          {readout.text}
        </span>
      )}
    </div>
  );
}
