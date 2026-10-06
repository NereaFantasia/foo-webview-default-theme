import { describe, expect, it } from 'vitest';
import { makeRow } from '../fixtures/fakePlaylists.ts';
import { formatTitle } from '../fixtures/fakeTitleFormat.ts';

const track = makeRow('Main', 6, {
  path: 'file://E:/Music/Album/07 Song.flac',
  album: 'Album',
  albumArtist: '',
  artist: 'Someone',
  date: '2001',
  discNumber: 2,
  duration: 65.4,
});

describe('formatTitle', () => {
  it('字段、字面量与 $if / $if2 / $directory_path', () => {
    expect(formatTitle("%album artist% | $if(%album%,%date%,'9999') | %tracknumber%", track)).toBe(
      'Someone | 2001 | 07',
    );
    expect(formatTitle("$if2(%genre%,none) $if2(%rating%,'0')", { ...track, genre: '' })).toBe(
      'none 0',
    );
    expect(formatTitle('$directory_path(%path%) %length%', track)).toBe(
      'file://E:/Music/Album 1:05',
    );
    expect(formatTitle("$if(%album%,'a,b',x)", { ...track, album: '' })).toBe('x');
  });

  it('认不得的字段与函数抛错，不静默写空', () => {
    expect(() => formatTitle('%composer%', track)).toThrow('%composer%');
    expect(() => formatTitle('$upper(%title%)', track)).toThrow('$upper');
  });
});
