import {
  mergeClasses,
  Button,
  Menu,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSync16Regular,
  ChevronDown16Regular,
  Copy16Regular,
  Eye16Regular,
  MoreHorizontal16Regular,
  Play12Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { Translate } from '../../i18n/translate.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import type { TrackInfoService } from './trackInfo.ts';
import type { TrackInfoTarget } from './trackInfoTarget.ts';
import { infoMediaKind } from './trackInfoModel.ts';
import cardStyles from '../right-card/RightCard.module.css';
import styles from './TrackInfoToolbar.module.css';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

const useStyles = makeStyles({
  source: {
    minWidth: '0',
    minHeight: '28px',
    padding: '0',
    border: '0',
    columnGap: tokens.spacingHorizontalSNudge,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase400,
  },
  sourceIcon: {
    width: '12px',
    height: '12px',
    fontSize: '12px',
    color: tokens.colorBrandForeground1,
  },
  icon: {
    minWidth: '28px',
    width: '28px',
    height: '28px',
    color: tokens.colorNeutralForeground3,
  },
});

export function TrackInfoToolbar({
  service,
  target,
  t,
  locale,
}: {
  readonly service: TrackInfoService;
  readonly target: TrackInfoTarget;
  readonly t: Translate;
  readonly locale: string;
}) {
  const controls = useViewControlStyles();
  const source = useAtomValueRawSync(target.source);
  const preview = useAtomValueRawSync(target.preview);
  const state = useAtomValueRawSync(service.state);
  const classes = useStyles();
  const SourceIcon = source === 'preview' ? Eye16Regular : Play12Regular;
  return (
    <div className={`${cardStyles.toolbar} ${styles.root}`}>
      <Menu surfaceMotion={MENU_SURFACE_MOTION} checkedValues={{ source: [source] }}>
        <MenuTrigger disableButtonEnhancement>
          <Button
            className={mergeClasses(classes.source, controls.icon)}
            appearance="subtle"
            size="small"
            icon={{ children: <SourceIcon />, className: classes.sourceIcon }}
            aria-label={t('trackInfo.follow')}
          >
            {t(source === 'preview' ? 'trackInfo.preview' : 'trackInfo.playing')}
            <ChevronDown16Regular />
          </Button>
        </MenuTrigger>
        <MenuPopover data-right-card-surface>
          <MenuList>
            <MenuItemRadio name="source" value="playing" onClick={() => target.follow('playing')}>
              {t('trackInfo.playing')}
            </MenuItemRadio>
            <MenuItemRadio
              name="source"
              value="preview"
              disabled={!preview}
              onClick={() => target.follow('preview')}
            >
              {t('trackInfo.preview')}
            </MenuItemRadio>
          </MenuList>
        </MenuPopover>
      </Menu>
      <div className={cardStyles.toolbarActions}>
        <Menu surfaceMotion={MENU_SURFACE_MOTION}>
          <MenuTrigger disableButtonEnhancement>
            <Button
              className={mergeClasses(classes.icon, controls.icon)}
              appearance="subtle"
              size="small"
              icon={<MoreHorizontal16Regular />}
              aria-label={t('rightCard.more')}
            />
          </MenuTrigger>
          <MenuPopover data-right-card-surface>
            <MenuList>
              <MenuItem
                icon={<Copy16Regular />}
                disabled={!state.track || state.action === 'copying'}
                onClick={() => void service.copyAll(t, locale)}
              >
                {t('trackInfo.copyAll')}
              </MenuItem>
              <MenuItem
                icon={<ArrowSync16Regular />}
                disabled={
                  !state.track ||
                  infoMediaKind(state.track) === 'stream' ||
                  state.metadata.status === 'loading'
                }
                onClick={() => service.refresh()}
              >
                {t('trackInfo.refresh')}
              </MenuItem>
              <MenuItem
                icon={<Copy16Regular />}
                disabled={state.metadata.status !== 'ready'}
                onClick={() => void service.copyTags()}
              >
                {t('trackInfo.copyTags')}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
    </div>
  );
}
