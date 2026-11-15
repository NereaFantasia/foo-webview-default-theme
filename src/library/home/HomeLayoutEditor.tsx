import { Button, MenuItem, MenuList, MenuTrigger, Tooltip } from '@fluentui/react-components';
import {
  Add20Regular,
  Dismiss20Regular,
  ReOrderDotsVertical20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { isOwnSlot, landingIndex, stepSlot } from '../../kit/listReorder.ts';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { useListReorder } from '../../kit/useListReorder.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { useCommand } from '../../nav/useCommand.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import {
  HOME_SECTIONS,
  homeLayoutAtom,
  placeHomeSection,
  resetHomeSections,
  showHomeSection,
  type HomeSection,
} from './homeSections.ts';
import styles from './HomeLayoutEditor.module.css';

/**
 * 首页的编辑模式：各行换成等高的占位符，可以拖动或在手柄上按 ↑ ↓ 调次序，也可以关掉；关掉的行收在底部的
 * 「添加一行」里，选一行加回来。改动立即生效并记下，退出编辑由页头的键与 Esc 管。`scroller` 是首页的滚动区，
 * 拖到它的上下沿会自动滚动
 */
export function HomeLayoutEditor({
  scroller,
}: {
  readonly scroller: RefObject<HTMLElement | null>;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const controls = useViewControlStyles();
  const layout = useAtomValueRawSync(homeLayoutAtom);
  const visible = layout.filter((slot) => slot.shown);
  const hidden = layout.filter((slot) => !slot.shown);
  const list = useRef<HTMLDivElement>(null);
  // 挪动或关掉后，那一行在 DOM 里换了位置，焦点会丢；记下要回到第几行的手柄
  const refocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    const row = refocus.current;
    refocus.current = null;
    if (row === null) return;
    const handles = list.current?.querySelectorAll<HTMLElement>('[data-handle]');
    handles?.[Math.min(row, handles.length - 1)]?.focus();
  }, [layout]);

  const reorder = useListReorder({
    scroller,
    row: '[data-home-edit-row]',
    enabled: true,
    signature: visible.map((slot) => slot.id).join(' '),
    drop: (key, slot) => {
      const moved = visible.find((item) => item.id === key);
      if (moved) placeHomeSection(store, moved.id, slot);
    },
  });
  useCommand({
    id: 'home.edit.cancelDrag',
    layer: 'gesture',
    keys: [{ key: 'Escape' }],
    enabled: () => reorder.drag !== null,
    run: reorder.cancel,
  });

  const nameOf = (id: HomeSection) => {
    const label = HOME_SECTIONS.find((section) => section.id === id)?.label;
    return label ? t(label) : id;
  };
  const { drag } = reorder;
  const dragFrom = drag ? visible.findIndex((slot) => slot.id === drag.key) : -1;
  /** 插入线画在哪一行：插入位 k 画在第 k 行上沿，末尾画在最后一行下沿；落在原位不画 */
  const dropOf = (index: number): 'before' | 'after' | undefined => {
    if (!drag || dragFrom < 0 || isOwnSlot(dragFrom, drag.slot)) return undefined;
    if (drag.slot < visible.length) return index === drag.slot ? 'before' : undefined;
    return index === visible.length - 1 ? 'after' : undefined;
  };
  const moveByKey = (event: KeyboardEvent, from: number, id: HomeSection) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const slot = stepSlot(from, event.key === 'ArrowUp' ? -1 : 1, visible.length);
    if (slot === null) return;
    refocus.current = landingIndex(from, slot);
    placeHomeSection(store, id, slot);
  };

  return (
    <div className={styles.editor}>
      <div className={styles.top}>
        <p className={styles.hint}>{t('home.editHint')}</p>
        <Button className={controls.field} onClick={() => resetHomeSections(store)}>
          {t('home.editReset')}
        </Button>
      </div>
      <div ref={list} role="list" aria-label={t('home.editList')} className={styles.list}>
        {visible.map(({ id }, index) => {
          const name = nameOf(id);
          return (
            <div
              key={id}
              role="listitem"
              className={styles.row}
              data-home-edit-row={id}
              data-dragging={drag?.key === id || undefined}
              data-drop={dropOf(index)}
              onPointerDown={(event) => {
                const target = event.target;
                // 行里的关掉键自己点；手柄与行的空白处都能起拖
                if (target instanceof Element && target.closest('button:not([data-handle])'))
                  return;
                reorder.press(event, id);
              }}
            >
              <Tooltip content={t('home.editMove', { name })} relationship="label">
                <Button
                  data-handle
                  appearance="subtle"
                  className={controls.icon}
                  icon={<ReOrderDotsVertical20Regular />}
                  onKeyDown={(event) => moveByKey(event, index, id)}
                />
              </Tooltip>
              <span className={styles.name}>{name}</span>
              <Tooltip content={t('home.editHide', { name })} relationship="label">
                <Button
                  appearance="subtle"
                  className={controls.icon}
                  icon={<Dismiss20Regular />}
                  onClick={() => {
                    refocus.current = index;
                    showHomeSection(store, id, false);
                  }}
                />
              </Tooltip>
            </div>
          );
        })}
      </div>
      {hidden.length > 0 && (
        <Menu surfaceMotion={MENU_SURFACE_MOTION}>
          <MenuTrigger disableButtonEnhancement>
            <button type="button" className={styles.add}>
              <Add20Regular aria-hidden />
              {t('home.editAdd')}
            </button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList aria-label={t('home.editAdd')}>
              {hidden.map(({ id }) => (
                <MenuItem key={id} onClick={() => showHomeSection(store, id, true)}>
                  {nameOf(id)}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      )}
    </div>
  );
}
