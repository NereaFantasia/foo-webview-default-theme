import { AddSquare20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState, type MouseEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { ContextMenu } from '../../kit/context-menu/ContextMenu.tsx';
import type { ContextMenuEntry } from '../../kit/context-menu/contextMenuItems.ts';
import type { ContextMenuPoint } from '../../kit/context-menu/contextMenuGeometry.ts';
import { useService } from '../../kit/useService.ts';
import { pathOf, queueMenuAtom } from '../../playback/queue/queueMenu.ts';
import { queueKey } from '../../playback/queue/queueServices.ts';
import { queueViewAtom } from '../../playback/queue/queueState.ts';

interface QueueSend {
  readonly at: ContextMenuPoint | null;
  open(event: MouseEvent<HTMLElement>): void;
  close(): void;
}

/** 队列「发送到播放列表」弹窗控制 hook；于触发键下沿展开，并针对全量队列曲目预取目标播放列表 */
export function useQueueSend(): QueueSend {
  const services = useService(queueKey);
  const entries = useAtomValueRawSync(queueViewAtom).entries;
  const [at, setAt] = useState<ContextMenuPoint | null>(null);
  return {
    at,
    open(event) {
      const box = event.currentTarget.getBoundingClientRect();
      setAt({ x: box.left, y: box.bottom });
      void services.menu.prepare(entries.map((entry) => pathOf(entry.track)));
    },
    close: () => setAt(null),
  };
}

/** 队列「发送到播放列表」上下文菜单；提供新建列表与现有目标列表，锁定列表置灰，队列变更时自动关闭 */
export function QueueSendMenu({ send }: { readonly send: QueueSend }) {
  const t = useAtomValueRawSync(translateAtom);
  const services = useService(queueKey);
  const menu = useAtomValueRawSync(queueMenuAtom);
  const entries = useAtomValueRawSync(queueViewAtom).entries;
  const items: ContextMenuEntry[] = [
    {
      kind: 'command',
      id: 'send-to-new',
      label: t('album.sendToNew'),
      icon: <AddSquare20Regular />,
      onSelect: () => void services.menu.sendToNew(t('queue.section')),
    },
    { kind: 'separator', id: 'targets-divider' },
    ...menu.targets.map((entry): ContextMenuEntry => ({
      kind: 'command',
      id: `send:${entry.guid}`,
      label: entry.name,
      disabled: entry.locked,
      detail: entry.locked ? t('context.locked') : undefined,
      onSelect: () => void services.menu.sendTo(entry.guid),
    })),
  ];
  return (
    <ContextMenu
      at={send.at}
      targetKey={JSON.stringify(entries.map((entry) => entry.key))}
      title={t('album.sendTo')}
      items={items}
      backLabel={t('context.back')}
      onClose={send.close}
    />
  );
}
