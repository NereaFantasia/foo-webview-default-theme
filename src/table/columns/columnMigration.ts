import type { DataWriter, DataWriteResult } from '../../kit/dataWrite.ts';
import { DEFAULT_ORDER, DEFAULT_WIDTHS, COLUMN_IDS } from './columns.ts';
import { storedRecord } from '../../kit/localPref.ts';
import { formatColumns, parseColumns } from './columnsStorage.ts';

/** 每张表的新旧列偏好键；旧版本仍可读写自己的存档 */
export const COLUMN_PREFS = {
  albumList: {
    key: 'default-theme.album-list-columns.v2',
    previousKey: 'default-theme.album-list-columns.v1',
  },
  albumDetail: {
    key: 'default-theme.album-detail-columns.v2',
    previousKey: 'default-theme.album-detail-columns.v1',
  },
  playlist: {
    key: 'default-theme.playlist-columns.v6',
    previousKey: 'default-theme.playlist-columns.v5',
  },
  songs: { key: 'default-theme.songs-columns.v2', previousKey: 'default-theme.songs-columns.v1' },
  genres: {
    key: 'default-theme.genres-columns.v2',
    previousKey: 'default-theme.genres-columns.v1',
  },
  folders: {
    key: 'default-theme.preview-columns.tree.v2',
    previousKey: 'default-theme.preview-columns.tree.v1',
  },
  artists: {
    key: 'default-theme.artists-highlights-columns.v2',
    previousKey: 'default-theme.artists-highlights-columns.v1',
  },
  channel: {
    key: 'default-theme.channel-columns.v2',
    previousKey: 'default-theme.channel-columns.v1',
  },
} as const;

/** 在服务启动前完成选源与迁移；像素换算留到表格取得实际容器宽度时 */
export function migrateColumnPreferences(writer: DataWriter): Promise<DataWriteResult<void>> {
  return writer.run(async (scope) => {
    for (const { key, previousKey } of Object.values(COLUMN_PREFS)) {
      const current = await scope.readLocal(key);
      const previous = await scope.readLocal(previousKey);
      const latest = await scope.latestFormat(
        { id: key, keys: [key], hasValue: current !== null },
        [{ id: previousKey, keys: [previousKey], hasValue: previous !== null }],
      );
      if (latest.id === key) continue;
      if (previous === null) {
        await scope.setLocal(key, null);
        continue;
      }
      const fallback = parseColumns(current, {
        widths: DEFAULT_WIDTHS,
        hidden: [],
        order: DEFAULT_ORDER,
      });
      const migrated = parseColumns(previous, fallback);
      const rawWidths: unknown = storedRecord(previous).widths;
      const count = Array.isArray(rawWidths) ? rawWidths.length : 0;
      const legacyIds = new Set(COLUMN_IDS.slice(0, count));
      // 旧格式没有的列继续采用当前格式的显隐与位置，避免回滚后的迁移丢掉新增列偏好
      const legacyOrder = migrated.order.filter((id) => legacyIds.has(id));
      let cursor = 0;
      const order =
        current === null
          ? migrated.order
          : fallback.order.map((id) => (legacyIds.has(id) ? (legacyOrder[cursor++] ?? id) : id));
      const hidden =
        current === null
          ? migrated.hidden
          : COLUMN_IDS.filter((id) =>
              (legacyIds.has(id) ? migrated.hidden : fallback.hidden).includes(id),
            );
      await scope.setLocal(key, formatColumns({ ...migrated, order, hidden }));
    }
  });
}
