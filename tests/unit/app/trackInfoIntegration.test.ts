import { atom, createStore } from 'jotai/vanilla';
import type { Track } from 'foo-webview-sdk';
import { expect, onTestFinished, test } from 'vitest';
import {
  infoTrackFromRow,
  startTrackInfoIntegration,
} from '../../../src/app/trackInfoIntegration.ts';
import { createTrackInfoTarget } from '../../../src/shell/track-info/trackInfoTarget.ts';
import { parseRightCardPrefs, startRightCard } from '../../../src/shell/right-card/rightCard.ts';
import { startNavHistory } from '../../../src/nav/navHistory.ts';
import type { TableTrack } from '../../../src/table/tableItems.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';
import { answerTrackInfo, INFO_TRACK } from '../../fixtures/trackInfoAnswers.ts';
import { flush } from '../../fixtures/playingTrack.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

test('表格省略的字段保持未知；已有多值和分轨身份原样保留', () => {
  const row: TableTrack = {
    handle: 'E:/a.cue|subsong:3',
    path: 'file://E:/a.cue',
    absolutePath: 'E:/a.cue',
    subsong: 3,
    title: 'Third',
    artist: 'A, B',
    album: '',
    duration: 0,
    rating: 0,
    trackNumber: 0,
    discNumber: 0,
  };
  expect(infoTrackFromRow(row)).toMatchObject({
    handle: row.handle,
    subsong: 3,
    artist: 'A, B',
    artists: [],
    albumArtists: [],
    fileSize: -1,
    sampleRate: 0,
    channels: 0,
  });
  expect(
    infoTrackFromRow({
      ...row,
      artists: ['A, B', 'C'],
      albumArtists: ['D', 'E'],
      fileSize: 1024,
      sampleRate: 96000,
      channels: 6,
    }),
  ).toMatchObject({
    artists: ['A, B', 'C'],
    albumArtists: ['D', 'E'],
    fileSize: 1024,
    sampleRate: 96000,
    channels: 6,
  });
});

test('信息分页可恢复；隐藏、换分页与沉浸视图暂停，跨页和停播不丢预览', async () => {
  const host = installFakeHost();
  answerTrackInfo(host);
  const store = createStore();
  const history = startNavHistory(store);
  const wide = atom(true);
  const card = startRightCard(store, { wide }, null);
  const playing = atom<Track | null>(INFO_TRACK);
  const target = createTrackInfoTarget(store, playing);
  const documentState = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const integration = startTrackInfoIntegration(
    { store, rightCard: { card } },
    target,
    host.fb,
    documentState,
  );
  onTestFinished(() => {
    integration.dispose();
    card.dispose();
  });
  await integration.service.ready;
  expect(host.callsTo('metadata.read')).toEqual([]);
  const preview = makeTrack({ path: 'file://E:/preview.flac' });
  target.select(preview);
  card.toggle('info');
  await flush();
  expect(store.get(integration.service.state)).toMatchObject({
    track: preview,
    metadata: { status: 'ready' },
  });
  const count = host.callsTo('metadata.read').length;
  history.navigate({ id: 'songs' });
  history.navigate({ id: 'settings' });
  store.set(playing, null);
  await flush();
  expect(host.callsTo('metadata.read')).toHaveLength(count);
  expect(store.get(target.track)).toEqual(preview);
  card.select('queue');
  await flush();
  expect(store.get(integration.service.state).metadata.status).toBe('idle');
  card.select('info');
  await flush();
  expect(store.get(integration.service.state).metadata.status).toBe('ready');
  documentState.visibilityState = 'hidden';
  documentState.dispatchEvent(new Event('visibilitychange'));
  integration.service.refresh();
  await flush();
  expect(store.get(integration.service.state).metadata.status).toBe('idle');
  documentState.visibilityState = 'visible';
  documentState.dispatchEvent(new Event('visibilitychange'));
  await flush();
  history.navigate({ id: 'nowPlaying' });
  await flush();
  expect(store.get(integration.service.state).metadata.status).toBe('idle');
  history.back();
  await flush();
  expect(store.get(integration.service.state).metadata.status).toBe('ready');
  integration.dispose();
  const finalCount = host.callsTo('metadata.read').length;
  target.select(INFO_TRACK);
  documentState.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(host.callsTo('metadata.read')).toHaveLength(finalCount);
  expect(parseRightCardPrefs(JSON.stringify({ page: 'info', open: true })).page).toBe('info');
});
