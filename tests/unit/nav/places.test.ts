import { describe, expect, it } from 'vitest';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import {
  defaultTransition,
  onlineAlbumsSubject,
  onlineListSubject,
  placeName,
  readOnlineAlbumsSubject,
  readOnlineListSubject,
  samePlace,
} from '../../../src/nav/places.ts';

describe('places', () => {
  it('同一种页面、同一个主体才算同一个地点；没有主体与主体为空不同', () => {
    expect(samePlace({ id: 'albums' }, { id: 'albums' })).toBe(true);
    expect(samePlace({ id: 'album', subject: 'a' }, { id: 'album', subject: 'a' })).toBe(true);
    expect(samePlace({ id: 'album', subject: 'a' }, { id: 'album', subject: 'b' })).toBe(false);
    expect(samePlace({ id: 'playlist' }, { id: 'playlist', subject: '' })).toBe(false);
    expect(samePlace({ id: 'albums' }, { id: 'artists' })).toBe(false);
  });

  it('一级地点缺省用页面刷新，二级地点用深入；播放列表页按一级记', () => {
    expect(defaultTransition('albums')).toBe('refresh');
    expect(defaultTransition('settings')).toBe('refresh');
    expect(defaultTransition('playlist')).toBe('refresh');
    expect(defaultTransition('album')).toBe('drill');
    expect(defaultTransition('artists')).toBe('refresh');
    expect(defaultTransition('search')).toBe('drill');
  });

  it('给人看的名字：带主体的写主体，专辑只写专辑名，其余写地点名', () => {
    const t = createTranslate(zhCN, {});
    const albumKey = ['Modal Soul', 'Nujabes'].join(String.fromCharCode(0));
    expect(placeName({ id: 'albums' }, t)).toBe('专辑');
    expect(placeName({ id: 'album', subject: albumKey }, t)).toBe('Modal Soul');
    expect(placeName({ id: 'artists', subject: 'Nujabes' }, t)).toBe('Nujabes');
    expect(placeName({ id: 'search', subject: 'feather' }, t)).toBe('feather');
    expect(placeName({ id: 'playlist', subject: '0:Rock' }, t)).toBe('播放列表');
  });

  it('在线列表的主体带平台、种类、ID 与名字，读回时形状不对的不认；名字只给人看', () => {
    const t = createTranslate(zhCN, {});
    const list = {
      kind: 'album',
      ref: { platform: 'wy', id: '3426887' },
      title: 'Modal Soul',
    } as const;
    const subject = onlineListSubject(list);
    expect(readOnlineListSubject(subject)).toEqual(list);
    expect(placeName({ id: 'onlineList', subject }, t)).toBe('Modal Soul');
    expect(
      placeName({ id: 'onlineList', subject: onlineListSubject({ ...list, title: '' }) }, t),
    ).toBe('在线列表');
    expect(defaultTransition('onlineList')).toBe('drill');
    for (const bad of [
      '',
      'Modal Soul',
      JSON.stringify(['wy', 'track', '1', 'x']),
      JSON.stringify(['qq', 'album', '1', 'x']),
      JSON.stringify(['wy', 'album', '', 'x']),
      JSON.stringify(['wy', 'album', '1']),
      JSON.stringify(['wy', 'album', '1', 2]),
    ])
      expect(readOnlineListSubject(bad)).toBeNull();
  });

  it('艺人专辑墙的主体带艺人、哪一节与概览里的查找、排序、版本筛选，读回时形状不对的不认', () => {
    const t = createTranslate(zhCN, {});
    const wall = {
      ref: { platform: 'wy', id: '3684' },
      section: 'compilations',
      name: '陈奕迅',
      query: 'live',
      sort: { field: 'name', descending: false },
      versions: ['studio', 'live'],
    } as const;
    const subject = onlineAlbumsSubject(wall);
    expect(readOnlineAlbumsSubject(subject)).toEqual(wall);
    expect(placeName({ id: 'onlineAlbums', subject }, t)).toBe('陈奕迅 合集');
    expect(placeName({ id: 'onlineAlbums', subject: 'x' }, t)).toBe('艺人专辑');
    expect(defaultTransition('onlineAlbums')).toBe('drill');
    const fields = ['wy', '3684', 'albums', '陈奕迅', '', 'date', true, []];
    expect(readOnlineAlbumsSubject(JSON.stringify(fields))).not.toBeNull();
    for (const bad of [
      '',
      'not json',
      JSON.stringify(fields.slice(0, 7)),
      JSON.stringify(['qq', ...fields.slice(1)]),
      JSON.stringify(fields.map((value, index) => (index === 2 ? 'singles' : value))),
      JSON.stringify(fields.map((value, index) => (index === 6 ? 'yes' : value))),
      JSON.stringify(fields.map((value, index) => (index === 7 ? ['karaoke'] : value))),
      JSON.stringify(fields.map((value, index) => (index === 7 ? ['live', 'live'] : value))),
    ])
      expect(readOnlineAlbumsSubject(bad)).toBeNull();
  });
});
