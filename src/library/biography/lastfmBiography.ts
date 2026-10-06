import {
  BIOGRAPHY_TEXT_LIMIT,
  biographyLicense,
  lastfmArtistFromUrl,
  lastfmBiographyUrl,
  type BiographyDocument,
  type BiographyLanguage,
} from './biographyModel.ts';
import { readLastfmFacts } from './details/lastfmDetails.ts';
import { readLastfmPhoto } from './online/lastfmPhoto.ts';
import { matchBiographyLinks } from './article/biographyLinks.ts';

export type LastfmBiographyResult =
  | { readonly kind: 'found'; readonly document: BiographyDocument }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' };

const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H2', 'H3', 'H4']);
const EXCLUDED = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'NOSCRIPT', 'TEMPLATE']);

function plainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (!(node instanceof Element) || EXCLUDED.has(node.tagName)) return '';
  if (node.tagName === 'BR') return '\n';
  if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return '';
  const text = Array.from(node.childNodes, plainText).join('');
  return BLOCKS.has(node.tagName) ? `\n\n${text}\n\n` : text;
}

export function readLastfmBiography(
  html: string,
  artist: string,
  language: BiographyLanguage,
): LastfmBiographyResult {
  if (html.length > 2_000_000) return { kind: 'invalid' };
  // template 内的网页保持惰性，解析时不执行脚本，也不请求网页里的图片或嵌入资源。
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const sourceArtist = canonical ? lastfmArtistFromUrl(canonical) : null;
  if (!sourceArtist || sourceArtist.toLowerCase() !== artist.toLowerCase())
    return { kind: 'invalid' };
  const wiki = root.querySelector('.wiki-content');
  if (!wiki)
    return root.querySelector('.no-data-message--wiki') ? { kind: 'missing' } : { kind: 'invalid' };
  const paragraphs = plainText(wiki)
    .split(/\n{2,}/)
    .map((text) =>
      text
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
  if (!paragraphs.length || paragraphs.join('\n').length > BIOGRAPHY_TEXT_LIMIT)
    return { kind: 'invalid' };
  const license = Array.from(root.querySelectorAll('.wiki-legal a[href]'))
    .map((link) => biographyLicense(link.getAttribute('href') ?? ''))
    .find((item) => item !== null);
  if (!license) return { kind: 'invalid' };
  return {
    kind: 'found',
    document: {
      artist,
      language,
      paragraphs,
      links: matchBiographyLinks(
        paragraphs,
        Array.from(wiki.querySelectorAll('a[href]'), (link) => ({
          label: plainText(link).trim(),
          url: link.getAttribute('href') ?? '',
        })),
        lastfmBiographyUrl(artist, language),
      ),
      url: lastfmBiographyUrl(artist, language),
      licenseUrl: license.url,
      license: license.name,
      facts: readLastfmFacts(root),
      photo: readLastfmPhoto(root, artist, language),
    },
  };
}
