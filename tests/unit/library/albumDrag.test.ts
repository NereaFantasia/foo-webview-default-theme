import { describe, expect, it, vi } from 'vitest';
import { startDragOut, type DragData } from '../../../src/host/dragOut.ts';
import {
  ALBUM_DRAG_TYPE,
  DRAG_OUT_ALBUM_LIMIT,
  DRAG_OUT_TRACK_LIMIT,
  readAlbumDrag,
  startAlbumDrag,
} from '../../../src/library/albumDrag.ts';
import { albumKeyOf } from '../../../src/host/libraryContract.ts';
import { albumTracksAnswer } from '../../fixtures/albumLibrary.ts';
import { hostFailure, listParam, stringParam } from '../../fixtures/hostAnswers.ts';
import { albumRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const A = albumRow('A', 'X');
const B = albumRow('B', 'X');

/** 浏览器的 DataTransfer 在 Node 里没有；按类型记下写进去的数据。 */
function dataTransfer() {
  const data = new Map<string, string>();
  const transfer: DragData & { readonly data: Map<string, string> } = {
    data,
    effectAllowed: 'uninitialized',
    setData: (type, value) => void data.set(type, value),
  };
  return transfer;
}

/** 一台支持拖出的宿主替身：凭证按路径条数编号，每张专辑两首。 */
function dragHost(dragOut = true): UnitHost {
  const host = installFakeHost();
  host.answer('dnd.getCapabilities', {
    success: true,
    html5: true,
    paths: true,
    hosting: 'visual',
    dragOut,
  });
  host.answer('dnd.prepareDrag', (params) => ({
    success: true,
    token: `t${listParam(params, 'paths').length}`,
  }));
  host.answer('library.getAlbumTracks', albumTracksAnswer);
  return host;
}

function setup(host: UnitHost) {
  const dragOut = startDragOut(host.fb);
  return { dragOut, drag: startAlbumDrag(dragOut, host.fb) };
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** `count` 张各一首的专辑。 */
const singles = (count: number) =>
  Array.from({ length: count }, (_, at) => albumRow(`S${at}`, 'X', { trackCount: 1 }));

describe('startAlbumDrag', () => {
  it('没有凭证时只写页面里的载荷：专辑键，只许复制', () => {
    const { drag } = setup(dragHost());
    const transfer = dataTransfer();
    expect(drag.start(transfer, [A, B])).toBe(false);
    expect(transfer.effectAllowed).toBe('copy');
    expect(readAlbumDrag({ getData: (type) => transfer.data.get(type) ?? '' })).toEqual([
      albumKeyOf(A),
      albumKeyOf(B),
    ]);
  });

  it('按下时几张一起取曲目、按阅读顺序换好凭证，拖起时交给宿主；凭证只用一次', async () => {
    const host = dragHost();
    const held = host.hold('library.getAlbumTracks');
    const { drag } = setup(host);
    drag.prepare([A, B]);
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(1);
    held.release();
    await settled();
    expect(host.callsTo('dnd.prepareDrag')).toEqual([
      {
        paths: [
          'file://E:\\Music\\A\\A 1.flac',
          'file://E:\\Music\\A\\A 2.flac',
          'file://E:\\Music\\B\\B 1.flac',
          'file://E:\\Music\\B\\B 2.flac',
        ],
      },
    ]);
    const first = dataTransfer();
    expect(drag.start(first, [A, B])).toBe(true);
    expect(first.data.get('text/plain')).toContain('t4');
    expect(first.data.has(ALBUM_DRAG_TYPE)).toBe(true);
    expect(drag.start(dataTransfer(), [A, B])).toBe(false);
  });

  it('凭证换的是别的一批，不交给宿主', async () => {
    const { drag } = setup(dragHost());
    drag.prepare([A]);
    await settled();
    expect(drag.start(dataTransfer(), [B])).toBe(false);
  });

  it('再按下一次，上一次还没到手的作废：旧的应答最后到也不算', async () => {
    const host = dragHost();
    const held = host.hold('library.getAlbumTracks');
    const { drag } = setup(host);
    drag.prepare([A]);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    drag.prepare([B]);
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(1);
    await settled();
    held.respond(0);
    await settled();
    expect(host.callsTo('dnd.prepareDrag')).toEqual([
      { paths: ['file://E:\\Music\\B\\B 1.flac', 'file://E:\\Music\\B\\B 2.flac'] },
    ]);
    expect(drag.start(dataTransfer(), [A])).toBe(false);
    expect(drag.start(dataTransfer(), [B])).toBe(true);
  });

  it('按下之后单击了（cancel）：这一次不再换凭证', async () => {
    const host = dragHost();
    const held = host.hold('library.getAlbumTracks');
    const { drag } = setup(host);
    drag.prepare([A]);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    drag.cancel();
    held.release();
    await settled();
    expect(host.callsTo('dnd.prepareDrag')).toEqual([]);
    expect(drag.start(dataTransfer(), [A])).toBe(false);
  });

  it('别的拖出源随后被按下：专辑这一发作废', async () => {
    const host = dragHost();
    const held = host.hold('library.getAlbumTracks');
    const { dragOut, drag } = setup(host);
    drag.prepare([A]);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    dragOut.claim();
    held.release();
    await settled();
    expect(host.callsTo('dnd.prepareDrag')).toEqual([]);
  });

  it('几张里只有一张取曲目失败：不换凭证，起拖时不带文件', async () => {
    const host = dragHost();
    host.answer('library.getAlbumTracks', (params) =>
      stringParam(params, 'album') === 'B'
        ? hostFailure('OPERATION_FAILED')
        : albumTracksAnswer(params),
    );
    const { drag } = setup(host);
    drag.prepare([A, B]);
    await settled();
    expect(host.callsTo('library.getAlbumTracks')).toHaveLength(2);
    expect(host.callsTo('dnd.prepareDrag')).toEqual([]);
    expect(drag.start(dataTransfer(), [A, B])).toBe(false);
  });

  it('宿主不支持拖出：不取曲目，能力只问一次', async () => {
    const host = dragHost(false);
    const { drag } = setup(host);
    drag.prepare([A]);
    await settled();
    drag.prepare([B]);
    await settled();
    expect(host.callsTo('dnd.getCapabilities')).toHaveLength(1);
    expect(host.callsTo('library.getAlbumTracks')).toEqual([]);
  });

  it('几张合起来超过拖出的首数上限：只做页面内拖放，不去取曲目', async () => {
    const host = dragHost();
    const { drag } = setup(host);
    const half = Math.ceil(DRAG_OUT_TRACK_LIMIT / 2) + 1;
    drag.prepare([
      albumRow('M', 'X', { trackCount: half }),
      albumRow('N', 'X', { trackCount: half }),
    ]);
    await settled();
    expect(host.callsTo('library.getAlbumTracks')).toEqual([]);
  });

  it('张数超过拖出的上限：首数再少也不去取曲目', async () => {
    const host = dragHost();
    const { drag } = setup(host);
    drag.prepare(singles(DRAG_OUT_ALBUM_LIMIT + 1));
    await settled();
    expect(host.callsTo('library.getAlbumTracks')).toEqual([]);
  });

  it('张数恰好在拖出的上限上：照取曲目、换凭证，拖起时交给宿主', async () => {
    const host = dragHost();
    const { drag } = setup(host);
    const albums = singles(DRAG_OUT_ALBUM_LIMIT);
    drag.prepare(albums);
    await settled();
    expect(host.callsTo('library.getAlbumTracks')).toHaveLength(DRAG_OUT_ALBUM_LIMIT);
    expect(drag.start(dataTransfer(), albums)).toBe(true);
  });

  it('单张专辑不论多少首都去换凭证，拖起时交给宿主', async () => {
    const host = dragHost();
    const { drag } = setup(host);
    const box = [albumRow('Box', 'X', { trackCount: DRAG_OUT_TRACK_LIMIT * 4 })];
    drag.prepare(box);
    await settled();
    expect(drag.start(dataTransfer(), box)).toBe(true);
  });
});

describe('readAlbumDrag', () => {
  it('不是专辑拖放或内容坏了答 null', () => {
    expect(readAlbumDrag({ getData: () => '' })).toBeNull();
    expect(readAlbumDrag({ getData: () => '{"a":1}' })).toBeNull();
    expect(readAlbumDrag({ getData: () => '[]' })).toBeNull();
    expect(readAlbumDrag({ getData: () => '["k", 3]' })).toEqual(['k']);
  });
});
