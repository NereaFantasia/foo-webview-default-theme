import {
  Button,
  MenuItemCheckbox,
  MenuList,
  MenuTrigger,
  ProgressBar,
  ToggleButton,
  makeStyles,
  mergeClasses,
  tokens,
  type MenuCheckedValueChangeData,
} from '@fluentui/react-components';
import { ChevronDown12Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, useState, type RefObject } from 'react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { roleVar } from '../../theme/roles.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { lyricsCandidateId, type LyricsChoiceState } from '../lyricsSearchSession.ts';
import type { LyricsCandidate } from '../online/lyricsSource.ts';
import { LyricsCandidateCard } from './LyricsCandidateCard.tsx';
import { LyricsCandidateSkeleton } from './LyricsCandidateSkeleton.tsx';
import {
  FILTER_FORMATS,
  NO_FILTER,
  candidateSources,
  filterCandidates,
  type LyricsCandidateFilter,
} from './lyricsCandidateFilter.ts';
import styles from './LyricsCandidateResults.module.css';

export interface LyricsCandidateResultsProps {
  readonly result: LyricsChoiceState;
  readonly enabled: boolean;
  /** 放这份结果的滚动容器，封面按它判断露出了没有 */
  readonly viewport: RefObject<HTMLElement | null>;
  /** 正在使用的候选 id，没有是空串 */
  readonly using: string;
  /** 没有预览页的界面不传，候选卡就没有预览键 */
  onPreview?(candidate: LyricsCandidate): void;
  onUse(candidate: LyricsCandidate): void;
}

const useChipStyles = makeStyles({
  // Fluent 的小按钮有最小宽度，短标签的筛选键不该被撑开。图标槽的字号、宽高缺省都是 20，12 号的箭头要压回 12；
  // 槽的高度不动：带图标的小按钮靠它撑到 24，和没有图标的键等高
  chip: {
    minWidth: 'unset',
    '& .fui-Button__icon': { width: tokens.fontSizeBase200, fontSize: tokens.fontSizeBase200 },
  },
  // 选中底叠在控件自己的状态底上，悬停和按下时仍保留选中标记
  on: {
    '@media (forced-colors: none)': {
      backgroundImage: `linear-gradient(${roleVar('bg-selected')}, ${roleVar('bg-selected')})`,
    },
  },
});

/** 一组可多选的条件，触发键上写已选的个数，空组表示不按它筛 */
function FacetMenu<T extends string>({
  name,
  label,
  options,
  checked,
  onChange,
}: {
  readonly name: string;
  readonly label: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly checked: readonly T[];
  onChange(values: readonly T[]): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const chip = useChipStyles();
  const onChecked = (_: unknown, data: MenuCheckedValueChangeData) =>
    onChange(options.map((option) => option.value).filter((v) => data.checkedItems.includes(v)));
  return (
    <Menu checkedValues={{ [name]: [...checked] }} onCheckedValueChange={onChecked}>
      <MenuTrigger disableButtonEnhancement>
        <Button
          size="small"
          icon={<ChevronDown12Regular />}
          iconPosition="after"
          className={mergeClasses(controls.field, chip.chip, checked.length > 0 && chip.on)}
          data-lyrics-filter-menu={name}
        >
          {checked.length > 0 ? t('lyrics.filterCount', { label, count: checked.length }) : label}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={label}>
          {options.map((option) => (
            <MenuItemCheckbox
              key={option.value}
              name={name}
              value={option.value}
              persistOnClick
              data-lyrics-filter-option={`${name}:${option.value}`}
            >
              {option.label}
            </MenuItemCheckbox>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/**
 * 在线歌词检索结果面板（供右侧卡搜索页与沉浸视图共享）
 *
 * 整合条件筛选工具行、检索与加载状态反馈提示及候选卡片流；
 * 客户端筛选作用于当前内存候选集，搜索关键词变更时重置筛选
 */
export function LyricsCandidateResults({
  result,
  enabled,
  viewport,
  using,
  onPreview,
  onUse,
}: LyricsCandidateResultsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const listFormat = new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' });
  const controls = useViewControlStyles();
  const chip = useChipStyles();
  const [picked, setPicked] = useState<LyricsCandidateFilter>(NO_FILTER);
  const sources = useMemo(() => candidateSources(result.candidates), [result.candidates]);
  const filter = useMemo(
    () => ({ ...picked, sources: picked.sources.filter((source) => sources.includes(source)) }),
    [picked, sources],
  );
  const shown = useMemo(
    () => filterCandidates(result.candidates, filter),
    [result.candidates, filter],
  );
  const total = result.candidates.length;
  return (
    <>
      {total > 0 && (
        <div className={styles.bar} role="group" aria-label={t('lyrics.filter')} data-lyrics-filter>
          {sources.length > 1 && (
            <FacetMenu
              name="source"
              label={t('lyrics.sourceLabel')}
              options={sources.map((source) => ({
                value: source,
                label: t(`lyrics.source.${source}`),
              }))}
              checked={filter.sources}
              onChange={(values) => setPicked({ ...filter, sources: values })}
            />
          )}
          <FacetMenu
            name="format"
            label={t('lyrics.format')}
            options={FILTER_FORMATS.map((format) => ({
              value: format,
              label: t(`lyrics.${format}`),
            }))}
            checked={filter.formats}
            onChange={(values) => setPicked({ ...filter, formats: values })}
          />
          <ToggleButton
            size="small"
            checked={filter.translated}
            className={mergeClasses(controls.field, chip.chip, filter.translated && chip.on)}
            onClick={() => setPicked({ ...filter, translated: !filter.translated })}
          >
            {t('lyrics.hasTranslation')}
          </ToggleButton>
          <span className={styles.count} role="status">
            {t('lyrics.resultsOf', { shown: shown.length, total })}
          </span>
        </div>
      )}
      {result.status === 'searching' &&
        (total === 0 ? (
          <LyricsCandidateSkeleton />
        ) : (
          <ProgressBar className={styles.progress} aria-label={t('lyrics.searching')} />
        ))}
      {(result.status === 'search-failed' || result.failed.length > 0) && (
        <p className={styles.note} role="status">
          {result.failed.length
            ? t('lyrics.failedSources', {
                sources: listFormat.format(
                  result.failed.map((source) => t(`lyrics.source.${source}`)),
                ),
              })
            : t('lyrics.searchFailed')}
        </p>
      )}
      {result.status === 'fetch-failed' && (
        <p className={styles.note} role="status">
          {t('lyrics.fetchFailed')}
        </p>
      )}
      {result.status === 'missing' && (
        <p className={styles.note} role="status">
          {t('lyrics.selectedMissing')}
        </p>
      )}
      {result.status === 'ready' && !result.failed.length && total === 0 && (
        <p className={styles.note} role="status">
          {t('lyrics.onlineMissing')}
        </p>
      )}
      {total > 0 && shown.length === 0 && (
        <p className={styles.note} role="status">
          {t('lyrics.filteredEmpty')}
        </p>
      )}
      {shown.map((candidate) => (
        <LyricsCandidateCard
          key={lyricsCandidateId(candidate)}
          candidate={candidate}
          enabled={enabled}
          viewport={viewport}
          using={using}
          onPreview={onPreview}
          onUse={onUse}
        />
      ))}
    </>
  );
}
