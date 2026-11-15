import { Button, Tooltip } from '@fluentui/react-components';
import { RecordRegular, Edit20Regular, TextNumberListLtr16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { Metadata, MetadataItem } from '../../kit/Metadata.tsx';
import { SegmentedTabs } from '../../kit/SegmentedTabs.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { albumsAtom } from '../albums.ts';
import { useSearchSession } from './searchContext.ts';
import styles from './SearchHeader.module.css';
import type { SearchResultsService } from './searchResults.ts';

/** 页头右上角的范围切换；两段的数是当前分类在两边各自的命中数，还没取到时为 null */
export interface SearchRange {
  readonly value: 'library' | 'online';
  readonly library: number | null;
  readonly online: number | null;
}

/**
 * 检索结果页头：展示查询词、重新编辑触发按钮、媒体库结果总计，以及本地/在线范围分段切换
 * 统计数量反映全局检索命中总数，不受子分类筛选影响；`range` 为 null 时不出范围切换（两边合在一页或只有在线音乐）
 */
export function SearchHeader({
  text,
  scope,
  results,
  range,
  onScope,
}: {
  readonly text: string;
  readonly scope: 'library' | 'online';
  readonly results: SearchResultsService;
  readonly range: SearchRange | null;
  onScope(scope: 'library' | 'online'): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const format = new Intl.NumberFormat(locale);
  const labelled = (name: string, count: number | null) =>
    count === null ? name : `${name} ${format.format(count)}`;
  const plural = useAtomValueRawSync(pluralAtom);
  const viewControls = useViewControlStyles();
  const session = useSearchSession();
  const catalog = useAtomValueRawSync(albumsAtom);
  const albums = useAtomValueRawSync(results.albums);
  const state = useAtomValueRawSync(results.state);
  const known = catalog.status === 'ready' && !catalog.truncated;
  return (
    <header className={styles.header}>
      <div className={styles.title}>
        <div className={styles.heading}>
          <h1 title={text}>{text}</h1>
          <Tooltip content={t('search.edit')} relationship="label">
            <Button
              className={viewControls.icon}
              appearance="subtle"
              icon={<Edit20Regular />}
              aria-label={t('search.edit')}
              onClick={() => session.show(text)}
            />
          </Tooltip>
        </div>
        {scope === 'library' ? (
          <Metadata className={styles.count}>
            <MetadataItem icon={<RecordRegular />}>
              {t(plural(known ? albums.length : 0, 'album.countOne', 'album.count'), {
                count: known ? albums.length : t('search.unknownCount'),
              })}
            </MetadataItem>
            <MetadataItem icon={<TextNumberListLtr16Regular />}>
              {t(plural(state.total ?? 0, 'album.menuTracksOne', 'album.menuTracks'), {
                count: state.total ?? t('search.unknownCount'),
              })}
            </MetadataItem>
          </Metadata>
        ) : (
          // 在线检索模式下保留等高空白占位，确保下层控制栏与媒体库模式对齐
          <div className={styles.count} aria-hidden />
        )}
      </div>
      {range && (
        <span className={styles.scope}>
          <SegmentedTabs
            label={t('online.scope')}
            value={range.value}
            options={[
              { value: 'library', label: labelled(t('online.scopeLibrary'), range.library) },
              { value: 'online', label: labelled(t('online.scopeOnline'), range.online) },
            ]}
            onChange={onScope}
          />
        </span>
      )}
    </header>
  );
}
