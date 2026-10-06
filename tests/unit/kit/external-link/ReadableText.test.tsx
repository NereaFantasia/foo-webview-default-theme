import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ReadableText } from '../../../../src/kit/external-link/ReadableText.tsx';
import { BiographyArticle } from '../../../../src/library/biography/article/BiographyArticle.tsx';

test('共享展示和简介使用同一规则，HTML 仍转义，链接保留编码地址', () => {
  const url = 'https://example.com/%E4%B8%AD';
  const text = `C92\n${url}\n<img src=x>`;
  const onOpen = () => {};
  for (const content of [
    <ReadableText text={text} onOpen={onOpen} />,
    <BiographyArticle
      document={{
        artist: 'Artist',
        language: 'en',
        paragraphs: [text],
        url: 'https://www.last.fm/music/Artist/+wiki',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        license: 'CC BY-SA 4.0',
      }}
      details={null}
      facts={[]}
      t={(key) => key}
      onOpen={onOpen}
    />,
  ]) {
    const html = renderToStaticMarkup(
      <FluentProvider theme={webLightTheme}>{content}</FluentProvider>,
    );
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(`title="${url}"`);
    expect(html).toContain('https://example.com/中</a>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<img');
  }
});
