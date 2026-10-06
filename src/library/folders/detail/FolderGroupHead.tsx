import { ChevronRight16Regular, Folder20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { TableGroupItem } from '../../../table/tableItems.ts';
import type { TableGroupState } from '../../../table/TrackTable.tsx';
import type { FolderGroup, FoldersGroupData, FoldersStructure } from './foldersStructure.ts';
import { FolderArt } from './FolderArt.tsx';
import styles from './FolderGroupHead.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';

export interface FolderGroupHeadProps {
  readonly item: TableGroupItem<FoldersGroupData>;
  readonly state: TableGroupState;
  readonly coverWidth: number;
  readonly full: FoldersStructure;
  readonly filtered: boolean;
}
export function FolderGroupHead({ item, state, coverWidth, full, filtered }: FolderGroupHeadProps) {
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const { group, own } = item.data;
  function find(groups: readonly FolderGroup[]): FolderGroup | undefined {
    for (const entry of groups) {
      if (entry.node.key === group.node.key) return entry;
      const child = find(entry.children);
      if (child) return child;
    }
    return undefined;
  }
  const total = find(full.groups);
  const count = own ? group.direct.length : group.tracks.length;
  return (
    <>
      <div
        className={styles.head}
        style={{ paddingInlineStart: `calc(var(--spacingHorizontalM) * ${item.level})` }}
      >
        <button
          type="button"
          tabIndex={-1}
          className={styles.toggle}
          data-expanded={!item.collapsed}
          onClick={state.toggle}
          aria-label={t(item.collapsed ? 'folders.expand' : 'folders.collapse')}
        >
          <ChevronRight16Regular />
        </button>
        <Folder20Regular />
        <button
          type="button"
          tabIndex={-1}
          className={styles.name}
          title={group.node.absolutePath}
          onClick={() => void folders.visit(group.node.key)}
        >
          {own ? t('folders.ownTracks') : group.node.name}
        </button>
        <span className={styles.count}>
          {t(filtered ? 'folders.matches' : 'folders.trackCount', {
            count,
            total: (own ? total?.direct.length : total?.tracks.length) ?? count,
          })}
        </span>
        {!own && (
          <button
            type="button"
            tabIndex={-1}
            className={styles.toggle}
            aria-label={t('folders.enter', { name: group.node.name })}
            onClick={() => void folders.visit(group.node.key)}
          >
            <ChevronRight16Regular />
          </button>
        )}
      </div>
      {!item.collapsed && coverWidth > 0 && group.direct.length > 0 && (
        <span className={styles.cover} data-table-group-body>
          <FolderArt track={group.direct[0]} size={Math.max(0, coverWidth - 16)} />
        </span>
      )}
    </>
  );
}
