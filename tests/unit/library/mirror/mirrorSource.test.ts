import type { LibraryTrack } from 'foo-webview-sdk';
import { describe, expect, it } from 'vitest';
import { createMirrorSource, mirrorColumnOf } from '../../../../src/library/mirror/mirrorSource.ts';
import { MIRROR_PAGE_LIMIT } from '../../../../src/server/libraryMirrorProtocol.ts';
import { trackSortPattern } from '../../../../src/track/trackSort.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';
import { setupMirror } from '../../../fixtures/mirrorEnv.ts';

const row = (title: string, extra: Partial<LibraryTrack> = {}) =>
  trackRow('Album', title, { artists: ['Artist'], ...extra });

const THREE = () => [row('Gamma'), row('Alpha'), row('Beta')];

async function built(tracks: LibraryTrack[]) {
  const env = await setupMirror(tracks);
  await env.service.sync();
  const source = createMirrorSource({ client: env.client, sync: env.service, host: env.host.fb });
  return { ...env, source };
}

describe('镜像读取源：命中检查', () => {
  it('镜像还没建好时什么都不读，答 null 让调用方走宿主', async () => {
    const env = await setupMirror(THREE());
    const source = createMirrorSource({
      client: env.client,
      sync: { sync: () => Promise.resolve() },
      host: env.host.fb,
    });
    expect(await source.tracks()).toBeNull();
    expect(await source.order(trackSortPattern('title'), false)).toBeNull();
    expect(await source.albums()).toBeNull();
  });

  it('后端没连着（请求失败）时答 null，不抛', async () => {
    const env = await built(THREE());
    const source = createMirrorSource({
      client: { ...env.client, status: () => Promise.reject(new Error('没连上')) },
      sync: env.service,
      host: env.host.fb,
    });
    expect(await source.tracks()).toBeNull();
  });

  it('宿主又有改动、镜像落后时，先催同步追平再读，读到的是新的', async () => {
    const env = await built(THREE());
    env.library.edit([row('Delta')]);
    const tracks = await env.source.tracks();
    expect(tracks?.map((track) => track.title).sort()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
  });

  it('落后而同步追不上（本窗口不是同步者）时答 null', async () => {
    const env = await built(THREE());
    const source = createMirrorSource({
      client: env.client,
      sync: { sync: () => Promise.resolve() },
      host: env.host.fb,
    });
    env.library.edit([row('Delta')]);
    expect(await source.tracks()).toBeNull();
  });

  it('读到一半镜像被同步改动，这一次的结果作废', async () => {
    const many = Array.from({ length: MIRROR_PAGE_LIMIT + 500 }, (_, i) => row(`T${String(i)}`));
    const env = await built(many);
    let pages = 0;
    const client = {
      ...env.client,
      page: async (request: Parameters<typeof env.client.page>[0]) => {
        const page = await env.client.page(request);
        if (++pages === 1) {
          const status = await env.client.status();
          await env.client.apply({
            epoch: status.epoch,
            since: status.revision,
            revision: status.revision + 1,
            upsert: [],
            remove: [],
          });
        }
        return page;
      },
    };
    const source = createMirrorSource({ client, sync: env.service, host: env.host.fb });
    expect(await source.tracks()).toBeNull();
    expect(pages).toBe(2);
  });

  it('调用方说这一次已过期，就停在下一页之前并答 null', async () => {
    const many = Array.from({ length: MIRROR_PAGE_LIMIT + 500 }, (_, i) => row(`T${String(i)}`));
    const env = await built(many);
    expect(await env.source.tracks(() => true)).toBeNull();
  });
});

describe('镜像读取源：读取', () => {
  it('整库曲目逐键同宿主的行，数组是各自独立的', async () => {
    const env = await built(THREE());
    const tracks = await env.source.tracks();
    expect(tracks).toHaveLength(3);
    const alpha = tracks?.find((track) => track.title === 'Alpha');
    expect(alpha).toMatchObject({
      handle: row('Alpha').handle,
      path: row('Alpha').path,
      album: 'Album',
      artists: ['Artist'],
    });
    alpha?.artists.push('改动');
    expect((await env.source.tracks())?.find((t) => t.title === 'Alpha')?.artists).toEqual([
      'Artist',
    ]);
  });

  it('整库曲目按库序给出，不随读取用的排序列', async () => {
    const env = await built(THREE());
    expect((await env.source.tracks())?.map((track) => track.title)).toEqual([
      'Gamma',
      'Alpha',
      'Beta',
    ]);
  });

  it('次序按排序串对应的列升序给出；镜像排不了的串（含库序的空串）答 null', async () => {
    const env = await built(THREE());
    const ordered = await env.source.order(trackSortPattern('title'), false);
    expect(ordered?.handles).toEqual(['Alpha', 'Beta', 'Gamma'].map((t) => row(t).handle));
    expect(ordered?.paths).toEqual([]);
    expect(await env.source.order('', false)).toBeNull();
    expect(await env.source.order(trackSortPattern('added'), false)).toBeNull();
  });

  it('要路径时路径与 subsong 跟着句柄的次序', async () => {
    const second = row('B', { subsong: 2 });
    const env = await built([second, row('A', { subsong: 0 })]);
    const ordered = await env.source.order(trackSortPattern('title'), true);
    expect(ordered).toEqual({
      handles: [row('A').handle, second.handle],
      paths: [row('A').path, second.path],
      subsongs: [0, 2],
    });
  });

  it('专辑清单形状同宿主的专辑行，label 为空串', async () => {
    const env = await built([row('A1'), row('A2')]);
    const albums = await env.source.albums();
    expect(albums).toHaveLength(1);
    expect(albums?.[0]).toMatchObject({ name: 'Album', trackCount: 2, label: '' });
  });
});

describe('镜像读取源：排序串对照', () => {
  it('镜像能排的列都认得出自己的排序串，统计列不认', () => {
    expect(mirrorColumnOf(trackSortPattern('title'))).toBe('title');
    expect(mirrorColumnOf(trackSortPattern('path'))).toBe('path');
    expect(mirrorColumnOf(trackSortPattern('playCount'))).toBeUndefined();
    expect(mirrorColumnOf('')).toBeUndefined();
  });
});
