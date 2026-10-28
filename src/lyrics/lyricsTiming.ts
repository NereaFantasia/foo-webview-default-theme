import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core';

const timestamp = (value: number) => Number.isFinite(value) && value >= 0;
const validRange = (value: Pick<LyricWord, 'startTime' | 'endTime'>) =>
  timestamp(value.startTime) && timestamp(value.endTime) && value.endTime >= value.startTime;

/**
 * 为播放器准备独立副本；原始时间参与歌词版本身份，不能因显示修正丢失已保存的校正
 * 无法可靠补出的时间返回 null，由调用方显示文字。零时长和合法重叠不作修改
 */
export function prepareLyricsLines(source: readonly LyricLine[]): LyricLine[] | null {
  const result: LyricLine[] = [];
  for (const [index, original] of source.entries()) {
    const line = structuredClone(original);
    if (!timestamp(line.startTime) || !timestamp(line.endTime)) return null;
    for (const [wordIndex, word] of line.words.entries()) {
      if (!timestamp(word.startTime) || !timestamp(word.endTime)) return null;
      if (word.ruby?.some((ruby) => !validRange(ruby))) return null;
      if (validRange(word)) continue;
      const next = source[index + 1];
      const nextStart = next?.words[0]?.startTime;
      // 缺少末词结束标记时，LRC 解析器会借用下一行行首；逐字起点可能晚于这个行首
      if (
        wordIndex !== line.words.length - 1 ||
        word.endTime !== line.endTime ||
        next?.startTime !== line.endTime ||
        next.isBG !== line.isBG ||
        next.isDuet !== line.isDuet ||
        nextStart === undefined ||
        !timestamp(nextStart) ||
        nextStart <= word.startTime
      )
        return null;
      word.endTime = nextStart;
      line.endTime = nextStart;
    }
    const first = line.words[0];
    const last = line.words.at(-1);
    // AMLL 的时间优化会用首词和末词重建行边界；不能把重建后倒序的行交给它
    if (first && last && last.endTime < first.startTime) return null;
    if (!validRange(line)) {
      if (!first || !last) return null;
      line.startTime = first.startTime;
      line.endTime = last.endTime;
    }
    result.push(line);
  }
  return result;
}
