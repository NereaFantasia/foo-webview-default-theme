import { MenuItem, MenuList, MenuPopover, MenuTrigger, Button } from '@fluentui/react-components';
import { Menu } from '../../motion/Surfaces.tsx';
import { MoreHorizontal20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { EMPTY_GENRE, genresQuery } from './genresModel.ts';
import { useService } from '../../kit/useService.ts';
import { genresKey } from './genresServices.ts';

export interface GenresMenuProps {
  readonly keys: readonly string[];
  readonly at?: { readonly x: number; readonly y: number } | null;
  readonly onClose?: () => void;
}

export function GenresMenu({ keys, at, onClose }: GenresMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const genres = useService(genresKey);
  const names = keys.map((key) => (key === EMPTY_GENRE ? t('genres.unknown') : key));
  const name =
    names.length === 1 ? (names[0] ?? '') : t('genres.multiple', { count: names.length });
  const unsupported = genresQuery(keys) === null;
  const menu = (
    <MenuPopover>
      <MenuList>
        <MenuItem disabled={unsupported} onClick={() => void genres.actions.play(keys, name)}>
          {t('genres.play')}
        </MenuItem>
        <MenuItem
          disabled={unsupported}
          onClick={() => void genres.actions.play(keys, name, 'shuffle')}
        >
          {t('genres.shuffle')}
        </MenuItem>
        <MenuItem
          disabled={unsupported}
          onClick={() => void genres.actions.send(keys, name, false)}
        >
          {t('genres.send')}
        </MenuItem>
        <MenuItem disabled={unsupported} onClick={() => void genres.actions.send(keys, name, true)}>
          {t('genres.autoplaylist')}
        </MenuItem>
        <MenuItem disabled={unsupported} onClick={() => genres.actions.openSongs(keys)}>
          {t('genres.openSongs')}
        </MenuItem>
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
          target: at ? { getBoundingClientRect: () => new DOMRect(at.x, at.y, 0, 0) } : undefined,
        }}
      >
        {menu}
      </Menu>
    );
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          icon={<MoreHorizontal20Regular />}
          aria-label={t('genres.more')}
        />
      </MenuTrigger>
      {menu}
    </Menu>
  );
}
