import { Button } from '@fluentui/react-components';
import {
  ChevronRight16Regular,
  Folder16Regular,
  MoreHorizontal20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import type { FoldersTarget } from '../actions/foldersActions.ts';
import type { FolderNode } from '../tree/foldersModel.ts';
import type { FolderGroup } from './foldersStructure.ts';
import { FolderArt } from './FolderArt.tsx';
import styles from './FolderCards.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';

export interface FolderCardsProps {
  readonly groups: readonly FolderGroup[];
  readonly directories?: readonly FolderNode[];
  readonly size: number;
  onMenu(target: FoldersTarget, point: TablePoint): void;
}
export function FolderCards({ groups, directories, size, onMenu }: FolderCardsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const entries =
    directories?.map((node) => ({ node, first: undefined })) ??
    groups.map((group) => ({ node: group.node, first: group.tracks[0] }));
  return (
    <div
      className={styles.root}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}
    >
      {entries.map(({ node, first }) => (
        <div
          key={node.key}
          className={styles.card}
          onContextMenu={(event) => {
            event.preventDefault();
            onMenu({ nodes: [node] }, { x: event.clientX, y: event.clientY });
          }}
        >
          <button
            type="button"
            className={styles.open}
            title={node.absolutePath}
            aria-label={t('folders.enter', { name: node.name })}
            onClick={() => void folders.visit(node.key)}
          >
            <FolderArt track={first} size={size} />
            <span className={styles.name}>
              <Folder16Regular />
              <span>{node.name}</span>
              <ChevronRight16Regular />
            </span>
          </button>
          <div className={styles.footer}>
            <span>{t('folders.trackCount', { count: node.count })}</span>
            <Button
              size="small"
              appearance="transparent"
              icon={<MoreHorizontal20Regular />}
              aria-label={t('folders.more')}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onMenu({ nodes: [node] }, { x: rect.x, y: rect.bottom });
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
