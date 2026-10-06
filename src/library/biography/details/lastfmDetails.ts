import { lastfmArtistFromUrl, lastfmArtistUrl, type BiographyLanguage } from '../biographyModel.ts';
import { readLastfmPhoto } from '../online/lastfmPhoto.ts';
import {
  biographyField,
  type BiographyCounter,
  type BiographyDetails,
  type BiographyFact,
} from './biographyDetailsModel.ts';

type DetailsContent = Pick<BiographyDetails, 'tags' | 'counters' | 'similar' | 'photo'>;
export type LastfmDetailsResult =
  { readonly kind: 'found'; readonly details: DetailsContent } | { readonly kind: 'invalid' };

const EXCLUDED = 'script,style,iframe,object,noscript,template,[hidden],[aria-hidden="true"]';

function textOf(element: Element | null): string {
  if (!element || element.closest(EXCLUDED)) return '';
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return '';
  copy.querySelectorAll(EXCLUDED).forEach((node) => node.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function linkUrl(link: Element, base: string): URL | null {
  try {
    const value = link.getAttribute('href');
    return value ? new URL(value, base) : null;
  } catch {
    return null;
  }
}

export function readLastfmFacts(root: ParentNode): readonly BiographyFact[] {
  const facts: BiographyFact[] = [];
  for (const item of root.querySelectorAll('.factbox-item')) {
    if (facts.length === 8) break;
    const heading = item.querySelector('h4');
    const label = textOf(heading);
    if (!heading || !biographyField(label, 80)) continue;
    const parts = Array.from(item.children).filter((child) => child !== heading);
    const value = parts.map(textOf).filter(Boolean).join(' · ');
    if (biographyField(value, 512) && !facts.some((fact) => fact.label === label))
      facts.push({ label, value });
  }
  return facts;
}

function counterValue(value: string): number | null {
  const trimmed = value.trim();
  // 只接受完整整数及三位分组，不把 1.2M 这类缩写伪装成精确计数。
  if (!/^(?:\d+|\d{1,3}(?:[,. \u00a0\u202f]\d{3})+)$/.test(trimmed)) return null;
  const number = Number(trimmed.replace(/[,. \u00a0\u202f]/g, ''));
  return Number.isSafeInteger(number) ? number : null;
}

export function readLastfmDetails(
  html: string,
  artist: string,
  language: BiographyLanguage,
): LastfmDetailsResult {
  if (html.length > 2_000_000) return { kind: 'invalid' };
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  const url = lastfmArtistUrl(artist, language);
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const title = root.querySelector('.header-new-title, .header-title');
  if (
    !canonical ||
    lastfmArtistFromUrl(canonical)?.toLowerCase() !== artist.toLowerCase() ||
    textOf(title).toLowerCase() !== artist.toLowerCase()
  )
    return { kind: 'invalid' };
  const tags: string[] = [];
  const similar: BiographyDetails['similar'][number][] = [];
  const counters: BiographyCounter[] = [];
  for (const link of root.querySelectorAll('li.tag a[href]')) {
    const tag = textOf(link);
    const target = linkUrl(link, url);
    if (
      !target ||
      target.origin !== new URL(url).origin ||
      !/^\/(?:[a-z]{2}\/)?tag\/[^/]+\/?$/.test(target.pathname) ||
      !biographyField(tag, 80) ||
      tag.toLowerCase() === artist.toLowerCase() ||
      /^(?:@|user[: _-]|https?:)|[\\/@]/i.test(tag) ||
      tags.some((previous) => previous.toLowerCase() === tag.toLowerCase())
    )
      continue;
    tags.push(tag);
    if (tags.length === 8) break;
  }
  for (const heading of root.querySelectorAll('.header-metadata-tnew-title')) {
    const label = textOf(heading);
    const counter = heading.parentElement?.querySelector('abbr.intabbr.js-abbreviated-counter');
    const value =
      counter && textOf(counter) ? counterValue(counter.getAttribute('title') ?? '') : null;
    if (
      biographyField(label, 80) &&
      value !== null &&
      !counters.some((item) => item.label === label)
    )
      counters.push({ label, value });
    if (counters.length === 2) break;
  }
  for (const link of root.querySelectorAll(
    '.catalogue-overview-similar-artists-full-width-item-name a[href]',
  )) {
    const target = linkUrl(link, url);
    const name = target ? lastfmArtistFromUrl(target.href) : null;
    if (
      !name ||
      textOf(link).toLowerCase() !== name.toLowerCase() ||
      name.toLowerCase() === artist.toLowerCase() ||
      similar.some((item) => item.artist.toLowerCase() === name.toLowerCase())
    )
      continue;
    similar.push({ artist: name, url: lastfmArtistUrl(name, language) });
    if (similar.length === 6) break;
  }
  return {
    kind: 'found',
    details: { tags, counters, similar, photo: readLastfmPhoto(root, artist, language) },
  };
}
