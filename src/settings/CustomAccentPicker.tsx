import {
  Button,
  Input,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  makeStyles,
} from '@fluentui/react-components';
import { hexFromArgb, TonalPalette } from '@material/material-color-utilities';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useState } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { chooseCustomAccent, customAccentAtom, isAccentHex } from '../theme/baseAccent.ts';
import { tealBrand } from '../theme/brand.ts';
import styles from './CustomAccentPicker.module.css';
import { useViewControlStyles } from '../theme/controlStyles.ts';

const COLORS = [
  tealBrand[100],
  ...[20, 50, 90, 150, 200, 250, 290, 340].map((hue) =>
    hexFromArgb(TonalPalette.fromHueAndChroma(hue, 48).tone(65)),
  ),
];
const useStyles = makeStyles({ input: { width: '150px', minWidth: '0' } });

export function CustomAccentPicker() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const color = useAtomValueRawSync(customAccentAtom);
  const [draft, setDraft] = useState(color);
  const classes = useStyles();
  useEffect(() => {
    setDraft(color);
  }, [color]);
  return (
    <Popover positioning="below-end">
      <PopoverTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          className={viewControls.icon}
          aria-label={t('settings.customAccent')}
          title={t('settings.customAccent')}
          icon={<span className={styles.preview} style={{ backgroundColor: color }} />}
        />
      </PopoverTrigger>
      <PopoverSurface aria-label={t('settings.customAccent')}>
        <div className={styles.picker}>
          <div className={styles.swatches} role="group" aria-label={t('settings.accentPalette')}>
            {COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={styles.swatch}
                aria-label={swatch}
                title={swatch}
                aria-pressed={color === swatch}
                style={{ backgroundColor: swatch }}
                onClick={() => chooseCustomAccent(store, swatch)}
              />
            ))}
          </div>
          <div className={styles.editor}>
            <input
              className={styles.native}
              type="color"
              value={color}
              aria-label={t('settings.pickAccent')}
              title={t('settings.pickAccent')}
              onChange={(event) => chooseCustomAccent(store, event.currentTarget.value)}
            />
            <Input
              className={classes.input}
              value={draft}
              aria-label={t('settings.accentHex')}
              aria-invalid={!isAccentHex(draft)}
              onChange={(_, data) => {
                setDraft(data.value);
                chooseCustomAccent(store, data.value);
              }}
              onBlur={() => setDraft(color)}
            />
          </div>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
