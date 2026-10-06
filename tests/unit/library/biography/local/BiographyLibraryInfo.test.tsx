import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { atom } from 'jotai/vanilla';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { biographyEn } from '../../../../../src/i18n/biographyEn.ts';
import { biographyZhCN } from '../../../../../src/i18n/biographyZhCN.ts';
import { BiographyLibraryInfo } from '../../../../../src/library/biography/local/BiographyLibraryInfo.tsx';
import type {
  BiographyLibraryService,
  BiographyLibraryState,
} from '../../../../../src/library/biography/local/biographyLibrary.ts';

for (const [locale, messages] of [
  ['zh-CN', biographyZhCN],
  ['en-US', biographyEn],
] as const) {
  test(`${locale} 摘要省略零专辑与零参与，保留曲目和时长`, () => {
    const state = atom<BiographyLibraryState>({
      artist: 'D-Fencer',
      summary: { tracks: 1, duration: 420, albums: 0, appearances: 0, collaborators: [] },
      loading: false,
      failed: false,
      truncated: false,
    });
    const service: BiographyLibraryService = {
      state,
      ready: Promise.resolve(),
      refresh() {},
      dispose() {},
    };
    const html = renderToStaticMarkup(
      <FluentProvider theme={webLightTheme}>
        <BiographyLibraryInfo service={service} locale={locale} t={(key) => messages[key]} />
      </FluentProvider>,
    );
    expect(html).toContain(locale === 'zh-CN' ? '1 首' : '1 track');
    expect(html).toContain(locale === 'zh-CN' ? '7分钟' : '7 min');
    expect(html).not.toContain(messages['biography.albumCount']);
    expect(html).not.toContain(messages['biography.guestAlbumCount']);
  });
}
