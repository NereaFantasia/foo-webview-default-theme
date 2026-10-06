import { describe, expect, it } from 'vitest';
import { PLACES } from '../../../../src/nav/places.ts';
import {
  itemKey,
  LIBRARY_ITEMS,
  playlistKey,
  SIDEBAR_ITEMS,
  sidebarSelectionOf,
  TOP_ITEMS,
} from '../../../../src/nav/sidebar/sidebarNav.ts';

describe('sidebar nav', () => {
  it('每一项去一个一级地点，顶部只有首页；资料库六项', () => {
    expect(TOP_ITEMS.map((item) => item.place)).toEqual(['home']);
    expect(LIBRARY_ITEMS.map((item) => item.place)).toEqual([
      'recent',
      'artists',
      'albums',
      'songs',
      'genres',
      'folders',
    ]);
    for (const item of SIDEBAR_ITEMS) expect(PLACES[item.place].level).toBe(1);
  });

  it('首页、艺人、专辑、歌曲、流派、文件夹与设置上线，其余置灰', () => {
    expect(SIDEBAR_ITEMS.filter((item) => item.ready).map((item) => item.id)).toEqual([
      'home',
      'artists',
      'albums',
      'songs',
      'genres',
      'folders',
      'settings',
    ]);
    expect(SIDEBAR_ITEMS.find((item) => item.id === 'playlists')?.ready).toBe(false);
  });

  it('一级地点点亮自己那一项；二级地点点亮进它的那个一级地点', () => {
    expect(sidebarSelectionOf({ id: 'channel', subject: 'saved-channel' })).toEqual({
      kind: 'item',
      id: 'home',
    });
    expect(sidebarSelectionOf({ id: 'albums' })).toEqual({ kind: 'item', id: 'albums' });
    expect(sidebarSelectionOf({ id: 'album', subject: 'Modal Soul\0Nujabes' })).toEqual({
      kind: 'item',
      id: 'albums',
    });
    expect(sidebarSelectionOf({ id: 'artists', subject: 'Nujabes' })).toEqual({
      kind: 'item',
      id: 'artists',
    });
    expect(sidebarSelectionOf({ id: 'playlists' })).toEqual({ kind: 'item', id: 'playlists' });
  });

  it('播放列表页带着主体交给列表那一节认；搜索结果页与正在播放一项都不亮', () => {
    const guid = '{00000000-0000-0000-0000-000000000003}';
    expect(sidebarSelectionOf({ id: 'playlist', subject: guid })).toEqual({
      kind: 'playlist',
      subject: guid,
    });
    expect(sidebarSelectionOf({ id: 'playlist' })).toBeNull();
    expect(sidebarSelectionOf({ id: 'search', subject: 'feather' })).toBeNull();
    expect(sidebarSelectionOf({ id: 'nowPlaying' })).toBeNull();
  });

  it('选中键分得开固定项与列表', () => {
    expect(itemKey('albums')).toBe('item:albums');
    expect(playlistKey('{00000000-0000-0000-0000-000000000003}')).toBe(
      'playlist:{00000000-0000-0000-0000-000000000003}',
    );
  });
});
