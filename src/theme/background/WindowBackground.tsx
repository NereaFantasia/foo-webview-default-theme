import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { baseAccentToneAtom } from '../baseAccent.ts';
import { backgroundImageAtom } from './backgroundImage.ts';
import { BackgroundImageLayers } from './BackgroundImageLayers.tsx';
import { backgroundPalette } from './backgroundPalette.ts';
import { PaletteField } from './PaletteField.tsx';
import {
  backgroundCoverAtom,
  backgroundParametersAtom,
  backgroundSourceAtom,
  backgroundTransportAtom,
} from './windowBackground.ts';
import styles from './WindowBackground.module.css';

export function WindowBackground() {
  const source = useAtomValueRawSync(backgroundSourceAtom);
  const parameters = useAtomValueRawSync(backgroundParametersAtom);
  const cover = useAtomValueRawSync(backgroundCoverAtom);
  const transport = useAtomValueRawSync(backgroundTransportAtom);
  const image = useAtomValueRawSync(backgroundImageAtom);
  const base = useAtomValueRawSync(baseAccentToneAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  }, []);
  const colors = useMemo(
    () => backgroundPalette(transport === 'stopped' ? null : cover.profile, base),
    [cover.profile, base, transport],
  );
  if (source === 'material') return null;
  const variables: CSSProperties & Record<`--${string}`, string | number> = {
    '--background-blur': `${parameters.blur}px`,
    '--background-shade': parameters.shade / 100,
    '--background-brightness': focused ? 1 : 1 - parameters.inactive / 100,
  };
  return (
    <div
      className={styles.root}
      style={variables}
      data-window-background={source}
      aria-hidden="true"
    >
      <div className={styles.art}>
        {source === 'palette' ? (
          <PaletteField
            colors={colors}
            running={transport === 'playing' && focused}
            reduced={reduced}
          />
        ) : (
          <BackgroundImageLayers
            key={source}
            url={source === 'cover' ? cover.url : image.url}
            reduced={reduced}
          />
        )}
      </div>
      <div className={styles.shade} />
    </div>
  );
}
