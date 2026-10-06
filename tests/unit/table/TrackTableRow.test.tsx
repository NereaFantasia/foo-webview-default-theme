import { FluentProvider, Table, TableBody, webLightTheme } from '@fluentui/react-components';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import { TrackTableRow, type TrackTableRowProps } from '../../../src/table/TrackTableRow.tsx';
import { PlayingMark } from '../../../src/track/PlayingMark.tsx';
import type { TableLinks, TableTrack } from '../../../src/table/tableItems.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

function rowMarkup(
  track: TableTrack,
  links?: TableLinks,
  state: Partial<Pick<TrackTableRowProps, 'cells' | 'selected' | 'playing'>> = {},
) {
  return renderToStaticMarkup(
    <FluentProvider theme={webLightTheme}>
      <Table noNativeElements>
        <TableBody>
          <TrackTableRow
            id="artist-row"
            index={0}
            rowIndex={2}
            level={1}
            item={{ kind: 'row', key: 'track', order: 0, track }}
            top={0}
            cells={['artist']}
            firstColumn={1}
            selected={false}
            focused={false}
            playing="none"
            PlayingMark={PlayingMark}
            rating={0}
            ratable={false}
            numberText={() => ''}
            links={links}
            artwork={undefined}
            artSize={40}
            handlers={{ click() {}, play() {}, menu() {}, rate() {} }}
            t={createTranslate(zhCN, {})}
            {...state}
          />
        </TableBody>
      </Table>
    </FluentProvider>,
  );
}

function artistCell(track: TableTrack, links?: TableLinks) {
  const html = rowMarkup(track, links);
  const cell = html.match(/data-column-id="artist"[^>]*>(.*?)<\/div>/s)?.[1] ?? '';
  return {
    text: cell.replace(/<[^>]+>/g, '').replaceAll('&amp;', '&'),
    buttons: [...cell.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]),
  };
}

const links: TableLinks = { artist() {} };

describe('曲目行的选中标记', () => {
  it.each(['none', 'paused', 'active'] as const)(
    '播放状态为 %s 时不画选中勾，保留行选中语义与播放标记',
    (playing) => {
      const html = rowMarkup(makeTrack(), undefined, {
        cells: ['status'],
        selected: true,
        playing,
      });
      expect(html).toContain('aria-selected="true"');
      expect(html).not.toContain('aria-label="已选中"');
      if (playing === 'none') expect(html).not.toContain('aria-label="正在播放"');
      else expect(html).toContain('aria-label="正在播放"');
    },
  );
});

describe('曲目行的艺人列', () => {
  it('有效多值分别画链接，空白项跳过，名字与顺序保持原样', () => {
    const track: TableTrack = {
      ...makeTrack({ artist: '旧的合并署名' }),
      artists: ['', 'Nujabes', '  Shing02  ', ' ', 'A & B / C feat. D'] as const,
    };
    const cell = artistCell(track, links);
    expect(cell.text).toBe('Nujabes,   Shing02  , A & B / C feat. D');
    expect(cell.buttons).toHaveLength(3);
    for (const button of cell.buttons) expect(button).toContain('tabindex="-1"');
  });

  it.each([undefined, [], ['', '  ']])('多值字段为 %j 时回退完整单值署名', (artists) => {
    const track: TableTrack = { ...makeTrack({ artist: 'A & B / C feat. D' }), artists };
    const cell = artistCell(track, links);
    expect(cell.text).toBe('A & B / C feat. D');
    expect(cell.buttons).toHaveLength(1);
  });

  it('没有艺人回调时仍显示多值，但不画链接', () => {
    const track = makeTrack({ artist: '合并名', artists: ['Nujabes', 'Shing02'] });
    const cell = artistCell(track, { album() {} });
    expect(cell.text).toBe('Nujabes, Shing02');
    expect(cell.buttons).toHaveLength(0);
  });

  it('重复的名字按原字段显示，不合并大小写或去重', () => {
    const cell = artistCell(makeTrack({ artists: ['Artist', 'artist', 'Artist'] }), links);
    expect(cell.text).toBe('Artist, artist, Artist');
    expect(cell.buttons).toHaveLength(3);
  });

  it('没有名字时保持空格子，不产生空链接', () => {
    const cell = artistCell(makeTrack({ artist: '', artists: [] }), links);
    expect(cell.text).toBe('');
    expect(cell.buttons).toHaveLength(0);
  });
});
