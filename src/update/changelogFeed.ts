import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { readChangelog, type ChangelogEntry } from './changelog.ts';
import { CHANGELOG_LIMIT, type ReleaseFile } from './contract.ts';
import { fetchVerified, type ReleaseHttp } from './releaseFetch.ts';
import type { TemplateFiles } from './templateFiles.ts';

/**
 * 更新日志的两个来源：前端包自带的副本，和根清单指向的远端累计日志。远端日志只放在内存里，取不到或
 * 读不懂时继续显示自带副本。两边都只影响日志显示，不影响检查与安装，也不计入版本的失败次数。
 */

export interface Changelog {
  readonly entries: readonly ChangelogEntry[];
  /** remote 是根清单指向的那份，bundled 是这个前端包自带的。 */
  readonly source: 'remote' | 'bundled';
}
export interface ChangelogFeed {
  readonly changelog: Atom<Changelog | null>;
  readonly loading: Atom<boolean>;
  readonly failed: Atom<boolean>;
  /** 读前端包自带的副本；已经有远端日志时不覆盖。 */
  loadBundled(files: TemplateFiles, dir: string): Promise<void>;
  /** 按根清单里的附件信息拉取；与内存里那份哈希相同时不再拉。从不拒绝。 */
  refresh(http: ReleaseHttp, file: ReleaseFile | null): Promise<void>;
  dispose(): void;
}

export function startChangelogFeed(store: Store): ChangelogFeed {
  const changelog = atom<Changelog | null>(null);
  const loading = atom(false);
  const failed = atom(false);
  let disposed = false;
  let remote: string | null = null;
  function show(next: Changelog): void {
    if (!disposed) store.set(changelog, next);
  }
  return {
    changelog: atom((get) => get(changelog)),
    loading: atom((get) => get(loading)),
    failed: atom((get) => get(failed)),
    async loadBundled(files, dir) {
      try {
        const text = await files.readText(`fe/${dir}/changelog.json`);
        const entries = text === null ? null : readChangelog(text);
        if (entries && remote === null) show({ entries, source: 'bundled' });
      } catch {
        // 读不到自带副本时日志页先空着，等远端日志。
      }
    },
    async refresh(http, file) {
      if (disposed) return;
      if (!file || file.sha256 === remote) {
        store.set(failed, false);
        return;
      }
      store.set(loading, true);
      store.set(failed, false);
      try {
        const answer = await fetchVerified(http, file.url, {
          sha256: file.sha256,
          size: file.size,
          limit: CHANGELOG_LIMIT,
        });
        if (disposed) return;
        if (!answer.ok) {
          store.set(failed, true);
          return;
        }
        const entries = readChangelog(new TextDecoder().decode(answer.value));
        if (!entries) {
          store.set(failed, true);
          return;
        }
        remote = file.sha256;
        show({ entries, source: 'remote' });
      } catch {
        // 拉取失败只是少了远端日志，下次接受根清单时再试。
        if (!disposed) store.set(failed, true);
      } finally {
        if (!disposed) store.set(loading, false);
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
