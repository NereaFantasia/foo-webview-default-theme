import { describe, expect, it } from 'vitest';
import {
  BACKDROP_CHOICES,
  BACKDROP_RENDERER_IDS,
  resolveBackdrop,
  type BackdropRendererId,
} from '../../../../src/immersive/backdrop/backdropChoice.ts';

const all = () => true;
const only =
  (...ids: BackdropRendererId[]) =>
  (id: BackdropRendererId) =>
    ids.includes(id);

describe('resolveBackdrop', () => {
  it('选了的能用就用它', () => {
    for (const id of BACKDROP_RENDERER_IDS) expect(resolveBackdrop(id, all)).toBe(id);
  });

  it('选了的用不了，按登记顺序试另外几个', () => {
    expect(resolveBackdrop('isolation', only('mesh', 'titanium'))).toBe('titanium');
    expect(resolveBackdrop('mesh', only('isolation', 'titanium'))).toBe('titanium');
    expect(resolveBackdrop('titanium', only('isolation'))).toBe('isolation');
  });

  it('off 不画，一个都用不了也不画', () => {
    expect(resolveBackdrop('off', all)).toBeNull();
    expect(resolveBackdrop('titanium', only())).toBeNull();
  });

  it('取值表里是四个渲染器加 off', () => {
    expect([...BACKDROP_CHOICES]).toEqual(['titanium', 'mesh', 'isolation', 'flow', 'off']);
  });

  it('流动色场排在最后：别的都用不了才轮到它，选了它用不了就退到前面的', () => {
    expect(resolveBackdrop('mesh', only('flow'))).toBe('flow');
    expect(resolveBackdrop('flow', only('mesh', 'titanium'))).toBe('titanium');
    expect(resolveBackdrop('flow', all)).toBe('flow');
  });
});
