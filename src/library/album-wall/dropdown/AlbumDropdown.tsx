import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { Dismiss16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { memo, useEffect, useState, type CSSProperties } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import styles from './AlbumDropdown.module.css';
import { AlbumDropdownArt } from './AlbumDropdownArt.tsx';
import { AlbumDropdownContent } from './AlbumDropdownContent.tsx';
import { DROPDOWN_METRICS, dropdownCoverSize } from '../albumDropdown.ts';
import type { RowLayout } from '../albumGridLayout.ts';
import type { MenuPoint } from '../../albumMenu.ts';
import { albumKeyOf, type Album } from '../../../host/libraryContract.ts';
import type { FoldSlotView } from './wallFold.ts';
import { dropdownReflowKey, REFLOW_KEY_ATTR } from '../wallReflow.ts';

/** 同一行点了另一张，它的曲目过了这么久还没到，毫秒：旧内容压暗、头部转圈。 */
const DIM_AFTER_MS = 300;

const useStyles = makeStyles({
  close: { position: 'absolute', top: tokens.spacingVerticalM, right: tokens.spacingHorizontalM },
});

export interface AlbumDropdownProps {
  readonly view: FoldSlotView;
  /** 箭头指着这一行的第几块。 */
  readonly column: number;
  /** 条目在行层里的纵坐标，CSS 像素。 */
  readonly top: number;
  /** 上面有几条下拉，即跟哪一组平移（见 `foldGroups`）；0 是不动。 */
  readonly group: number;
  readonly row: RowLayout;
  readonly rowIndex: number;
  /**
   * 此刻露出的高。开合与改高的逐帧值由时钟直接写进 `--fold-visible`，这里只在挂上时读一次作起点，
   * 之后的渲染不改它。
   */
  readonly visibleOf: (id: number) => number;
  readonly onClose: () => void;
  readonly onMenu: (point: MenuPoint) => void;
}

/**
 * 封面墙的一条下拉：条目流里给它留的高在第 0 帧就到终值，面板按 `--fold-visible` 从顶边往下裁剪露出，
 * 内容锚在顶部、不缩放；面板比露出的高还高时（改矮的途中）照露出的高画，下面的行才接得上。箭头在
 * 行间距里，指着被点的那一块。同一行换一张时新旧内容叠着，朝箭头移动的方向短距离滑入滑出。
 */
export const AlbumDropdown = memo(function AlbumDropdown(props: AlbumDropdownProps) {
  const { view, row } = props;
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const [shown, setShown] = useState({ album: view.album, column: props.column });
  const [previous, setPrevious] = useState<{ album: Album; column: number } | null>(null);
  /** 最近一次换内容时箭头往哪边走；新内容挂上时按它滑入，只播这一次。 */
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
          className={classes.close}
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
