import { FluentProvider, Table, TableBody, webLightTheme } from '@fluentui/react-components';
import { atom } from 'jotai/vanilla';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import { bindService } from '../../../src/kit/serviceKey.ts';
import { serviceMap, ServicesContext } from '../../../src/kit/useService.ts';
import { objectOpenerKey, type ObjectOpener } from '../../../src/nav/objectOpener.ts';
import { TrackTableRow, type TrackTableRowProps } from '../../../src/table/TrackTableRow.tsx';
import { PlayingMark } from '../../../src/track/PlayingMark.tsx';
import type { TableTrack } from '../../../src/table/tableItems.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

/** 艺人一律打得开；专辑由 `albums` 决定在不在 */
function openerStub(albums = true): ObjectOpener {
  return {
    availability: (ref) => (ref.kind !== 'album' || albums ? 'ready' : 'missing'),
    revision: atom(0),
    isHere: () => false,
    open: () => Promise.resolve('done'),
    pending: atom(null),
    notice: atom(null),
    dismissNotice() {},
    dispose() {},
  };
}

function rowMarkup(
  track: TableTrack,
  opener: ObjectOpener = openerStub(),
  state: Partial<Pick<TrackTableRowProps, 'cells' | 'selected' | 'playing'>> = {},
) {
  return renderToStaticMarkup(
    <ServicesContext value={serviceMap([bindService(objectOpenerKey, opener)])}>
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

              artwork={undefined}
              artSize={40}
              handlers={{ click() {}, play() {}, menu() {}, rate() {} }}
              t={createTranslate(zhCN, {})}
              {...state}
            />
          </TableBody>
        </Table>
      </FluentProvider>
    </ServicesContext>,
  );
}

function cellOf(column: 'artist' | 'album', track: TableTrack, opener?: ObjectOpener) {
  const html = rowMarkup(track, opener, { cells: [column] });
  const pattern = new RegExp(`data-column-id="${column}"[^>]*>(.*?)</div>`, 's');
  const cell = pattern.exec(html)?.[1] ?? '';
  return {
    text: cell.replace(/<[^>]+>/g, '').replaceAll('&amp;', '&'),
    // 署名链接是行内文字（span 加 role=button），不是 button 元素
    buttons: [...cell.matchAll(/<[a-z]+\b[^>]*\brole="button"[^>]*>/g)].map((match) => match[0]),
  };
}
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
  it('有效多值分别画链接，空白项跳过，名字与顺序保持原样，不进 Tab 次序', () => {
    const track: TableTrack = {
      ...makeTrack({ artist: '旧的合并署名' }),
      artists: ['', 'Nujabes', '  Shing02  ', ' ', 'A & B / C feat. D'] as const,
    };
    const cell = cellOf('artist', track);
    expect(cell.text).toBe('Nujabes,   Shing02  , A & B / C feat. D');
    expect(cell.buttons).toHaveLength(3);
    for (const button of cell.buttons) expect(button).toContain('tabindex="-1"');
  });

  it.each([undefined, [], ['', '  ']])(
    '多值字段为 %j 时整串署名只显示，不当成一位艺人',
    (artists) => {
      const track: TableTrack = { ...makeTrack({ artist: 'A & B / C feat. D' }), artists };
      const cell = cellOf('artist', track);
      expect(cell.text).toBe('A & B / C feat. D');
      expect(cell.buttons).toHaveLength(0);
    },
  );

  it('名字即身份：大小写不同的分开，完全相同的只留一个', () => {
    const cell = cellOf('artist', makeTrack({ artists: ['Artist', 'artist', 'Artist'] }));
    expect(cell.text).toBe('Artist, artist');
    expect(cell.buttons).toHaveLength(2);
  });

  it('超过三位时整串是一个点击目标，点了弹菜单选人', () => {
    const cell = cellOf('artist', makeTrack({ artists: ['A', 'B', 'C', 'D'] }));
    expect(cell.text).toBe('A, B, C, D');
    expect(cell.buttons).toHaveLength(1);
    expect(cell.buttons[0]).toContain('aria-haspopup="menu"');
    expect(cell.buttons[0]).toContain('tabindex="-1"');
  });

  it('没有名字时保持空格子，不产生空链接', () => {
    const cell = cellOf('artist', makeTrack({ artist: '', artists: [] }));
    expect(cell.text).toBe('');
    expect(cell.buttons).toHaveLength(0);
  });
});

describe('曲目行的专辑列', () => {
  it('专辑在媒体库里画成链接，不在时只显示', () => {
    const track = makeTrack({ album: 'Modal Soul' });
    expect(cellOf('album', track).buttons).toHaveLength(1);
    const missing = cellOf('album', track, openerStub(false));
    expect(missing.text).toBe('Modal Soul');
    expect(missing.buttons).toHaveLength(0);
  });
});
