import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TopTrackList } from '../../../../src/library/detail/TopTrackList.tsx';

/** 读出列表上写的两栏、三栏每栏排几行 */
function rows(count: number, expanded = false) {
  const html = renderToStaticMarkup(
    <TopTrackList count={count} label="热门歌曲" expanded={expanded}>
      {null}
    </TopTrackList>,
  );
  const two = /--top-rows-2:(\d+)/.exec(html)?.[1];
  const three = /--top-rows-3:(\d+)/.exec(html)?.[1];
  return { two: Number(two), three: Number(three), expanded: html.includes('data-expanded') };
}

describe('热门曲目的栏数', () => {
  it('不展开时两栏最多 10 首、三栏最多 12 首，按栏排，每栏的行数向上取整', () => {
    expect(rows(50)).toEqual({ two: 5, three: 4, expanded: false });
    expect(rows(7)).toEqual({ two: 4, three: 3, expanded: false });
    expect(rows(1)).toEqual({ two: 1, three: 1, expanded: false });
  });

  it('展开后各栏都露全部：50 首两栏每栏 25 行、三栏每栏 17 行', () => {
    expect(rows(50, true)).toEqual({ two: 25, three: 17, expanded: true });
    // 不足露出数时展开与否一样
    expect(rows(8, true)).toEqual({ two: 4, three: 3, expanded: true });
  });
});
