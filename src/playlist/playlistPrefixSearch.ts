/** 打字即跳比的字段，靠前的优先：专辑艺术家、标题、专辑。 */
const FIELDS = ['albumArtist', 'title', 'album'] as const;
/** 扫描时取页只投影这几个字段。 */
export const PREFIX_FIELDS = ['index', ...FIELDS];
export const PREFIX_PAGE_SIZE = 200;

function rankOf(value: unknown, needle: string): number {
  if (typeof value !== 'object' || value === null) return -1;
  const row: Record<string, unknown> = { ...value };
  return FIELDS.findIndex((field) => {
    const text = row[field];
    return typeof text === 'string' && text.toLowerCase().startsWith(needle);
  });
}

/**
 * 从头翻页找打的字是哪一行的前缀，不分大小写；答行号，没有命中或途中过期了答 -1。
 * 专辑艺术家命中就停；标题、专辑的命中先记着，翻完仍没有更靠前的字段命中才用它。
 * `current` 每页前后各问一次，答假就作罢。
 */
export async function findPlaylistPrefix(
  text: string,
  source: {
    total: number;
    current: () => boolean;
    page: (start: number, count: number) => Promise<readonly unknown[]>;
  },
): Promise<number> {
  const needle = text.toLowerCase();
  if (!needle) return -1;
  let bestRank: number = FIELDS.length;
  let bestIndex = -1;
  for (let start = 0; start < source.total; start += PREFIX_PAGE_SIZE) {
    if (!source.current()) return -1;
    const rows = await source.page(start, PREFIX_PAGE_SIZE);
    if (!source.current()) return -1;
    for (let at = 0; at < rows.length; at += 1) {
      const rank = rankOf(rows[at], needle);
      if (rank < 0 || rank >= bestRank) continue;
      bestIndex = start + at;
      bestRank = rank;
      if (rank === 0) return bestIndex;
    }
    if (rows.length < PREFIX_PAGE_SIZE) break;
  }
  // 早页里标题或专辑的命中不能压过后页的专辑艺术家命中。
  return source.current() ? bestIndex : -1;
}
