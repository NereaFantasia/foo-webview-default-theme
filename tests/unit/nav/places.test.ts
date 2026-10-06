import { describe, expect, it } from 'vitest';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import { defaultTransition, placeName, samePlace } from '../../../src/nav/places.ts';

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
});
