import { describe, expect, it } from 'vitest';
import { readMusicArtistAlbums } from '../../../src/server/musicArtistAlbums.ts';
import { musicAlbum } from '../../fixtures/music.ts';

const many = (count: number) =>
  Array.from({ length: count }, (_, index) => musicAlbum(String(index + 1)));
const page = (items: unknown[], patch: object = {}) => ({
  items,
  nextCursor: null,
  total: null,
  discardedCount: 0,
  ...patch,
});

describe('艺人专辑分页的读取', () => {
  it('一页最多 200 张，连同丢弃数不能超出', () => {
    expect(readMusicArtistAlbums(page(many(200), { nextCursor: '200', total: 523 }))).toMatchObject(
      {
        nextCursor: '200',
        total: 523,
      },
    );
    expect(readMusicArtistAlbums(page(many(201)))).toBeNull();
    expect(readMusicArtistAlbums(page(many(200), { discardedCount: 1 }))).toBeNull();
  });

  it('逐张按专辑重建：版本类别带上，额外字段不外露，重复或坏记录整页拒绝', () => {
    const live = musicAlbum('7', { kind: 'single', subType: 'live' });
    expect(
      readMusicArtistAlbums(page([{ ...live, upstream: { private: true } }, musicAlbum('8')])),
    ).toEqual(page([live, musicAlbum('8')]));
    expect(readMusicArtistAlbums(page([live, live]))).toBeNull();
    expect(readMusicArtistAlbums(page([{ ...live, kind: 'boxset' }]))).toBeNull();
    expect(readMusicArtistAlbums(page([{ ref: { platform: 'wy', id: '9' } }]))).toBeNull();
    expect(readMusicArtistAlbums(page([], { nextCursor: ' ' }))).toBeNull();
  });
});
