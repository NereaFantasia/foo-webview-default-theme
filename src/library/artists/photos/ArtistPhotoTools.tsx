import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowCounterclockwise20Regular,
  MoreHorizontal20Regular,
  PersonCircle20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import { useArtists } from '../artistsContext.ts';

const useStyles = makeStyles({
  tool: {
    color: tokens.colorNeutralForegroundStaticInverted,
    backgroundColor: tokens.colorNeutralBackgroundStatic,
    ':hover': {
      color: tokens.colorNeutralForegroundStaticInverted,
      backgroundColor: tokens.colorNeutralBackgroundStatic,
    },
  },
});
export function ArtistPhotoTools({
  artist,
  photo,
}: {
  readonly artist: string;
  readonly photo: string;
}) {
  const { prefs } = useArtists();
  const state = useAtomValueRawSync(prefs.state);
  const t = useAtomValueRawSync(translateAtom);
  const styles = useStyles();
  return (
    <>
      <Button
        className={styles.tool}
        icon={<PersonCircle20Regular />}
        disabled={state.portraits[artist] === photo}
        onClick={() => prefs.update({ portraits: { ...state.portraits, [artist]: photo } })}
      >
        {t('artists.setPortrait')}
      </Button>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button
            className={styles.tool}
            icon={<MoreHorizontal20Regular />}
            aria-label={t('artists.more')}
          />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem
              icon={<ArrowCounterclockwise20Regular />}
              disabled={!state.portraits[artist]}
              onClick={() => {
                const portraits = { ...state.portraits };
                delete portraits[artist];
                prefs.update({ portraits });
              }}
            >
              {t('artists.resetPortrait')}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </>
  );
}
