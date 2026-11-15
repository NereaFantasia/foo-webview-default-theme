import { useAtomValueRawSync } from 'jotai/react';
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import type { CoverGridShape } from './CoverGrid.tsx';
import { TileKeys } from './TileKeys.tsx';
import { TileLabels } from './TileLabels.tsx';
import { useTileKeysHost } from './useTileKeysHost.ts';
import styles from './ObjectTile.module.css';

/** 圆形艺人图块的边长，CSS 像素 */
export const ARTIST_TILE_SIZE = 120;

/** 艺人网格规范：头像 120px 加单行名字，固定间距 24px 不随容器拉伸 */
export const ARTIST_GRID_SHAPE: CoverGridShape = {
  size: ARTIST_TILE_SIZE,
  gap: 24,
  stretch: 1,
  textHeight: 18,
  lineHeight: 16,
};

/** 图块交互动作：打开、右键菜单，可选的起播 */
export interface ObjectTileActions {
  onOpen(): void;
  onMenu(at: TablePoint): void;
  onPlay?(): void;
}

function menuAt(event: MouseEvent, onMenu: (at: TablePoint) => void) {
  event.preventDefault();
  onMenu({ x: event.clientX, y: event.clientY });
}

/**
 * 对象图块：封面加文字，`round` 时是圆形头像与居中的名字。文字不在封面按钮里：副标题里的艺人名可点，
 * 按钮里不能再放链接；点文字空白处同样打开。封面由调用方给出（`TileArt` 或它的封装），图块不管取图
 */
export function ObjectTile({
  art,
  round = false,
  title,
  detail,
  detailContent,
  aside,
  dataset,
  keysTheme,
  onOpen,
  onMenu,
  onPlay,
}: {
  readonly art: ReactNode;
  readonly round?: boolean;
  readonly title: string;
  /** 副标题文本；省略时仅渲染单行标题 */
  readonly detail?: string;
  /** 副标题里的艺人各自可点时的排法，`detail` 仍写悬停提示 */
  readonly detailContent?: ReactNode;
  /** 副标题右侧辅助文本，需与 detail 配合传入 */
  readonly aside?: string;
  /** 挂在图块根上的标识属性，供样式与自动化定位图块 */
  readonly dataset?: Readonly<Record<`data-${string}`, string | true | undefined>>;
  /**
   * 悬停按钮的取色：给了就用它包住按钮，颜色取自这张卡自己的封面；没给时按钮沿用所在页面的取色，
   * 页面本身按别的内容取色（艺人页按艺人照片）时，卡片的按钮就和卡片的封面对不上
   */
  readonly keysTheme?: (keys: ReactElement) => ReactNode;
} & ObjectTileActions) {
  const t = useAtomValueRawSync(translateAtom);
  const keys = useTileKeysHost();
  const buttons =
    onPlay && keys.mounted ? (
      <TileKeys
        hidden={keys.hidden}
        state="idle"
        playLabel={t('album.play')}
        style={{ width: 'var(--tile-size)', height: 'var(--tile-size)' }}
        onTransitionEnd={keys.onTransitionEnd}
        onPlay={onPlay}
        onMore={onMenu}
      />
    ) : null;
  return (
    <div className={styles.tile} data-round={round || undefined} {...dataset} {...keys.rootProps}>
      <button
        type="button"
        className={styles.face}
        aria-label={title}
        title={[title, detail].filter(Boolean).join('\n')}
        data-tile-face
        onClick={onOpen}
        onContextMenu={(event) => menuAt(event, onMenu)}
      >
        {art}
      </button>
      <div
        className={styles.labels}
        onClick={onOpen}
        onContextMenu={(event) => menuAt(event, onMenu)}
      >
        <TileLabels title={title} subtitle={detail} subtitleContent={detailContent} aside={aside} />
      </div>
      {buttons && (keysTheme ? keysTheme(buttons) : buttons)}
    </div>
  );
}
