import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { biographySearching } from '../../../../src/library/biography/biographySearching.ts';

interface Image {
  photo: unknown;
  loading: boolean;
  problem: unknown;
}

function setup() {
  const store = createStore();
  const enabled = atom(true);
  const active = atom(true);
  const subject = atom<string | null>('Nujabes');
  const identity = atom<{ artist: string | null; status: string }>({
    artist: 'Nujabes',
    status: 'resolved',
  });
  const input = atom<{ sourceId: string | null } | null>({ sourceId: '679712483' });
  const ready = atom(true);
  const source = atom<unknown>(null);
  const image = atom<Image>({ photo: null, loading: false, problem: null });
  const searching = biographySearching({
    enabled,
    active,
    subject,
    identity,
    input,
    ready,
    images: [{ source, state: image }],
  });
  return { store, enabled, active, subject, identity, input, ready, source, image, searching };
}

describe('来源还在拉', () => {
  it('认定做完、正文与图都就位时不算在拉', () => {
    const env = setup();
    expect(env.store.get(env.searching)).toBe(false);
  });

  it('认定还没做完（还没轮到这位、等待或正在认定）算在拉', () => {
    const env = setup();
    env.store.set(env.identity, { artist: 'Other', status: 'resolved' });
    expect(env.store.get(env.searching)).toBe(true);
    for (const status of ['idle', 'resolving']) {
      env.store.set(env.identity, { artist: 'Nujabes', status });
      expect(env.store.get(env.searching)).toBe(true);
    }
  });

  it('身份已定、正文还没取完算在拉', () => {
    const env = setup();
    env.store.set(env.ready, false);
    expect(env.store.get(env.searching)).toBe(true);
    env.store.set(env.input, { sourceId: null });
    expect(env.store.get(env.searching)).toBe(false);
  });

  it('图有来源而还没到，或正在取，算在拉；取到、失败后不算', () => {
    const env = setup();
    env.store.set(env.source, { url: 'x' });
    expect(env.store.get(env.searching)).toBe(true);
    env.store.set(env.image, { photo: { url: 'x' }, loading: false, problem: null });
    expect(env.store.get(env.searching)).toBe(false);
    env.store.set(env.image, { photo: null, loading: false, problem: 'network' });
    expect(env.store.get(env.searching)).toBe(false);
    env.store.set(env.image, { photo: { url: 'x' }, loading: true, problem: null });
    expect(env.store.get(env.searching)).toBe(true);
  });

  it('在线内容关着、简介不在显示、没有身份键时都不算在拉', () => {
    const env = setup();
    env.store.set(env.identity, { artist: 'Nujabes', status: 'resolving' });
    env.store.set(env.enabled, false);
    expect(env.store.get(env.searching)).toBe(false);
    env.store.set(env.enabled, true);
    env.store.set(env.active, false);
    expect(env.store.get(env.searching)).toBe(false);
    env.store.set(env.active, true);
    env.store.set(env.subject, null);
    expect(env.store.get(env.searching)).toBe(false);
  });
});
