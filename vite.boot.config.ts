import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Theme } from '@fluentui/react-components';
import { lightTheme, darkTheme } from './src/theme/themes.ts';

const KEYS: readonly (keyof Theme)[] = [
  'spacingVerticalXXL',
  'spacingVerticalM',
  'spacingVerticalS',
  'spacingHorizontalXL',
  'spacingHorizontalM',
  'colorNeutralForeground1',
  'colorNeutralBackground1',
  'colorNeutralBackground1Hover',
  'colorNeutralStroke1',
  'colorStrokeFocus2',
  'fontFamilyBase',
  'fontSizeBase500',
  'lineHeightBase500',
  'fontWeightSemibold',
  'fontSizeBase300',
  'lineHeightBase300',
  'strokeWidthThin',
  'strokeWidthThick',
  'borderRadiusMedium',
];
const css = (theme: Theme) => KEYS.map((key) => `--${key}:${theme[key]};`).join('');

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/boot/main.ts',
      formats: ['iife'],
      name: 'DefaultThemeLoader',
      fileName: () => 'loader.js',
    },
  },
  plugins: [
    {
      name: 'inline-theme-loader',
      generateBundle(_, bundle) {
        const chunks = Object.values(bundle).filter((entry) => entry.type === 'chunk');
        const script = chunks[0];
        if (chunks.length !== 1 || !script) throw new Error('引导页必须只生成一段内联脚本');
        const template = readFileSync(
          fileURLToPath(new URL('./src/boot/index.html', import.meta.url)),
          'utf8',
        );
        if (
          !template.includes('<!-- __BOOT_SCRIPT__ -->') ||
          !template.includes('/* __BOOT_THEME__ */')
        )
          throw new Error('引导页模板缺少构建位置');
        const html = template
          .replace(
            '/* __BOOT_THEME__ */',
            `#boot{${css(lightTheme)}}@media(prefers-color-scheme:dark){#boot{${css(darkTheme)}}}`,
          )
          .replace(
            '<!-- __BOOT_SCRIPT__ -->',
            `<script>${script.code.replace(/<\/script/gi, '<\\/script')}</script>`,
          );
        for (const key of Object.keys(bundle)) delete bundle[key];
        this.emitFile({ type: 'asset', fileName: 'index.html', source: html });
      },
    },
  ],
});
