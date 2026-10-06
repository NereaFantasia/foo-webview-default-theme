import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../../../src/nav/navHistory.ts';
import { dropExiting, showEntry, type PageLayer } from '../../../src/shell/pageLayers.ts';

const A: HistoryEntry = { key: 1 };
const B: HistoryEntry = { key: 2 };
const C: HistoryEntry = { key: 3 };

function start(entry: HistoryEntry): PageLayer[] {
  return [{ entry, place: { id: 'albums' }, exiting: false }];
}

const summary = (layers: readonly PageLayer[]) =>
  layers.map((layer) => `${layer.entry.key}${layer.exiting ? '↓' : ''}`);

describe('showEntry', () => {
  it('目录之间切换复用 DOM 身份，记录与主体照常更换', () => {
    const first: PageLayer[] = [
      { entry: A, place: { id: 'folders', subject: 'alpha' }, exiting: false },
    ];
    const second = showEntry(first, B, { id: 'folders', subject: 'beta' });
    expect(second).toEqual([
      { entry: B, identity: A, place: { id: 'folders', subject: 'beta' }, exiting: false },
    ]);
    const third = showEntry(second, C, { id: 'folders', subject: 'disc' });
    expect(third[0]?.identity).toBe(A);
    const leaving = showEntry(third, B, { id: 'albums' });
    expect(leaving[0]?.exiting).toBe(true);
    expect(leaving[0]?.identity).toBe(A);
    const back = showEntry(leaving, C, { id: 'folders', subject: 'disc' });
    expect(back[0]?.identity).toBe(A);
  });
  it('换一条记录：旧的当前层离场，新层排在后面', () => {
    const layers = showEntry(start(A), B, { id: 'settings' });
    expect(summary(layers)).toEqual(['1↓', '2']);
  });

  it('离场还没播完又换一条，更早离场的那层直接移走', () => {
    const layers = showEntry(showEntry(start(A), B, { id: 'settings' }), C, { id: 'home' });
    expect(summary(layers)).toEqual(['2↓', '3']);
  });

  it('退回正在离场的那一层：接回来当当前层，不重建，也不挪位置', () => {
    const leaving = showEntry(start(A), B, { id: 'settings' });
    const back = showEntry(leaving, A, { id: 'albums' });
    expect(summary(back)).toEqual(['1', '2↓']);
    expect(back[0]?.entry).toBe(A);
  });

  it('还是当前这条，只换地点，离场中的层不动', () => {
    const leaving = showEntry(start(A), B, { id: 'playlist', subject: '0:Rock' });
    const renamed = showEntry(leaving, B, { id: 'playlist', subject: '1:Jazz' });
    expect(summary(renamed)).toEqual(['1↓', '2']);
    expect(renamed[1]?.place).toEqual({ id: 'playlist', subject: '1:Jazz' });
  });
});

describe('dropExiting', () => {
  it('离场播完移走那一层；已经接回来的不动', () => {
    const leaving = showEntry(start(A), B, { id: 'settings' });
    expect(summary(dropExiting(leaving, A))).toEqual(['2']);
    const back = showEntry(leaving, A, { id: 'albums' });
    expect(summary(dropExiting(back, A))).toEqual(['1', '2↓']);
  });
});
