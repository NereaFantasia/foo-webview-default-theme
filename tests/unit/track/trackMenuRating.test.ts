import { describe, expect, it, vi } from 'vitest';
import { menuRatingOf, rateMenuTracks } from '../../../src/track/trackMenuRating.ts';
import { trackRatingEntries } from '../../../src/track/trackMenuEntries.ts';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';

const t = createTranslate(zhCN, {});
const a = trackRow('A', 'One', { rating: 2 });
const b = trackRow('A', 'Two', { rating: 4 });

describe('菜单评分', () => {
  it('读取各行自己的评分戳，只有全部同分才勾选', () => {
    const ratingOf = vi.fn((track: typeof a) => track.rating);
    expect(menuRatingOf({ ratingOf }, [a, b], [12, 15])).toBe('mixed');
    expect(ratingOf.mock.calls).toEqual([
      [a, 12],
      [b, 15],
    ]);
    expect(menuRatingOf({ ratingOf }, [a, a], 10)).toBe(2);
    expect(menuRatingOf({ ratingOf }, [], 10)).toBeNull();
    const entry = trackRatingEntries(t, 'mixed', vi.fn(), false);
    expect(entry.items[0]).toMatchObject({ kind: 'status', label: '评分不同' });
    expect(entry.items.some((item) => item.kind === 'command' && item.checked)).toBe(false);
    expect(entry.items.at(-1)).toMatchObject({ id: 'rating:0', disabled: false });
  });

  it('混合、未知和未评分分别显示；点当前分数不写入、不清零', () => {
    const rate = vi.fn();
    expect(trackRatingEntries(t, null, rate, false).items[0]).toMatchObject({
      label: '当前评分未知',
    });
    expect(trackRatingEntries(t, 0, rate, false).items[0]).toMatchObject({ label: '未评分' });
    const entry = trackRatingEntries(t, 2, rate, false).items.find(
      (item) => item.id === 'rating:2',
    );
    if (entry?.kind !== 'command') throw new Error('缺少评分命令');
    entry.onSelect();
    expect(rate).not.toHaveBeenCalled();
  });

  it('已展开的评分子菜单在重新加载时也禁用每个写入按钮', () => {
    const entry = trackRatingEntries(t, null, vi.fn(), true);
    const commands = entry.items.filter((item) => item.kind === 'command');
    expect(commands).toHaveLength(6);
    expect(commands.every((item) => item.disabled)).toBe(true);
  });

  it('重复曲目只写一次，分轨分别写，失败后不继续覆盖提示', async () => {
    const second = { ...a, handle: 'subsong-2', subsong: 2 };
    const setRating = vi.fn(async () => true);
    expect(await rateMenuTracks({ setRating }, [a, a, second], 5)).toBe(true);
    expect(setRating.mock.calls).toEqual([
      [a, 5],
      [second, 5],
    ]);
    setRating.mockClear();
    setRating.mockResolvedValueOnce(false);
    expect(await rateMenuTracks({ setRating }, [a, b], 3)).toBe(false);
    expect(setRating).toHaveBeenCalledTimes(1);
  });
});
