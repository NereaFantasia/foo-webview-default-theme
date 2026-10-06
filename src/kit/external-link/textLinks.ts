import { externalHttpUrl } from './externalLinkGate.ts';

export interface TextLinkRange {
  readonly start: number;
  readonly end: number;
  readonly url: string;
}

export interface TextLinkPart {
  readonly text: string;
  readonly url?: string;
}

/** 只解码路径、查询与片段中的可见非 ASCII 字符；域名、分隔符与控制字符保持编码。 */
export function readableUrl(value: string): string {
  const checked = externalHttpUrl(value);
  if (!checked) return value;
  const { origin } = new URL(checked);
  return (
    origin +
    checked.slice(origin.length).replace(/(?:%[89a-f][0-9a-f])+/gi, (encoded) => {
      try {
        const decoded = decodeURIComponent(encoded);
        return /[\p{C}\p{Z}]/u.test(decoded) ? encoded : decoded;
      } catch {
        return encoded;
      }
    })
  );
}

function bareLinks(text: string): TextLinkPart[] {
  const parts: TextLinkPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'\u3000-\u303f]+/gi)) {
    let value = match[0].replace(/[.,!?;:。，！？；：]+$/u, '');
    while (
      value.endsWith(')') &&
      (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)
    )
      value = value.slice(0, -1);
    const url = externalHttpUrl(value);
    if (!url) continue;
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    parts.push({ text: value, url });
    cursor = match.index + value.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

/** 文字与偏移始终基于原文；显示解码不参与链接定位，也不写回原文。 */
export function textLinks(
  text: string,
  links: readonly TextLinkRange[] = [],
): readonly TextLinkPart[] {
  const parts: TextLinkPart[] = [];
  let cursor = 0;
  for (const link of links) {
    const url = externalHttpUrl(link.url);
    if (
      !url ||
      !Number.isInteger(link.start) ||
      !Number.isInteger(link.end) ||
      link.start < cursor ||
      link.end <= link.start ||
      link.end > text.length
    )
      continue;
    if (link.start > cursor) parts.push(...bareLinks(text.slice(cursor, link.start)));
    parts.push({ text: text.slice(link.start, link.end), url });
    cursor = link.end;
  }
  if (cursor < text.length) parts.push(...bareLinks(text.slice(cursor)));
  return parts;
}
