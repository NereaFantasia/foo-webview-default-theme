import { tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { DESKTOP_LYRICS_SUNG_STEP } from '../../lyrics/desktop/desktopLyrics.ts';
import type {
  DesktopLyricsBackground,
  DesktopLyricsPalette,
} from '../../lyrics/desktop/desktopLyricsPrefs.ts';
import { accentRampAtom } from '../../theme/accentState.ts';
import { darkTheme } from '../../theme/themes.ts';
import styles from './DesktopLyricsThumb.module.css';

/** 迷你工具条占位块序列，按比例示意播控、时间与功能键 */
const TOOLS = ['key', 'key', 'key', 'time', 'icon', 'icon', 'icon', 'icon'] as const;

/**
 * 桌面歌词配置缩略图，按比例展示底板形态、工具栏与双行歌词渲染
 *
 * 底板与高亮字色由背景模式与配色选项驱动；缩略图固定采用深色底，
 * 保证白色反白字迹在浅色宿主主题下依然清晰可辨
 */
export function DesktopLyricsThumb({
  background,
  palette,
}: {
  readonly background: DesktopLyricsBackground;
  readonly palette: DesktopLyricsPalette;
}) {
  const ramp = useAtomValueRawSync(accentRampAtom);
  const sung =
    palette === 'follow'
      ? ramp[DESKTOP_LYRICS_SUNG_STEP]
      : palette === 'custom'
        ? tokens.colorPalettePinkBorderActive
        : undefined;
  return (
    <span
      className={styles.root}
      style={{ backgroundColor: darkTheme.colorNeutralBackground4 }}
      data-background={background}
      data-palette={palette}
    >
      <span className={styles.window}>
        <span className={styles.tools}>
          {TOOLS.map((tool, index) => (
            <span key={index} className={styles[tool]} />
          ))}
        </span>
        <span className={styles.main}>
          <span className={styles.sung} style={sung ? { color: sung } : undefined}>
            Keep a lantern
          </span>{' '}
          <span className={styles.unsung}>burning</span>
        </span>
        <span className={styles.sub}>请在窗边留一盏灯</span>
      </span>
      {palette === 'custom' && <span className={styles.dot} />}
    </span>
  );
}
