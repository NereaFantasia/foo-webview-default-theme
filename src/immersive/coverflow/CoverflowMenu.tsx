import { useStore } from 'jotai/react';
import { QueueMenu } from '../../playback/queue/QueueMenu.tsx';
import { coverflowItemsAtom } from '../scene/coverflowAtoms.ts';
import type { CoverflowMenuTarget } from './menuTarget.ts';

/** 封面流右键上下文菜单；命令执行失败时静默忽略，与历史页行为保持一致 */
export function CoverflowMenu({
  target,
  onClose,
}: {
  readonly target: CoverflowMenuTarget;
  onClose(): void;
}) {
  const store = useStore();
  return (
    <QueueMenu
      target={target.menu}
      isCurrent={() => store.get(coverflowItemsAtom).some((item) => item.key === target.itemKey)}
      perform={(command) => void command()}
      onClose={onClose}
    />
  );
}
