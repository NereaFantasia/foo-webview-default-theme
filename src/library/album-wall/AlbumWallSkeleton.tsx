import { makeStyles, Skeleton, SkeletonItem, tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import type { AlbumWallLayout } from './useAlbumWallLayout.ts';

/** 首次读取时的一屏骨架：行数取常见窗口高度放得下的上限，多出来的被裁掉。 */
const ROWS = 6;

// 与滚动容器同一块区域、同样的左右内边距，格子才与之后的真图块对齐。
const useStyles = makeStyles({
  root: {
    gridArea: '1 / 1',
    position: 'relative',
    overflow: 'hidden',
    margin: `0 ${tokens.spacingHorizontalXXL}`,
  },
  cell: { position: 'absolute', top: 0, left: 0, borderRadius: tokens.borderRadiusMedium },
});

export interface AlbumWallSkeletonProps {
  readonly layout: AlbumWallLayout;
}

/** 按封面墙同一套几何画占位格子，清单到了换成真图块时版式不跳。 */
export function AlbumWallSkeleton({ layout }: AlbumWallSkeletonProps) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const { row, rowHeight } = layout;
  const cells = Array.from({ length: ROWS * row.perRow }, (_, at) => at);
  return (
    <Skeleton className={classes.root} aria-label={t('album.loading')}>
      {cells.map((at) => {
        const column = at % row.perRow;
        const x = Math.round(row.offset + column * (row.tileSize + row.spacing));
        const y = Math.floor(at / row.perRow) * rowHeight;
        return (
          <SkeletonItem
            key={at}
            shape="square"
            className={classes.cell}
            style={{
              transform: `translate(${x}px, ${y}px)`,
              width: row.tileSize,
              height: row.tileSize,
            }}
          />
        );
      })}
    </Skeleton>
  );
}
