import { externalHttpUrl } from '../../../kit/external-link/externalLinkGate.ts';
import {
  textLinks,
  type TextLinkPart,
  type TextLinkRange,
} from '../../../kit/external-link/textLinks.ts';

export interface BiographyTextLink extends TextLinkRange {
  readonly paragraph: number;
}
export type BiographyTextPart = TextLinkPart;

/** 原文已清理为文字；把来源中的链接按出现顺序对回文字，界面只渲染文字和已验证的地址。 */
export function matchBiographyLinks(
  paragraphs: readonly string[],
  links: Iterable<{ readonly label: string; readonly url: string }>,
  base: string,
): readonly BiographyTextLink[] {
  const result: BiographyTextLink[] = [];
  let paragraph = 0;
  let cursor = 0;
  let checked = 0;
  for (const link of links) {
    if (++checked > 256) break;
    const url = externalHttpUrl(link.url, base);
    if (!url || !link.label) continue;
    for (let at = paragraph; at < paragraphs.length; at += 1) {
      const start = paragraphs[at]?.indexOf(link.label, at === paragraph ? cursor : 0) ?? -1;
      if (start < 0) continue;
      const end = start + link.label.length;
      result.push({ paragraph: at, start, end, url });
      paragraph = at;
      cursor = end;
      break;
    }
  }
  return result;
}

export function readBiographyLinks(
  value: unknown,
  paragraphs: readonly string[],
): readonly BiographyTextLink[] {
  if (!Array.isArray(value)) return [];
  const result: BiographyTextLink[] = [];
  for (const item of value.slice(0, 256)) {
    if (!item || typeof item !== 'object') continue;
    const paragraph: unknown = Reflect.get(item, 'paragraph');
    const start: unknown = Reflect.get(item, 'start');
    const end: unknown = Reflect.get(item, 'end');
    const raw: unknown = Reflect.get(item, 'url');
    if (
      typeof paragraph !== 'number' ||
      !Number.isInteger(paragraph) ||
      typeof start !== 'number' ||
      !Number.isInteger(start) ||
      typeof end !== 'number' ||
      !Number.isInteger(end) ||
      typeof raw !== 'string'
    )
      continue;
    const url = externalHttpUrl(raw);
    const text = paragraphs[paragraph];
    if (
      !url ||
      text === undefined ||
      start < 0 ||
      end <= start ||
      end > text.length ||
      result.some((link) => link.paragraph === paragraph && link.start < end && start < link.end)
    )
      continue;
    result.push({ paragraph, start, end, url });
  }
  return result.sort((a, b) => a.paragraph - b.paragraph || a.start - b.start);
}

export function biographyTextParts(
  text: string,
  links: readonly BiographyTextLink[],
): readonly BiographyTextPart[] {
  return textLinks(text, links);
}
