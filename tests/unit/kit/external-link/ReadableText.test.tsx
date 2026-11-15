import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ReadableText } from '../../../../src/kit/external-link/ReadableText.tsx';
import { BiographyArticle } from '../../../../src/library/biography/article/BiographyArticle.tsx';

test('文章页脚按来源署名：Apple 来源写 Apple Music 并链回艺人页，不出许可', () => {
  const url = 'https://music.apple.com/cn/artist/queen/3296287';
  const html = renderToStaticMarkup(
    <FluentProvider theme={webLightTheme}>
      <BiographyArticle
        document={{
          source: 'apple',
          sourceId: '3296287',
          artist: 'Queen',
          language: 'en',
          paragraphs: ['Text.'],
          url,
          attribution: { name: 'Apple Music', url },
        }}
        details={null}
        facts={[]}
        t={(key) => key}
        onOpen={() => {}}
      />
    </FluentProvider>,
  );
  expect(html).toContain('Apple Music');
  expect(html).not.toContain('CC BY-SA');
  expect(html).not.toContain('biography.source');
});

test('共享展示和简介使用同一规则，HTML 仍转义，链接保留编码地址', () => {
  const url = 'https://example.com/%E4%B8%AD';
  const text = `C92\n${url}\n<img src=x>`;
  const onOpen = () => {};
  for (const content of [
    <ReadableText text={text} onOpen={onOpen} />,
    <BiographyArticle
      document={{
        source: 'lastfm',
        sourceId: 'Artist',
        artist: 'Artist',
        language: 'en',
        paragraphs: [text],
        url: 'https://www.last.fm/music/Artist/+wiki',
        attribution: {
          name: 'Last.fm',
          url: 'https://www.last.fm/music/Artist/+wiki',
          license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
        },
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
