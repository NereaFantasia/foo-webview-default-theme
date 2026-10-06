import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  artistWritePlan,
  startArtistWrites,
} from '../../../../src/library/artists/artistWrites.ts';
import { albumTrackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

describe('艺人标签整理', () => {
  it('订阅先于写入，完成事件早于应答时仍能确认结果；显式携带 subsong', async () => {
    const host = installFakeHost();
    const track = albumTrackRow('X', 'A', 'Single', { artists: ['A'], subsong: 2 });
    host.answer('metadata.readRaw', {
      success: true,
      source: 'file',
      path: track.path,
      tags: { ARTIST: 'A' },
      info: { duration: 1, bitrate: 0, sampleRate: 0, channels: 0, codec: '' },
    });
    host.answer('metadata.write', (params) => {
      const path = String(params['path']);
      host.answer('metadata.readRaw', {
        success: true,
        source: 'file',
        path,
        tags: { ARTIST: 'New' },
        info: { duration: 1, bitrate: 0, sampleRate: 0, channels: 0, codec: '' },
      });
      host.emit('metadata:writeComplete', {
        operation: 'write',
        path,
        subsong: 2,
        code: 0,
        success: true,
        status: 'success',
      });
      return { success: true, path, note: '已派发', dispatched: true };
    });
    const store = createStore();
    const service = startArtistWrites(store, host.fb);
    expect(await service.rename(artistWritePlan([track], ['A'], 'credited'), 'New')).toBe(true);
    expect(host.callsTo('metadata.write')[0]).toMatchObject({
      path: `${track.path}|subsong:2`,
      cueIndex: 2,
      tags: { ARTIST: 'New' },
    });
    expect(store.get(service.state)).toMatchObject({ busy: false, failed: false, completed: 1 });
    service.dispose();
  });
  it('单值可改，多值保留；专辑艺术家缺失时只改原来的曲目艺术家', () => {
    const single = albumTrackRow('X', 'A', 'Single', { artists: ['A'], albumArtists: [] });
    const multi = albumTrackRow('X', 'A', 'Multi', { artists: ['A', 'B'], albumArtists: [] });
    const plan = artistWritePlan([single, multi], ['A'], 'albumArtist');
    expect(plan.changes).toEqual([{ track: single, field: 'ARTIST', before: 'A' }]);
    expect(plan.skipped).toEqual([multi]);
  });
  it('确认后标签已经被别处修改时不覆盖，报告失败', async () => {
    const host = installFakeHost();
    const track = albumTrackRow('X', 'A', 'Single', { artists: ['A'] });
    host.answer('metadata.readRaw', {
      success: true,
      source: 'file',
      path: track.path,
      tags: { ARTIST: ['A', 'B'] },
      info: { duration: 0, sampleRate: 0, channels: 0, bitrate: 0, codec: '' },
    });
    const store = createStore();
    const service = startArtistWrites(store, host.fb);
    expect(await service.rename(artistWritePlan([track], ['A'], 'credited'), 'New')).toBe(false);
    expect(host.callsTo('metadata.write')).toEqual([]);
    expect(store.get(service.state)).toMatchObject({ busy: false, failed: true });
    service.dispose();
  });

  it('部分成功后重试只写剩余曲目，已完成的曲目仍检查外部修改', async () => {
    const host = installFakeHost();
    const first = albumTrackRow('X', 'A', 'First', { artists: ['A'] });
    const second = albumTrackRow('X', 'A', 'Second', { artists: ['A'] });
    const tags = new Map([
      [first.path, 'A'],
      [second.path, 'A'],
    ]);
    let failSecond = true;
    host.answer('metadata.readRaw', (params) => {
      const path = String(params['path']);
      return {
        success: true,
        source: 'file',
        path,
        tags: { ARTIST: tags.get(path) ?? '' },
        info: { duration: 1, bitrate: 0, sampleRate: 0, channels: 0, codec: '' },
      };
    });
    host.answer('metadata.write', (params) => {
      const path = String(params['path']);
      if (path === second.path && failSecond) {
        failSecond = false;
        return { success: false, code: 'OPERATION_FAILED', error: '写入失败' };
      }
      tags.set(path, 'New');
      host.emit('metadata:writeComplete', {
        operation: 'write',
        path,
        subsong: 0,
        code: 0,
        success: true,
        status: 'success',
      });
      return { success: true, path, note: '已派发', dispatched: true };
    });
    const store = createStore();
    const service = startArtistWrites(store, host.fb);
    const plan = artistWritePlan([first, second], ['A'], 'credited');
    expect(await service.rename(plan, 'New')).toBe(false);
    expect([tags.get(first.path), tags.get(second.path)]).toEqual(['New', 'A']);
    expect(await service.rename(plan, 'New')).toBe(true);
    expect([tags.get(first.path), tags.get(second.path)]).toEqual(['New', 'New']);
    expect(store.get(service.state)).toMatchObject({ busy: false, failed: false, completed: 2 });
    expect(
      host.callsTo('metadata.write').filter((call) => call['path'] === first.path),
    ).toHaveLength(1);
    tags.set(first.path, 'External');
    expect(await service.rename(plan, 'New')).toBe(false);
    expect(tags.get(first.path)).toBe('External');
    service.dispose();
  });
});
