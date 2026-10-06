import { FluentProvider, Table, TableBody, webLightTheme } from '@fluentui/react-components';
import { useState } from 'react';
import { createTranslate } from '../../src/i18n/translate.ts';
import { zhCN } from '../../src/i18n/zhCN.ts';
import { TrackTableRow, type RowHandlers } from '../../src/table/TrackTableRow.tsx';
import { PlayingMark } from '../../src/track/PlayingMark.tsx';
import { makeTrack } from './tracks.ts';

const t = createTranslate(zhCN, {});

export function ArtistLinksHarness() {
  const query = new URLSearchParams(location.search);
  const track = makeTrack({
    artist: 'A & B / C feat. D',
    artists: query.has('fallback') ? [] : ['Nujabes', '  Shing02  ', 'A & B / C feat. D'],
  });
  const [events, setEvents] = useState<readonly unknown[]>([]);
  const record = (event: unknown) => setEvents((previous) => [...previous, event]);
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
            links={
              query.has('plain')
                ? undefined
                : {
                    artist(name, clicked) {
                      record({
                        kind: 'artist',
                        name,
                        sameTrack: clicked === track,
                        track: clicked,
                      });
                    },
                  }
            }
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
  );
}
