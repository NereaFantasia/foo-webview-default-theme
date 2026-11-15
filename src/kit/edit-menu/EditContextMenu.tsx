import {
  ClipboardPaste20Regular,
  Copy20Regular,
  Cut20Regular,
  SelectAllOn20Regular,
} from '@fluentui/react-icons';
import { fb } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useMemo, useState } from 'react';
import { settle } from '../../host/hostCall.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { ContextMenu } from '../context-menu/ContextMenu.tsx';
import type { ContextMenuPoint } from '../context-menu/contextMenuGeometry.ts';
import type { ContextMenuEntry } from '../context-menu/contextMenuItems.ts';
import {
  copySelection,
  cutSelection,
  editFieldOf,
  pasteText,
  selectAll,
  snapshotOf,
  type EditClipboard,
  type EditField,
  type EditSnapshot,
} from './editField.ts';

/** 菜单的宽，容得下命令名与快捷键提示 */
const MENU_WIDTH = 220;

const hostClipboard: EditClipboard = {
  async read() {
    const answer = await settle(() => fb.clipboard.read());
    return answer && answer.success !== false && answer.hasText ? answer.text : null;
  },
  async write(text) {
    return (await settle(() => fb.clipboard.write(text)))?.success === true;
  },
};

interface OpenMenu {
  readonly id: number;
  readonly at: ContextMenuPoint;
  readonly field: EditField;
  readonly snapshot: EditSnapshot;
}

/** 键盘唤出菜单时事件没有鼠标坐标，落在文本框左下角 */
function pointOf(event: MouseEvent, field: EditField): ContextMenuPoint {
  if (event.clientX !== 0 || event.clientY !== 0) return { x: event.clientX, y: event.clientY };
  const box = field.getBoundingClientRect();
  return { x: box.left, y: box.bottom };
}

/**
 * 文本框的右键菜单：剪切、复制、粘贴、全选。宿主关掉了 WebView2 自带的右键菜单（WebViewHostSettings 的
 * put_AreDefaultContextMenusEnabled），文本框里就没有这几条出口，所以在这里补上。右键在捕获阶段就接下，
 * 祖先上的右键处理（行菜单、列表菜单）也不会再跑
 * 剪贴板读写走宿主；命令执行前先按打开时记下的选区恢复焦点与选中范围，菜单取走焦点不影响所选文字
 */
export function EditContextMenu() {
  const t = useAtomValueRawSync(translateAtom);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  useEffect(() => {
    let id = 0;
    const open = (event: MouseEvent) => {
      const field = editFieldOf(event.target);
      if (!field) return;
      event.preventDefault();
      event.stopPropagation();
      id += 1;
      setMenu({ id, at: pointOf(event, field), field, snapshot: snapshotOf(field) });
    };
    document.addEventListener('contextmenu', open, { capture: true });
    return () => document.removeEventListener('contextmenu', open, { capture: true });
  }, []);
  const items = useMemo<ContextMenuEntry[]>(() => {
    if (!menu) return [];
    const { field, snapshot } = menu;
    const hasSelection = snapshot.selected !== '';
    return [
      {
        kind: 'command',
        id: 'cut',
        label: t('context.cut'),
        icon: <Cut20Regular />,
        detail: 'Ctrl+X',
        disabled: snapshot.readOnly || snapshot.secret || !hasSelection,
        onSelect: () => void cutSelection(field, snapshot, hostClipboard),
      },
      {
        kind: 'command',
        id: 'copy',
        label: t('context.copy'),
        icon: <Copy20Regular />,
        detail: 'Ctrl+C',
        disabled: snapshot.secret || !hasSelection,
        onSelect: () => void copySelection(snapshot, hostClipboard),
      },
      {
        kind: 'command',
        id: 'paste',
        label: t('context.paste'),
        icon: <ClipboardPaste20Regular />,
        detail: 'Ctrl+V',
        disabled: snapshot.readOnly,
        onSelect: () => void pasteText(field, snapshot, hostClipboard),
      },
      { kind: 'separator', id: 'select-divider' },
      {
        kind: 'command',
        id: 'select-all',
        label: t('context.selectAll'),
        icon: <SelectAllOn20Regular />,
        detail: 'Ctrl+A',
        disabled: snapshot.empty,
        onSelect: () => selectAll(field),
      },
    ];
  }, [menu, t]);
  return (
    <ContextMenu
      at={menu?.at ?? null}
      targetKey={menu ? `edit-${menu.id}` : ''}
      title={t('context.editMenu')}
      headless
      widthLimit={MENU_WIDTH}
      surfaceAttributes={{ 'data-edit-menu': true }}
      items={items}
      backLabel={t('context.back')}
      surfaceMotion={MENU_SURFACE_MOTION}
      isCurrent={() => menu?.field.isConnected ?? false}
      onClose={() => setMenu(null)}
    />
  );
}
