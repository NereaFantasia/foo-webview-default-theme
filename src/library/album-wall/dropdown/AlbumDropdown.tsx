import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { Dismiss16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { memo, useEffect, useState, type CSSProperties } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import styles from './AlbumDropdown.module.css';
import { AlbumDropdownArt } from './AlbumDropdownArt.tsx';
import { AlbumDropdownContent } from './AlbumDropdownContent.tsx';
import { DROPDOWN_METRICS, dropdownCoverSize } from '../albumDropdown.ts';
import type { RowLayout } from '../../cover-tile/tileGeometry.ts';
import type { MenuPoint } from '../../albumMenu.ts';
import { albumKeyOf, type Album } from '../../../host/libraryContract.ts';
import type { FoldSlotView } from './wallFold.ts';
import { REFLOW_KEY_ATTR } from '../../cover-tile/tileReflow.ts';
import { dropdownReflowKey } from '../wallReflow.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';

/** 同行切换不同专辑时曲目加载超时阈值，单位毫秒；超时后旧内容置灰且头部显示加载动画 */
const DIM_AFTER_MS = 300;

const useStyles = makeStyles({
  close: { position: 'absolute', top: tokens.spacingVerticalM, right: tokens.spacingHorizontalM },
});

export interface AlbumDropdownProps {
  readonly view: FoldSlotView;
  /** 详情面板顶部指示箭头对齐的图块列索引 */
  readonly column: number;
  /** 条目在行层坐标系中的垂直坐标，单位 CSS 像素 */
  readonly top: number;
  /** 上方已展开的面板数量，用于折叠分组联动平移（见 `foldGroups`） */
  readonly group: number;
  readonly row: RowLayout;
  readonly rowIndex: number;
  /**
   * 当前展开高度计算函数
   * 展开收起与高度过渡逐帧值由时钟直接写入 `--fold-visible`，此处仅在挂载时读取初始值
   */
  readonly visibleOf: (id: number) => number;
  readonly onClose: () => void;
  readonly onMenu: (point: MenuPoint) => void;
}

/**
 * 封面墙行内展开详情面板
 * 布局高度在首帧即设定为目标值，面板通过 `--fold-visible` 从顶部裁剪渐显，内容锚定顶部不缩放
 * 箭头位于行间距内指向所选图块；同行切换专辑时新旧内容叠加并沿箭头移动方向执行滑入滑出过渡
 */
export const AlbumDropdown = memo(function AlbumDropdown(props: AlbumDropdownProps) {
  const { view, row } = props;
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const [shown, setShown] = useState({ album: view.album, column: props.column });
  const [previous, setPrevious] = useState<{ album: Album; column: number } | null>(null);
  /** 最近一次切换专辑时的滑动方向，用于触发新内容单次滑入过渡 */
  const [enter, setEnter] = useState<'left' | 'right' | undefined>(undefined);
  if (albumKeyOf(shown.album) !== albumKeyOf(view.album)) {
    setPrevious(shown);
    setShown({ album: view.album, column: props.column });
    setEnter(props.column < shown.column ? 'left' : 'right');
  }
  const [initial] = useState(() => props.visibleOf(view.id));
  const [dim, setDim] = useState(false);
  const waiting = view.waiting !== null;
  useEffect(() => {
    setDim(false);
    if (!waiting) return;
    const timer = setTimeout(() => setDim(true), DIM_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  const width = row.perRow * row.tileSize + (row.perRow - 1) * row.spacing;
  const caret = props.column * (row.tileSize + row.spacing) + row.tileSize / 2;
  const cover = dropdownCoverSize(width);
  const vars: CSSProperties & Record<`--${string}`, string> = {
    '--panel-height': `${view.panel}px`,
    '--cover-size': `${cover}px`,
    '--fold-visible': `${initial}px`,
    '--caret-x': `${Math.round(caret)}px`,
    '--dropdown-head': `${DROPDOWN_METRICS.head}px`,
    '--dropdown-foot': `${DROPDOWN_METRICS.foot}px`,
  };
  return (
    <div
      className={styles.slot}
      role="row"
      aria-rowindex={props.rowIndex + 1}
      data-fold-slot={view.id}
      data-fold={props.group || undefined}
      {...{ [REFLOW_KEY_ATTR]: dropdownReflowKey(view.id) }}
      data-closing={view.closing || undefined}
      style={{
        ...vars,
        transform: `translate(${Math.round(row.offset)}px, ${props.top}px)`,
        width,
      }}
    >
      <span className={styles.caret} aria-hidden />
      <div
        className={styles.panel}
        role="gridcell"
        aria-colspan={row.perRow}
        aria-label={view.album.name}
        data-album-dropdown={albumKeyOf(view.album)}
      >
        <AlbumDropdownArt album={view.album} size={DROPDOWN_METRICS.cover} />
        <div className={styles.stack}>
          {previous && (
            <AlbumDropdownContent
              key={`old:${albumKeyOf(previous.album)}`}
              album={previous.album}
              moving={false}
              dim={false}
              leave={enter}
              onLeft={() => setPrevious(null)}
              onMenu={props.onMenu}
            />
          )}
          <AlbumDropdownContent
            key={albumKeyOf(shown.album)}
            album={shown.album}
            moving={view.moving}
            dim={dim}
            enter={enter}
            onMenu={props.onMenu}
          />
        </div>
        <Button
          className={mergeClasses(classes.close, controls.icon)}
          appearance="subtle"
          shape="circular"
          icon={<Dismiss16Regular />}
          aria-label={t('album.dropdownClose')}
          data-dropdown-close
          onClick={props.onClose}
        />
      </div>
    </div>
  );
});
