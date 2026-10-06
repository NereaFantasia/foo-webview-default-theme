import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDragOut, type DragData } from '../../../src/host/dragOut.ts';
import { hostFailure, listParam } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const CAPABILITIES = {
  success: true,
  html5: true,
  paths: true,
  hosting: 'visual',
  dragOut: true,
} as const;

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

function dragHost(): UnitHost {
  const host = installFakeHost();
  host.answer('dnd.getCapabilities', CAPABILITIES);
  host.answer('dnd.prepareDrag', (params) => ({
    success: true,
    token: `t-${listParam(params, 'paths').join('+')}`,
  }));
  return host;
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('startDragOut', () => {
  it('换到凭证后，同一个名下起拖时交给宿主，只用一次；别的名下不给', async () => {
    const dragOut = startDragOut(dragHost().fb);
    await dragOut.claim().mint('a', ['p1']);
    expect(dragOut.apply(dataTransfer(), 'b')).toBe(false);
    const first = dataTransfer();
    expect(dragOut.apply(first, 'a')).toBe(true);
    expect(first.data.get('text/plain')).toContain('t-p1');
    expect(first.effectAllowed).toBe('copy');
    expect(dragOut.apply(dataTransfer(), 'a')).toBe(false);
  });

  it('各拖出源共用代次：后按下的作废先按下的，先发的应答晚到也顶不掉后来的', async () => {
    const host = dragHost();
    const dragOut = startDragOut(host.fb);
    const held = host.hold('dnd.prepareDrag');
    const albums = dragOut.claim();
    const albumMint = albums.mint('albums', ['a']);
    const tracks = dragOut.claim();
    expect(albums.current()).toBe(false);
    const trackMint = tracks.mint('tracks', ['t']);
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(1);
    await trackMint;
    held.respond(0);
    await albumMint;
    expect(dragOut.apply(dataTransfer(), 'albums')).toBe(false);
    expect(dragOut.apply(dataTransfer(), 'tracks')).toBe(true);
  });

  it('票据作废之后不再发 prepareDrag', async () => {
    const host = dragHost();
    const dragOut = startDragOut(host.fb);
    const stale = dragOut.claim();
    dragOut.claim();
    await stale.mint('a', ['p1']);
    expect(host.callsTo('dnd.prepareDrag')).toEqual([]);
  });

  it('cancel 丢掉到手的凭证', async () => {
    const dragOut = startDragOut(dragHost().fb);
    await dragOut.claim().mint('a', ['p1']);
    dragOut.cancel();
    expect(dragOut.apply(dataTransfer(), 'a')).toBe(false);
  });

  it('凭证快到期了不交给宿主，按单调时钟计', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const dragOut = startDragOut(dragHost().fb);
    await dragOut.claim().mint('a', ['p1']);
    vi.advanceTimersByTime(26_000);
    expect(dragOut.apply(dataTransfer(), 'a')).toBe(false);
  });

  it('能力只缓存成功的应答：问失败了下次再问', async () => {
    const host = dragHost();
    host.answer('dnd.getCapabilities', () => {
      throw new Error('timeout');
    });
    const dragOut = startDragOut(host.fb);
    expect(await dragOut.claim().supported()).toBe(false);
    host.answer('dnd.getCapabilities', CAPABILITIES);
    expect(await dragOut.claim().supported()).toBe(true);
    expect(await dragOut.claim().supported()).toBe(true);
    expect(host.callsTo('dnd.getCapabilities')).toHaveLength(2);
  });

  it('宿主经 dnd:capabilitiesChanged 改了能力，就按新的答', async () => {
    const host = dragHost();
    const dragOut = startDragOut(host.fb);
    expect(await dragOut.claim().supported()).toBe(true);
    await host.emit('dnd:capabilitiesChanged', { ...CAPABILITIES, dragOut: false });
    expect(await dragOut.claim().supported()).toBe(false);
    expect(host.callsTo('dnd.getCapabilities')).toHaveLength(1);
  });

  it('问能力的应答在路上时宿主推了变更：晚到的旧应答不盖掉事件', async () => {
    const host = dragHost();
    const held = host.hold('dnd.getCapabilities');
    const dragOut = startDragOut(host.fb);
    await vi.waitFor(() => expect(host.listenerCount('dnd:capabilitiesChanged')).toBe(1));
    const asking = dragOut.claim().supported();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    host.emit('dnd:capabilitiesChanged', { ...CAPABILITIES, dragOut: false });
    held.respond(0, CAPABILITIES);
    expect(await asking).toBe(false);
    expect(await dragOut.claim().supported()).toBe(false);
  });

  it.each(['ORIGIN_DENIED', 'NOT_SUPPORTED', 'NOT_FOUND'])(
    'prepareDrag 答 %s：记成不支持，不再换凭证',
    async (code) => {
      const host = dragHost();
      host.answer('dnd.prepareDrag', hostFailure(code));
      const dragOut = startDragOut(host.fb);
      const ticket = dragOut.claim();
      expect(await ticket.supported()).toBe(true);
      await ticket.mint('a', ['p1']);
      expect(await dragOut.claim().supported()).toBe(false);
    },
  );

  it('prepareDrag 的其他失败只算这一次没换到', async () => {
    const host = dragHost();
    host.answer('dnd.prepareDrag', hostFailure('INVALID_PATH'));
    const dragOut = startDragOut(host.fb);
    await dragOut.claim().mint('a', ['http://x']);
    expect(await dragOut.claim().supported()).toBe(true);
    expect(dragOut.apply(dataTransfer(), 'a')).toBe(false);
  });

  it('释放之后摘掉能力变更的订阅，也不再交凭证', async () => {
    const host = dragHost();
    const dragOut = startDragOut(host.fb);
    await dragOut.claim().mint('a', ['p1']);
    await settled();
    expect(host.listenerCount('dnd:capabilitiesChanged')).toBe(1);
    dragOut.dispose();
    expect(host.listenerCount('dnd:capabilitiesChanged')).toBe(0);
    expect(dragOut.apply(dataTransfer(), 'a')).toBe(false);
  });
});
