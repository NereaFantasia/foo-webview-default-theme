import { Next20Regular, Play20Filled, Previous20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo } from 'react';
import { globalAccentToneAtom } from '../../theme/accentState.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { playButtonColors, type PlayButtonStyle } from '../../theme/playButtonColors.ts';
import styles from './PlayButtonThumb.module.css';

/**
 * 主播放按钮样式缩略图，并排展示播控按键并按当前强调色与深浅模式实时渲染
 */
export function PlayButtonThumb({ style }: { readonly style: PlayButtonStyle }) {
  const tone = useAtomValueRawSync(globalAccentToneAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const colors = useMemo(() => playButtonColors(tone, scheme, style).rest, [tone, scheme, style]);
  return (
    <span className={styles.root}>
      <span className={styles.row}>
        <Previous20Regular className={styles.side} />
        <span
          className={styles.button}
          data-play-thumb
          style={{ backgroundColor: colors.background, color: colors.icon }}
        >
          <Play20Filled />
        </span>
        <Next20Regular className={styles.side} />
      </span>
    </span>
  );
}
