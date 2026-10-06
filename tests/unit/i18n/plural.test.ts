import { describe, expect, it } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import { pluralKey } from '../../../src/i18n/plural.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';

describe('pluralKey', () => {
  it('英文 1 取「一」那条，0 与 2 取另一条', () => {
    expect(pluralKey('en', 1, 'album.countOne', 'album.count')).toBe('album.countOne');
    expect(pluralKey('en', 0, 'album.countOne', 'album.count')).toBe('album.count');
    expect(pluralKey('en', 2, 'album.countOne', 'album.count')).toBe('album.count');
  });

  it('中文不分单复数，总是取后一条', () => {
    expect(pluralKey('zh-CN', 1, 'album.countOne', 'album.count')).toBe('album.count');
  });

  it('认不出的语言标签按不分单复数处理', () => {
    expect(pluralKey('not a tag', 1, 'album.countOne', 'album.count')).toBe('album.count');
  });

  it('英文包的「一」那几条是单数，中文包两条同文', () => {
    expect(en['album.countOne']).toBe('{count} album');
    expect(en['album.sectionCountOne']).toBe('{count} album');
    expect(en['album.menuTracksOne']).toBe('{count} track');
    expect(zhCN['album.countOne']).toBe(zhCN['album.count']);
  });

  it('删除列表的确认：英文 1 首写单数，中文两条同文', () => {
    expect(en[pluralKey('en', 1, 'playlist.removeMessageOne', 'playlist.removeMessage')]).toContain(
      '{count} track.',
    );
    expect(en[pluralKey('en', 2, 'playlist.removeMessageOne', 'playlist.removeMessage')]).toContain(
      '{count} tracks.',
    );
    expect(zhCN['playlist.removeMessageOne']).toBe(zhCN['playlist.removeMessage']);
  });
});
