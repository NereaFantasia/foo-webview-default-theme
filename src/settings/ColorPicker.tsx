import { Button, Input, Popover, PopoverTrigger, makeStyles } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { PopoverSurface } from '../theme/PopoverSurface.tsx';
import styles from './ColorPicker.module.css';

const HEX = /^#[0-9a-f]{6}$/i;
const useStyles = makeStyles({ input: { width: '150px', minWidth: '0' } });

export interface ColorPickerProps {
  /** 当前颜色，`#rrggbb` */
  readonly value: string;
  /** 键与浮层的无障碍名 */
  readonly label: string;
  /** 预设色板，`#rrggbb` */
  readonly colors: readonly string[];
  /** 选了色板里的一色、用系统取色器取了色，或输入了完整的 `#rrggbb` */
  onChange(color: string): void;
}

/**
 * 取色键：键上是当前颜色的圆点，点开是预设色板、系统取色器与十六进制输入框。输入到一半不成色时不报，
 * 离开输入框回到当前颜色
 */
export function ColorPicker({ value, label, colors, onChange }: ColorPickerProps) {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const [draft, setDraft] = useState(value);
  const classes = useStyles();
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <Popover positioning="below-end">
      <PopoverTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          className={viewControls.icon}
          aria-label={label}
          title={label}
          icon={<span className={styles.preview} style={{ backgroundColor: value }} />}
        />
      </PopoverTrigger>
      <PopoverSurface aria-label={label}>
        <div className={styles.picker}>
          <div className={styles.swatches} role="group" aria-label={t('settings.accentPalette')}>
            {colors.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={styles.swatch}
                aria-label={swatch}
                title={swatch}
                aria-pressed={value.toLowerCase() === swatch.toLowerCase()}
                style={{ backgroundColor: swatch }}
                onClick={() => onChange(swatch.toLowerCase())}
              />
            ))}
          </div>
          <div className={styles.editor}>
            <input
              className={styles.native}
              type="color"
              value={value}
              aria-label={t('settings.pickAccent')}
              title={t('settings.pickAccent')}
              onChange={(event) => onChange(event.currentTarget.value.toLowerCase())}
            />
            <Input
              className={classes.input}
              value={draft}
              aria-label={t('settings.accentHex')}
              aria-invalid={!HEX.test(draft)}
              onChange={(_, data) => {
                setDraft(data.value);
                if (HEX.test(data.value)) onChange(data.value.toLowerCase());
              }}
              onBlur={() => setDraft(value)}
            />
          </div>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
