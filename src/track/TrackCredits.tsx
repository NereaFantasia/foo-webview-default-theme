import { Link, MenuItem, MenuList, mergeClasses } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { Fragment, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { ScrollMenu, ScrollMenuPopover } from '../kit/ScrollMenuPopover.tsx';
import {
  isPlainClick,
  ObjectLink,
  useObjectLinkStyles,
  useObjectOpener,
} from '../nav/ObjectLink.tsx';
import { onlineTracksAtom } from '../playback/onlineTracks.ts';
import { trackLinks, type LinkableTrack, type LinkedName, type TrackLinks } from './trackLinks.ts';

/** 去重后超过这么多位艺人，整串成一个点击目标，点了弹菜单选人 */
export const MAX_INLINE_ARTISTS = 3;

export function useTrackLinks(track: LinkableTrack): TrackLinks {
  return trackLinks(track, useAtomValueRawSync(onlineTracksAtom));
}

interface CreditStyle {
  /** 外层：截断、颜色这类整段的样式 */
  readonly className?: string;
  /** 每个名字：表格里要让单个链接也能截断 */
  readonly linkClassName?: string;
  readonly tabIndex?: number;
  readonly origin?: string;
}

export interface CreditProps extends CreditStyle {
  readonly track: LinkableTrack;
}

/** 专辑名：能跳的可点，其余只显示。名字与去向由调用方给，曲目的取法见 `TrackAlbum` */
export function LinkedAlbum({
  album,
  className,
  linkClassName,
  tabIndex,
  origin,
}: { readonly album: LinkedName | null } & CreditStyle) {
  const text = album?.text ?? '';
  return (
    <span className={className} title={text}>
      <ObjectLink
        to={album?.ref ?? null}
        className={linkClassName}
        tabIndex={tabIndex}
        origin={origin}
      >
        {text}
      </ObjectLink>
    </span>
  );
}

/** 艺人署名：不超过 `MAX_INLINE_ARTISTS` 位时每个名字各自可点，再多整串点了弹菜单选人 */
export function LinkedArtists({
  artists,
  ...style
}: { readonly artists: readonly LinkedName[] } & CreditStyle) {
  const t = useAtomValueRawSync(translateAtom);
  const separator = t('album.nameSeparator');
  const title = artists.map((artist) => artist.text).join(separator);
  if (artists.length > MAX_INLINE_ARTISTS) {
    return <ArtistsMenu {...style} artists={artists} separator={separator} title={title} />;
  }
  return (
    <span className={style.className} title={title}>
      {artists.map((artist, index) => (
        <Fragment key={`${index}:${artist.text}`}>
          {index > 0 && separator}
          <ObjectLink
            to={artist.ref}
            className={style.linkClassName}
            tabIndex={style.tabIndex}
            origin={style.origin}
          >
            {artist.text}
          </ObjectLink>
        </Fragment>
      ))}
    </span>
  );
}

/** 一首曲目的专辑名 */
export function TrackAlbum({ track, ...style }: CreditProps) {
  return <LinkedAlbum album={useTrackLinks(track).album} {...style} />;
}

/** 一首曲目的艺人署名 */
export function TrackArtists({ track, ...style }: CreditProps) {
  return <LinkedArtists artists={useTrackLinks(track).artists} {...style} />;
}

/**
 * 艺人多值展开弹出菜单
 *
 * 拦截 Portal 事件沿 React 树冒泡，避免干扰外部行选择与键盘按键响应；
 * 候选艺人较多时受限于视口高度并在菜单内部滚动
 */
const stop = (event: SyntheticEvent) => event.stopPropagation();

function ArtistsMenu(
  props: CreditStyle & {
    readonly artists: readonly LinkedName[];
    readonly separator: string;
    readonly title: string;
  },
) {
  const t = useAtomValueRawSync(translateAtom);
  const opener = useObjectOpener();
  const styles = useObjectLinkStyles();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const picked = useRef(0);
  const items = useRef<(HTMLElement | null)[]>([]);
  // 在 Menu 自己把焦点放到第一项之后执行：父组件的 effect 晚于子组件
  useEffect(() => {
    if (open) items.current[picked.current]?.focus();
  }, [open]);

  return (
    <span className={props.className} title={props.title}>
      <Link
        ref={setAnchor}
        as="span"
        appearance="subtle"
        className={mergeClasses(styles.link, props.linkClassName)}
        tabIndex={props.tabIndex}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          if (!isPlainClick(event)) return;
          event.stopPropagation();
          const credit =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>('[data-credit]')?.dataset.credit
              : undefined;
          picked.current = Number(credit ?? 0);
          setOpen(true);
        }}
        onDoubleClick={stop}
        onPointerDown={stop}
      >
        {props.artists.map((artist, index) => (
          <Fragment key={`${index}:${artist.text}`}>
            {index > 0 && props.separator}
            <span data-credit={index}>{artist.text}</span>
          </Fragment>
        ))}
      </Link>
      <ScrollMenu
        open={open}
        onOpenChange={(_, data) => setOpen(data.open)}
        positioning={{ target: anchor, position: 'below', align: 'start' }}
      >
        <ScrollMenuPopover
          onClick={stop}
          onDoubleClick={stop}
          onContextMenu={stop}
          onKeyDown={stop}
          onPointerDown={stop}
        >
          <MenuList aria-label={t('trackMenu.goToArtist')}>
            {props.artists.map((artist, index) => {
              const ref = artist.ref;
              const ready = ref !== null && opener.availability(ref) === 'ready';
              const here = ready && opener.isHere(ref);
              return (
                <MenuItem
                  key={`${index}:${artist.text}`}
                  ref={(node) => {
                    items.current[index] = node;
                  }}
                  disabled={!ready}
                  secondaryContent={
                    here
                      ? t('trackMenu.currentPlace')
                      : ready
                        ? undefined
                        : t('trackMenu.noArtistPage')
                  }
                  onClick={() => {
                    if (ref) void opener.open(ref, { origin: props.origin });
                  }}
                >
                  {artist.text}
                </MenuItem>
              );
            })}
          </MenuList>
        </ScrollMenuPopover>
      </ScrollMenu>
    </span>
  );
}
