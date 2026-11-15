import { atom, createStore } from 'jotai/vanilla';
import { onTestFinished } from 'vitest';
import {
  lastfmInput,
  type BiographyFetchResult,
  type BiographyInput,
  type BiographyLanguage,
} from '../../src/library/biography/biographyModel.ts';
import { startBiography } from '../../src/library/biography/biographyService.ts';
import type { readLastfmBiography } from '../../src/library/biography/lastfmBiography.ts';
import type { fetchLastfmDetails } from '../../src/library/biography/details/fetchLastfmDetails.ts';
import { biographyDocument } from './biographySamples.ts';
import { hostFailure } from './hostAnswers.ts';
import { installFakeHost } from './unitHost.ts';

export const BIOGRAPHY_PROFILE = 'E:\\FB2K\\test-profile';
export const BIOGRAPHY_FILE = `${BIOGRAPHY_PROFILE}\\webview-ui-artists\\lastfm-v1.json`;

export const parseBiographySample: typeof readLastfmBiography = (html, artist, language) =>
  html === 'missing'
    ? { kind: 'missing' }
    : html === 'invalid'
      ? { kind: 'invalid' }
      : { kind: 'found', document: biographyDocument(artist, language, html) };

export function setupBiography(
  cached?: string,
  available = true,
  fetchDetails: typeof fetchLastfmDetails = async () => ({
    ok: false,
    problem: 'invalid',
    retryAt: Date.now() + 300_000,
  }),
  /** 按 Last.fm 艺人名取正文的替身；服务收到的是带来源的身份，这里取其中的名字 */
  fetchText?: (
    artist: string,
    language: BiographyLanguage,
    fallback: boolean,
  ) => Promise<BiographyFetchResult>,
) {
  const host = installFakeHost({ available });
  const files = new Map<string, string>(cached ? [[BIOGRAPHY_FILE, cached]] : []);
  host.answer('misc.getProfilePath', {
    success: true,
    path: BIOGRAPHY_PROFILE,
    value: BIOGRAPHY_PROFILE,
  });
  host.answer('file.read', (params) => {
    const text = files.get(String(params['path']));
    return text === undefined
      ? hostFailure('NOT_FOUND')
      : { success: true, content: text, size: text.length };
  });
  host.answer('file.write', (params) => {
    const path = String(params['path']);
    files.set(path, String(params['content']));
    return {
      success: true,
      path,
      bytesWritten: new TextEncoder().encode(String(params['content'])).length,
    };
  });
  host.answer('http.get', {
    success: true,
    status: 200,
    headers: {},
    body: '正文',
    responseType: 'text',
  });
  const store = createStore();
  const enabled = atom(false);
  const active = atom(true);
  const input = atom<BiographyInput | null>(lastfmInput('Queen', 'Queen', 'zh'));
  const service = startBiography(
    store,
    {
      enabled,
      active,
      input,
      ...(fetchText
        ? {
            fetchText: (subject, language, fallback) => fetchText(subject.id, language, fallback),
          }
        : {}),
    },
    host.fb,
    parseBiographySample,
    fetchDetails,
  );
  onTestFinished(() => service.dispose());
  return {
    host,
    files,
    store,
    enabled,
    active,
    input,
    service,
    state: () => store.get(service.state),
  };
}
