import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openTrackStore, type TrackStore } from '../../music/trackStore.ts';
import type { MusicTrack } from '../../../src/server/musicObjects.ts';

const OPEN: TrackStore[] = [];
const DIRECTORIES: string[] = [];

afterEach(async () => {
  for (const store of OPEN.splice(0)) store.close();
  for (const directory of DIRECTORIES.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function file() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'theme-tracks-')));
  DIRECTORIES.push(directory);
  return join(directory, 'tracks.sqlite');
}

function open(path: string, limitBytes?: number) {
  const store = openTrackStore(path, limitBytes);
  OPEN.push(store);
  return store;
}

const track = (id: string): MusicTrack => ({
  ref: { platform: 'wy', id },
  title: '曲目',
  subtitle: null,
  artists: [{ ref: { platform: 'wy', id: '3' }, name: '艺人' }],
  album: { ref: null, title: '专辑' },
  durationMs: 1000,
  artwork: null,
  qualities: ['128k'],
  access: 'free',
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('曲目库', () => {
  it('关掉再打开仍在；上游没有的记成 null；没记过的不在结果里', async () => {
    const path = await file();
    const first = openTrackStore(path);
    first.put('wy', [
      ['7', track('7')],
      ['8', null],
    ]);
    first.close();
    const found = open(path).get('wy', ['7', '8', '9']);
    expect(found.get('7')?.track?.title).toBe('曲目');
    expect(found.get('8')).toMatchObject({ track: null });
    expect(found.has('9')).toBe(false);
    expect(found.get('7')?.fetched).toBeGreaterThan(0);
  });

  it('坏行与身份对不上的行当作没有', async () => {
    const path = await file();
    open(path).put('wy', [['7', track('7')]]);
    const raw = new DatabaseSync(path);
    const insert = raw.prepare('INSERT INTO tracks (key, data, fetched, used) VALUES (?, ?, 1, 1)');
    insert.run('wy:8', '{not json');
    insert.run('wy:9', JSON.stringify(track('10')));
    raw.close();
    expect([...open(path).get('wy', ['7', '8', '9']).keys()]).toEqual(['7']);
  });

  it('超过体积上限时从最久没用到的删起', async () => {
    const size = JSON.stringify(track('1')).length + 'wy:1'.length;
    const store = open(await file(), size * 2 + 1);
    store.put('wy', [['1', track('1')]]);
    await tick();
    store.put('wy', [['2', track('2')]]);
    await tick();
    store.get('wy', ['1']);
    await tick();
    store.put('wy', [['3', track('3')]]);
    expect([...store.get('wy', ['1', '2', '3']).keys()].sort()).toEqual(['1', '3']);
  });

  it('改了账号或解灰后全部记成要补新，展示照旧', async () => {
    const store = open(await file());
    store.put('wy', [['7', track('7')]]);
    store.expire();
    expect(store.get('wy', ['7']).get('7')).toMatchObject({ fetched: 0, track: { title: '曲目' } });
  });
});
