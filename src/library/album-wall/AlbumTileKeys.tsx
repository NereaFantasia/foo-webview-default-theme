import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { MoreHorizontal16Regular, Pause16Filled, Play16Filled } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import styles from './AlbumTileKeys.module.css';
import type { MenuPoint } from '../albumMenu.ts';
import { dropReflow, REFLOW_FOLLOW_ATTR } from './wallReflow.ts';

// 两枚键浮在封面上，底下是任意颜色的图，使用不透明填充。外框不接指针，只有两枚键接。
const useStyles = makeStyles({
  key: { position: 'absolute', bottom: tokens.spacingVerticalS, pointerEvents: 'auto' },
  play: { left: tokens.spacingHorizontalS },
  more: { right: tokens.spacingHorizontalS },
});

export interface AlbumTileKeysProps {
  /** 那一块的位置键：换列时跟着它一起滑（`wallReflow.ts`）。没有悬停的图块时不给。 */
  readonly follow: string | undefined;
  /** 那一块在行层里的左上角与封面边长，CSS 像素。 */
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** 没有悬停的图块：整个外框挪出视口，里面的键不卸。 */
  readonly hidden: boolean;
  /** 跟悬停的那一块同组平移（见 `foldGroups`）。 */
  readonly fold: number;
  /** idle 是别的专辑，点了从头播这一张；playing、paused 是正在播放的那张，点了暂停或继续。 */
  readonly state: 'idle' | 'playing' | 'paused';
  readonly onPlay: () => void;
  /** 坐标是「更多」键的左下角，菜单贴着它开。 */
  readonly onMore: (point: MenuPoint) => void;
}

/**
 * 封面悬停时的两枚键：左下播放、右下更多，更多与右键开同一份菜单。整张网格只挂这一对，指针停在哪块
 * 就挪到哪块：每块各挂一对的话，快速滚动时每进来一行都要新建一批按钮，样式重算成倍上涨。
 *
 * 两枚键是鼠标的捷径，键盘有回车与 Menu 键，所以不进 Tab 序；按下不抢焦点，焦点留在网格上，
 * 菜单关掉后才回得去。按下也不往外冒，免得起拖动或被当成点了图块。
 */
export function AlbumTileKeys(props: AlbumTileKeysProps) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const root = useRef<HTMLDivElement>(null);
  // 换列的位移还在播时指针挪到了别的一块：先撤掉上一块剩下的位移，再定到新的一块上。
  useLayoutEffect(() => {
    if (root.current) dropReflow(root.current);
  }, [props.follow]);
  const keep = (event: MouseEvent) => event.preventDefault();
  const playLabel =
    props.state === 'idle'
      ? t('album.tilePlay')
      : t(props.state === 'playing' ? 'album.tilePause' : 'album.tileResume');
  return (
    <div
      ref={root}
      className={styles.root}
      data-tile-keys
      data-fold={props.fold || undefined}
      {...{ [REFLOW_FOLLOW_ATTR]: props.follow }}
      style={{
        transform: props.hidden ? 'translateX(-100000px)' : `translate(${props.x}px, ${props.y}px)`,
        width: props.size,
        height: props.size,
      }}
    >
      <PrimaryPlayButton
        className={mergeClasses(classes.key, classes.play)}
        shape="circular"
        icon={props.state === 'playing' ? <Pause16Filled /> : <Play16Filled />}
        aria-label={playLabel}
        tabIndex={-1}
        data-tile-play
        onMouseDown={keep}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={props.onPlay}
      />
      <Button
        className={mergeClasses(classes.key, classes.more)}
        appearance="primary"
        shape="circular"
        icon={<MoreHorizontal16Regular />}
        aria-label={t('album.tileMore')}
        tabIndex={-1}
        data-tile-more
        onMouseDown={keep}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          props.onMore({ x: box.left, y: box.bottom });
        }}
      />
    </div>
  );
}
