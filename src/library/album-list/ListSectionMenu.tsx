import { MenuDivider, MenuItem, MenuList, MenuPopover } from '@fluentui/react-components';
import { Menu } from '../../motion/Surfaces.tsx';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { MenuCaption } from '../../kit/MenuCaption.tsx';
import type { TablePoint } from '../../table/tableItems.ts';
import type { ListSection } from './albumListModel.ts';
import { useService } from '../../kit/useService.ts';
import { albumListKey } from './albumList.ts';

export interface ListSectionMenuProps {
  /** 开在哪一节的节头上；null 是关着。 */
  readonly target: { readonly section: ListSection; readonly at: TablePoint } | null;
  readonly onClose: () => void;
}

/**
 * 节头的右键菜单：这一节的专辑全展开、全折叠，只展开这一节，再加上与页头键相同的全部展开、全部折叠。
 * 关掉后焦点交还打开前拿着它的那一处（表格）。
 */
export function ListSectionMenu({ target, onClose }: ListSectionMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const albumList = useService(albumListKey);
  const open = target !== null;
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      returnTo.current = document.activeElement;
    }
  }, [open]);
  const at = target?.at;
  const anchor = useMemo(
    () => at && { getBoundingClientRect: () => new DOMRect(at.x, at.y, 0, 0) },
    [at],
  );
  const section = target?.section;
  const key = section?.key ?? null;
  const albums = section?.albums.length ?? 0;
  const tracks = section ? section.span.end - section.span.start : 0;
  const meta = [
    t(plural(albums, 'album.countOne', 'album.count'), { count: albums }),
    t(plural(tracks, 'album.menuTracksOne', 'album.menuTracks'), { count: tracks }),
  ].join(' · ');

  return (
    <Menu
      open={open}
      onOpenChange={(_, data) => {
        if (data.open) return;
        onClose();
        returnTo.current?.focus({ preventScroll: true });
      }}
      positioning={{ target: anchor, position: 'below', align: 'start' }}
    >
      <MenuPopover data-list-section-menu>
        <MenuList aria-label={t('albumList.sectionMenu')}>
          <MenuCaption title={key ?? t('album.unknownSection')} meta={meta} />
          <MenuDivider />
          <MenuItem
            data-action="expand-section"
            onClick={() => albumList.sectionBatch(key, 'expandAlbums')}
          >
            {t('albumList.expandSection')}
          </MenuItem>
          <MenuItem
            data-action="collapse-section"
            onClick={() => albumList.sectionBatch(key, 'collapseAlbums')}
          >
            {t('albumList.collapseSection')}
          </MenuItem>
          <MenuItem data-action="only-section" onClick={() => albumList.sectionBatch(key, 'only')}>
            {t('albumList.onlySection')}
          </MenuItem>
          <MenuDivider />
          <MenuItem data-action="expand-all" onClick={() => albumList.batch('expandAll')}>
            {t('albumList.expandAll')}
          </MenuItem>
          <MenuItem data-action="collapse-all" onClick={() => albumList.batch('collapseAll')}>
            {t('albumList.collapseAll')}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
