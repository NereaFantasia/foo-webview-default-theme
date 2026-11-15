import { BIOGRAPHY_SOURCE_KEY } from '../../src/library/biography/biographySourcePrefs.ts';
import type { ConfigValue } from './hostAnswers.ts';

/**
 * 简介来源的缺省是 Apple Music。测 Last.fm 一路的用例要在开页前把来源显式选成 Last.fm，
 * 放进宿主替身的初始配置（`installPageHost` 与 `openPlayer` 的 `config`），不依赖缺省值
 */
export const LASTFM_SOURCE_CONFIG: Readonly<Record<string, ConfigValue>> = {
  [BIOGRAPHY_SOURCE_KEY]: { version: 1, source: 'lastfm', identities: [] },
};

/** 给已经建好的宿主替身选 Last.fm 来源；要在开页前调用 */
export function selectLastfmSource(host: { readonly config: Map<string, ConfigValue> }) {
  for (const [key, value] of Object.entries(LASTFM_SOURCE_CONFIG)) host.config.set(key, value);
}
