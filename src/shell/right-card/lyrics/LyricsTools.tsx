import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import {
  Button,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  PopoverSurface,
  PopoverTrigger,
  SpinButton,
  Switch,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { MoreHorizontal16Regular, Search16Regular, TextFont16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import { useService } from '../../../kit/useService.ts';
import { lyricsDisplayKey } from '../../../lyrics/lyricsDisplay.ts';
import { Menu, Popover } from '../../../motion/Surfaces.tsx';

const useStyles = makeStyles({
  surface: {
    display: 'grid',
    gap: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  size: { width: '120px' },
});
export function LyricsTools({
  ready,
  timed,
  disabled,
  onSearch,
  onDetails,
  onTiming,
  onSettings,
  onAutomatic,
  onOpenChange,
}: {
  readonly ready: boolean;
  readonly timed: boolean;
  readonly disabled: boolean;
  onSearch(): void;
  onDetails(): void;
  onTiming(): void;
  onSettings(): void;
  onAutomatic(): void;
  onOpenChange(open: boolean): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(lyricsDisplayKey);
  const display = useAtomValueRawSync(service.display);
  const classes = useStyles();
  const controls = useViewControlStyles();
  return (
    <>
      <Tooltip content={t('lyrics.search')} relationship="label">
        <Button
          appearance="subtle"
          className={controls.icon}
          icon={<Search16Regular />}
          disabled={disabled}
          onClick={onSearch}
        />
      </Tooltip>
      <Popover
        positioning={{
          position: 'below',
          align: 'end',
          overflowBoundaryPadding: 12,
          autoSize: 'width',
        }}
        onOpenChange={(_, data) => onOpenChange(data.open)}
      >
        <PopoverTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            className={controls.icon}
            icon={<TextFont16Regular />}
            aria-label={t('lyrics.display')}
          />
        </PopoverTrigger>
        <PopoverSurface className={classes.surface} data-right-card-surface>
          <strong>{t('lyrics.display')}</strong>
          <SpinButton
            className={mergeClasses(classes.size, controls.field)}
            aria-label={t('lyrics.fontSize')}
            min={12}
            max={48}
            value={display.fontSize}
            onChange={(_, data) => {
              const fontSize = data.value ?? Number(data.displayValue);
              if (Number.isFinite(fontSize)) void service.update({ fontSize });
            }}
          />
          {(['showTranslation', 'showRomanization'] as const).map((name) => (
            <Switch
              key={name}
              label={t(`lyrics.${name}`)}
              checked={display[name]}
              onChange={(_, data) => void service.update({ [name]: data.checked })}
            />
          ))}
          <Button appearance="subtle" className={controls.field} onClick={onSettings}>
            {t('lyrics.settings')}
          </Button>
        </PopoverSurface>
      </Popover>
      <Menu onOpenChange={(_, data) => onOpenChange(data.open)}>
        <MenuTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            className={controls.icon}
            icon={<MoreHorizontal16Regular />}
            aria-label={t('lyrics.more')}
          />
        </MenuTrigger>
        <MenuPopover data-right-card-surface>
          <MenuList>
            <MenuItem disabled={!ready} onClick={onDetails}>
              {t('lyrics.details')}
            </MenuItem>
            <MenuItem disabled={!timed} onClick={onTiming}>
              {t('lyrics.timing')}
            </MenuItem>
            <MenuItem disabled={!ready} onClick={onAutomatic}>
              {t('lyrics.restoreAutomatic')}
            </MenuItem>
            <MenuItem onClick={onSettings}>{t('lyrics.settings')}</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </>
  );
}
