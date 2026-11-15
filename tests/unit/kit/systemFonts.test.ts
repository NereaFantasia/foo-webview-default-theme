import { describe, expect, it, vi } from 'vitest';
import { createSystemFonts, fontInstalled } from '../../../src/kit/systemFonts.ts';

describe('本机字体列表', () => {
  it('按家族去重排序，空名与不合格的条目丢掉；成功的结果复用', async () => {
    const query = vi.fn(() =>
      Promise.resolve([
        { family: 'B' },
        { family: 'A' },
        { family: 'A' },
        { family: ' ' },
        { x: 1 },
      ]),
    );
    const load = createSystemFonts(() => query);
    expect(await load()).toEqual(['A', 'B']);
    expect(await load()).toEqual(['A', 'B']);
    expect(query).toHaveBeenCalledOnce();
  });

  it('同时发起的几次共用一次请求', async () => {
    const query = vi.fn(() => Promise.resolve([{ family: 'A' }]));
    const load = createSystemFonts(() => query);
    expect(await Promise.all([load(), load(), load()])).toEqual([['A'], ['A'], ['A']]);
    expect(query).toHaveBeenCalledOnce();
  });

  it('没有接口、被拒绝或列表为空都答 null，失败的不记住，下次再问', async () => {
    expect(await createSystemFonts(() => undefined)()).toBeNull();
    const query = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ family: 'A' }]);
    const load = createSystemFonts(() => query);
    expect(await load()).toBeNull();
    expect(await load()).toBeNull();
    expect(await load()).toEqual(['A']);
    expect(query).toHaveBeenCalledTimes(3);
  });
});

describe('字体是否已安装', () => {
  const measure = (family: string) =>
    family.includes('Real') ? 100 : family.endsWith('serif') ? 80 : 90;

  it('名字匹配上时两种后备下宽度相同，没匹配上就不同；拿不到画布时当作有', () => {
    expect(fontInstalled('Real Font', measure)).toBe(true);
    expect(fontInstalled('Missing Font', measure)).toBe(false);
    expect(fontInstalled('Missing Font', null)).toBe(true);
  });

  it('名字里的引号转义后再量', () => {
    const seen: string[] = [];
    fontInstalled('A"B', (family) => {
      seen.push(family);
      return 1;
    });
    expect(seen).toEqual(['"A\\"B", serif', '"A\\"B", monospace']);
  });
});
