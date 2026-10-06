import type { PlaylistTrack } from 'foo-webview-sdk';

// 替身里用的一小段 Title Formatting：只认排序串与分组串里出现的写法，`%字段%`、`'字面量'`、
// `$if`、`$if2` 与 `$directory_path`。宿主那边字段缺了写「?」，这里写空串：测试里的组键与排序
// 只比有值的字段，写空串更好断言。

const FIELDS: Readonly<Record<string, (track: PlaylistTrack) => string>> = {
  album: (track) => track.album,
  // 宿主的 `%album artist%` 缺了退回艺术家。
  'album artist': (track) => track.albumArtist || track.artist,
  artist: (track) => track.artist,
  title: (track) => track.title,
  genre: (track) => track.genre,
  date: (track) => track.date,
  discnumber: (track) => (track.discNumber > 0 ? String(track.discNumber) : ''),
  tracknumber: (track) => (track.trackNumber > 0 ? String(track.trackNumber).padStart(2, '0') : ''),
  path: (track) => track.path,
  rating: (track) => (track.rating > 0 ? String(track.rating) : ''),
  codec: (track) => track.codec,
  bitrate: (track) => (track.bitrate > 0 ? String(track.bitrate) : ''),
  length: (track) => lengthOf(track.duration),
};

function lengthOf(seconds: number): string {
  if (!(seconds > 0)) return '';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const FUNCTIONS: Readonly<Record<string, (args: readonly string[]) => string>> = {
  if: ([test = '', then = '', otherwise = '']) => (test !== '' ? then : otherwise),
  if2: ([first = '', second = '']) => (first !== '' ? first : second),
  directory_path: ([path = '']) => path.replace(/[\\/][^\\/]*$/, ''),
};

/** 从 `open` 处的左括号起，找与它配对的右括号，并按顶层逗号切出参数原文。 */
function argumentsAt(text: string, open: number): { args: string[]; close: number } {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  let quoted = false;
  for (let at = open + 1; at < text.length; at += 1) {
    const char = text[at];
    if (char === "'") quoted = !quoted;
    if (quoted) continue;
    if (char === '(') depth += 1;
    else if (char === ')' && depth > 0) depth -= 1;
    else if (char === ')' || (char === ',' && depth === 0)) {
      args.push(text.slice(start, at));
      start = at + 1;
      if (char === ')') return { args, close: at };
    }
  }
  throw new Error(`Title Formatting 括号不配对：${text}`);
}

/** 按一首曲目求一个 Title Formatting 串的值。认不得的字段或函数直接抛错，替身不静默出错。 */
export function formatTitle(pattern: string, track: PlaylistTrack): string {
  let out = '';
  let at = 0;
  while (at < pattern.length) {
    const char = pattern[at] ?? '';
    if (char === '%' || char === "'") {
      const end = pattern.indexOf(char, at + 1);
      if (end < 0) throw new Error(`Title Formatting 缺收尾的 ${char}：${pattern}`);
      const body = pattern.slice(at + 1, end);
      if (char === "'") out += body;
      else {
        const field = FIELDS[body];
        if (!field) throw new Error(`替身不认字段 %${body}%`);
        out += field(track);
      }
      at = end + 1;
    } else if (char === '$') {
      const open = pattern.indexOf('(', at);
      const name = pattern.slice(at + 1, open);
      const call = FUNCTIONS[name];
      if (open < 0 || !call) throw new Error(`替身不认函数 $${name}`);
      const { args, close } = argumentsAt(pattern, open);
      out += call(args.map((arg) => formatTitle(arg, track)));
      at = close + 1;
    } else {
      out += char;
      at += 1;
    }
  }
  return out;
}
