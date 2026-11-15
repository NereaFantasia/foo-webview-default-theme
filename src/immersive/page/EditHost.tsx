import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { usePresence } from '../../kit/usePresence.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { DURATION_MS } from '../../motion/timing.ts';
import { useControlSlots } from '../scene/sceneContext.ts';
import { EditBar } from './EditBar.tsx';
import { EditCard } from './EditCard.tsx';
import {
  cancelEdit,
  chooseEditCategory,
  editCategoryAtom,
  editOpenAtom,
  finishEdit,
  type SwitchPreset,
} from './editSession.ts';

/** 编辑里的一个分类：标识、名字、卡片停哪边、画面上描哪个元素、卡片里的内容 */
export interface EditSpec {
  readonly id: string;
  readonly label: MessageKey;
  readonly dock: 'start' | 'end';
  /** 元素根上 `data-edit-target` 的值；不给就不描 */
  readonly target?: string;
  readonly content: ReactNode;
}

/** 画面上那一层（拦截、描框、拖柄）要的东西 */
export interface EditLayerProps {
  readonly categories: readonly EditSpec[];
  readonly current: EditSpec;
  /** 拖柄拖动开始与结束时叫：拖动时卡片整张让位 */
  readonly onDragging: (dragging: boolean) => void;
  /** 卡片里正按住滑块：描框、名字与能拖的线都藏起，画面上只剩那一行 */
  readonly quiet: boolean;
  readonly leaving: boolean;
}

/** 进出编辑的退场时长：编辑条与卡片淡出，减弱动效时直接卸 */
const LEAVE_MS = DURATION_MS.fast;

/**
 * 一个场景的设置编辑：编辑条经控制层的 `edit` 挂载点放到顶部正中，卡片放在场景里，画面上那一层由场景给（`layer`）
 *
 * 分类由场景按自己与当前预设给出，第一个是「视图」；停留的分类不在表里时（换了视图样式或预设）退回第一个。
 * 进入时焦点落到编辑条上选中的页签（设置键随即藏起，焦点不能留在它上面）；退出时焦点回到视图的根元素。
 * 「取消」经 `switchPreset` 写回预设，场景给了就带场景过渡
 */
export function EditHost({
  categories,
  switchPreset,
  layer,
}: {
  readonly categories: readonly [EditSpec, ...EditSpec[]];
  readonly switchPreset?: SwitchPreset;
  readonly layer?: (props: EditLayerProps) => ReactNode;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const open = useAtomValueRawSync(editOpenAtom);
  const stored = useAtomValueRawSync(editCategoryAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const presence = usePresence(open, reduced ? 0 : LEAVE_MS);
  const slots = useControlSlots();
  const [dragging, setDragging] = useState(false);
  const [holding, setHolding] = useState(false);
  // 拖拖柄、按住滑块的途中按 Esc 退出编辑，放手的那一下不会再来，两个标记没人放下：退出时清掉，下次进来卡片与拖柄照常
  if (!open && (dragging || holding)) {
    setDragging(false);
    setHolding(false);
  }
  useFocusHandoff(open && presence.mounted, slots?.edit ?? null);
  if (!presence.mounted) return null;
  const current = categories.find((category) => category.id === stored) ?? categories[0];
  const leaving = presence.phase === 'leave';
  const bar = (
    <EditBar
      categories={categories.map((category) => ({ id: category.id, label: t(category.label) }))}
      value={current.id}
      onSelect={(id) => chooseEditCategory(store, id)}
      onCancel={() => cancelEdit(store, switchPreset)}
      onDone={() => finishEdit(store)}
      leaving={leaving}
    />
  );
  return (
    <>
      {slots?.edit && createPortal(bar, slots.edit)}
      {layer?.({ categories, current, onDragging: setDragging, quiet: holding, leaving })}
      <EditCard
        key={current.dock}
        id={current.id}
        dock={current.dock}
        label={t(current.label)}
        yielded={dragging}
        leaving={leaving}
        onHolding={setHolding}
      >
        {current.content}
      </EditCard>
    </>
  );
}

/**
 * 焦点交接：编辑条挂上之后落到它上面选中的页签（设置键随即藏起，焦点不能留在它上面），
 * 退出编辑后回到视图的根元素，与刚进视图时一样：这时再按 Esc 就是离开视图，不会先被某颗键的提示收走
 *
 * `shown` 要等编辑条真的在 DOM 里了才为真（进场驻留晚一次渲染才挂上）。只在焦点此刻落在 body、视图根元素或编辑件里时才挪，
 * 用户已经把焦点放到别处（比如底下的页面）时不抢
 */
function useFocusHandoff(shown: boolean, slot: HTMLElement | null) {
  const last = useRef(shown);
  // 提交之后当场交接，不等下一帧：编辑条的 Portal 已经在 DOM 里了，等一帧的空当里按下的 Esc 会落在已经藏起的设置键上
  useLayoutEffect(() => {
    if (last.current === shown) return;
    last.current = shown;
    const active = document.activeElement;
    const loose =
      active === null ||
      active === document.body ||
      active.matches('[data-immersive-view]') ||
      active.closest('[data-settings-key], [data-edit-bar], [data-edit-card]') !== null;
    if (!loose) return;
    // 窄窗时页签藏起，落到写着当前分类的菜单键上
    const candidates = shown
      ? [
          slot?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'),
          slot?.querySelector<HTMLElement>('[data-edit-category-menu]'),
        ]
      : [document.querySelector<HTMLElement>('[data-immersive-view]')];
    candidates.find((element) => element && element.getClientRects().length > 0)?.focus();
  }, [shown, slot]);
}
