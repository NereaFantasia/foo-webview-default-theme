import {
  Button,
  MenuItem,
  MenuList,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { ChevronDown16Regular, ChevronUp16Regular, Person16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { FadeImage } from '../../kit/FadeImage.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { Menu } from '../../motion/Surfaces.tsx';
import type { ObjectRef } from '../../nav/objectRef.ts';
import { ObjectLink, useObjectOpener } from '../../nav/ObjectLink.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { MenuSurface as MenuPopover } from '../../theme/MenuSurface.tsx';
import { useDetailHeaderStyles } from './DetailHeader.tsx';
import { fitCount } from './artistRowFit.ts';
import styles from './ArtistRow.module.css';

/** 详情页头展示的单项艺术家数据 */
export interface ArtistEntry {
  readonly key: string;
  readonly name: string;
  /** 目标对象导航引用；为 null 或不可用时渲染为纯文本 */
  readonly to: ObjectRef | null;
}

/** 溢出展开按钮预留宽度（按钮尺寸加间距，单位 px） */
const ARROW_RESERVE = 32 + 12;

const useStyles = makeStyles({
  arrow: {
    width: '32px',
    minWidth: '32px',
    height: '32px',
    flexShrink: 0,
    color: 'var(--text-secondary)',
  },
  open: {
    '@media (forced-colors: none)': {
      '&:not(:disabled, [aria-disabled="true"])': { backgroundColor: 'var(--bg-chip)' },
    },
    color: 'var(--text-primary)',
  },
  menu: { minWidth: '240px' },
  list: { maxHeight: '320px', overflowY: 'auto' },
  item: { minHeight: '40px' },
  slot: { width: '28px', height: '28px', fontSize: tokens.fontSizeBase200 },
});

/** 艺术家圆形头像：加载失败展示占位图标，支持传入 ref 供视口可见性监听 */
export function ArtistAvatar({
  src,
  ref,
}: {
  readonly src?: string | null;
  readonly ref?: Ref<HTMLSpanElement>;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span ref={ref} className={styles.avatar} data-artist-avatar>
      {src && src !== failed ? (
        <FadeImage
          className={styles.image}
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(src)}
        />
      ) : (
        <Person16Regular className={styles.placeholder} />
      )}
    </span>
  );
}

export interface ArtistRowProps {
  readonly artists: readonly ArtistEntry[];
  /** 头像渲染函数；仅在可见项或下拉菜单展开时 active 为真，避免多余网络请求 */
  renderAvatar(artist: ArtistEntry, active: boolean): ReactNode;
}

/**
 * 详情页头艺术家列表行
 * 动态测算可用宽度并完整容纳胶囊项，溢出项整体隐藏并呈现展开菜单；单项或全部容纳时不显示展开按钮
 */
export function ArtistRow({ artists, renderAvatar }: ArtistRowProps) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const link = useDetailHeaderStyles();
  const controls = useViewControlStyles();
  const opener = useObjectOpener();
  const row = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(artists.length);
  const [open, setOpen] = useState(false);
  const visible = Math.min(shown, artists.length);

  useLayoutEffect(() => {
    const box = row.current;
    const items = list.current;
    if (!box || !items) return;
    const chips = [...items.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const fit = () => {
      const gap = Number.parseFloat(getComputedStyle(items).columnGap) || 0;
      const widths = chips.map((chip) => chip.offsetWidth);
      setShown(fitCount(widths, gap, box.clientWidth, ARROW_RESERVE));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    for (const chip of chips) observer.observe(chip);
    return () => observer.disconnect();
  }, [artists]);

  return (
    <div
      ref={row}
      className={styles.row}
      role="group"
      aria-label={t('detail.artists')}
      data-detail-artists
    >
      <div ref={list} className={styles.list}>
        {artists.map((artist, index) => (
          <div
            key={artist.key}
            className={styles.chip}
            data-hidden={index >= visible || undefined}
            inert={index >= visible}
          >
            {renderAvatar(artist, index < visible)}
            <ObjectLink
              to={artist.to}
              className={mergeClasses(link.link, styles.name)}
              title={artist.name}
            >
              {artist.name}
            </ObjectLink>
          </div>
        ))}
      </div>
      {visible < artists.length && (
        <Menu surfaceMotion={MENU_SURFACE_MOTION} onOpenChange={(_, data) => setOpen(data.open)}>
          <Tooltip content={t('detail.artistsMore')} relationship="label">
            <MenuTrigger disableButtonEnhancement>
              <Button
                appearance="subtle"
                shape="circular"
                className={mergeClasses(controls.icon, classes.arrow, open && classes.open)}
                icon={open ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
                aria-label={t('detail.artistsMore')}
                data-detail-artists-more
              />
            </MenuTrigger>
          </Tooltip>
          <MenuPopover className={classes.menu}>
            <MenuList className={classes.list} aria-label={t('detail.artists')}>
              {artists.map((artist) => (
                <MenuItem
                  key={artist.key}
                  className={classes.item}
                  icon={{ children: renderAvatar(artist, open), className: classes.slot }}
                  disabled={!artist.to || opener.availability(artist.to) !== 'ready'}
                  onClick={() => {
                    if (artist.to) void opener.open(artist.to);
                  }}
                >
                  {artist.name}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      )}
    </div>
  );
}
