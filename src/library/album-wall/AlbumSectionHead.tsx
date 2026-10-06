import { ChevronDown16Regular, ChevronRight16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { memo } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import styles from './AlbumSectionHead.module.css';
import type { AlbumSection } from '../albumSections.ts';

export interface AlbumSectionHeadProps {
  readonly section: AlbumSection;
  readonly collapsed: boolean;
  /** 一行几块：节头这一格横跨整行。 */
  readonly columns: number;
  readonly onToggle: (key: string | null) => void;
}

/**
 * 网格里的节头一行：折叠箭头、节名、右端的张数。整行都能点：折叠是这一行唯一的动作，只让箭头可点
 * 等于给了个小得多的靶子。null 键是「未知」节，文案取语言包。网格的行里只能放单元格，按钮外面包一格，
 * 横跨整行。窗口变宽变窄而列数不变时属性不变，不重新渲染。
 */
export const AlbumSectionHead = memo(function AlbumSectionHead(props: AlbumSectionHeadProps) {
  const { section, collapsed, onToggle } = props;
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const count = section.albums.length;
  return (
    <div className={styles.cell} role="gridcell" aria-colspan={props.columns}>
      <button
        type="button"
        className={styles.root}
        aria-expanded={!collapsed}
        data-section-head
        onClick={() => onToggle(section.key)}
      >
        {collapsed ? <ChevronRight16Regular /> : <ChevronDown16Regular />}
        <span className={styles.name}>{section.key ?? t('album.unknownSection')}</span>
        <span className={styles.count}>
          {t(plural(count, 'album.sectionCountOne', 'album.sectionCount'), { count })}
        </span>
      </button>
    </div>
  );
});
