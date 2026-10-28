import { FluentProvider, Table, TableBody, webLightTheme } from '@fluentui/react-components';
import { atom } from 'jotai/vanilla';
import { useState } from 'react';
import { createTranslate } from '../../src/i18n/translate.ts';
import { zhCN } from '../../src/i18n/zhCN.ts';
import { bindService } from '../../src/kit/serviceKey.ts';
import { serviceMap, ServicesContext } from '../../src/kit/useService.ts';
import { objectOpenerKey, type ObjectOpener } from '../../src/nav/objectOpener.ts';
import { TrackTableRow, type RowHandlers } from '../../src/table/TrackTableRow.tsx';
import { PlayingMark } from '../../src/track/PlayingMark.tsx';
import { makeTrack } from './tracks.ts';

const t = createTranslate(zhCN, {});

/** 比任何一格都宽的署名；`many` 时四位，超过三位整串成一个入口 */
const LONG_NAME = '鸣潮先约电台/jixwang/庞雪倩/陈乐一/Lily Kate/沐可Linda/TLK天翔/Lorien '.repeat(
  6,
);

function artistsOf(query: URLSearchParams): string[] {
  if (query.has('long')) {
    return query.has('many') ? ['A', 'B', 'C', LONG_NAME] : [LONG_NAME];
  }
  if (query.has('fallback')) return [];
  if (query.has('many')) return ['Nujabes', 'Shing02', 'Fat Jon', 'Pase Rock', 'Substantial'];
  return ['Nujabes', '  Shing02  ', 'A & B / C feat. D'];
}

/**
 * 一行曲目的艺人格。打开服务换成记录调用的替身：`plain` 时全部打不开，其余一律打得开
 */
export function ArtistLinksHarness() {
  const query = new URLSearchParams(location.search);
  const track = makeTrack({ artist: 'A & B / C feat. D', artists: artistsOf(query) });
  const [events, setEvents] = useState<readonly unknown[]>([]);
  const record = (event: unknown) => setEvents((previous) => [...previous, event]);
  const [services] = useState(() => {
    const opener: ObjectOpener = {
      availability: () => (query.has('plain') ? 'missing' : 'ready'),
      revision: atom(0),
      isHere: () => false,
      open(ref) {
        record({ kind: 'open', ref });
        return Promise.resolve('done');
      },
      pending: atom(null),
      notice: atom(null),
      dismissNotice() {},
      dispose() {},
    };
    return serviceMap([bindService(objectOpenerKey, opener)]);
  });
  const handlers: RowHandlers = {
    click(index, event) {
      record({
        kind: 'select',
        index,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        meta: event.metaKey,
      });
    },
    play(index) {
      record({ kind: 'play', index });
    },
    menu() {},
    rate() {},
  };
  return (
    <ServicesContext value={services}>
      <FluentProvider theme={webLightTheme}>
        <button type="button" data-before>
          表格之前
        </button>
        <Table noNativeElements style={{ position: 'relative', height: 80 }}>
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
              playing="active"
              PlayingMark={PlayingMark}
              rating={0}
              ratable={false}
              numberText={() => ''}
              artwork={undefined}
              artSize={40}
              handlers={handlers}
              t={t}
            />
          </TableBody>
        </Table>
        <button type="button" data-after>
          表格之后
        </button>
        <output data-log>{JSON.stringify(events)}</output>
      </FluentProvider>
    </ServicesContext>
  );
}
