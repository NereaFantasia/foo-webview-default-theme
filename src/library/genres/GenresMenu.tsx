import { MenuItem, MenuList, MenuTrigger, Button } from '@fluentui/react-components';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import type { QueryFill } from '../libraryQueryFill.ts';
import { MoreHorizontal20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { EMPTY_GENRE } from '../../nav/places.ts';
import { genresCatalogAtom } from './genresCatalog.ts';
import { genresQuery } from './genresModel.ts';
import { useRetained } from '../../kit/useRetained.ts';
import { useService } from '../../kit/useService.ts';
import { genresKey } from './genresServices.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

export interface GenresMenuProps {
  readonly keys: readonly string[];
  readonly at?: { readonly x: number; readonly y: number } | null;
  readonly onClose?: () => void;
  readonly fill?: QueryFill | null;
}

export function GenresMenu({ keys, at, onClose, fill }: GenresMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const genres = useService(genresKey);
  const catalog = useAtomValueRawSync(genresCatalogAtom);
  // 关闭时落点先被清空，退场动画里菜单要按关闭前的落点画，不然会跳到左上角再消失
  const shownAt = useRetained(at);
  const names = keys.map((key) => (key === EMPTY_GENRE ? t('genres.unknown') : key));
  const name =
    names.length === 1 ? (names[0] ?? '') : t('genres.multiple', { count: names.length });
  const unsupported = genresQuery(keys) === null || fill === null;
  const menu = (
    <MenuPopover>
      <MenuList>
        <MenuItem
          disabled={unsupported}
          onClick={() => void genres.actions.play(keys, name, undefined, fill ?? undefined)}
        >
          {t('genres.play')}
        </MenuItem>
        <MenuItem
          disabled={unsupported}
          onClick={() => void genres.actions.play(keys, name, 'shuffle', fill ?? undefined)}
        >
          {t('genres.shuffle')}
        </MenuItem>
        <MenuItem
          disabled={unsupported}
          onClick={() => void genres.actions.send(keys, name, false, fill ?? undefined)}
        >
          {t('genres.send')}
        </MenuItem>
        <MenuItem
          disabled={unsupported}
          onClick={() => void genres.actions.send(keys, name, true, fill ?? undefined)}
        >
          {t('genres.autoplaylist')}
        </MenuItem>
        <MenuItem
          disabled={unsupported}
          onClick={() => genres.actions.openSongs(keys, fill ?? undefined)}
        >
          {t('genres.openSongs')}
        </MenuItem>
        {keys.some((key) => catalog.issues.has(key)) ? (
          <MenuItem onClick={() => genres.tidy.ignore(keys)}>{t('genres.ignore')}</MenuItem>
        ) : null}
        <MenuItem onClick={() => void genres.actions.copy(names.join('\n'))}>
          {t('genres.copy')}
        </MenuItem>
      </MenuList>
    </MenuPopover>
  );
  if (at !== undefined)
    return (
      <Menu
        open={at !== null}
        onOpenChange={(_, data) => {
          if (!data.open) onClose?.();
        }}
        positioning={{
          target: shownAt
            ? { getBoundingClientRect: () => new DOMRect(shownAt.x, shownAt.y, 0, 0) }
            : undefined,
        }}
      >
        {menu}
      </Menu>
    );
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button
          className={viewControls.icon}
          appearance="subtle"
          icon={<MoreHorizontal20Regular />}
          aria-label={t('genres.more')}
        />
      </MenuTrigger>
      {menu}
    </Menu>
  );
}
