import { PLUGIN_COMPONENT, compareVersions, satisfies, type Candidate } from './contract.ts';

export interface FailedRelease {
  readonly v: string;
  readonly releaseSha256: string;
}
export interface SelectionContext {
  /** 这次启动正在运行的主题版本。 */
  readonly current: string;
  /** 宿主组件 foo_ui_webview2 的版本。 */
  readonly plugin: string;
  /** 启动 cookie 里记的实际引导页版本；引导页替换失败时它不变，依赖新引导页的版本不会被选中。 */
  readonly loader: number;
  /** 最近一次接受的根清单里的撤回表。 */
  readonly revoked: readonly string[];
  /** 本机拉黑的发行版，按版本号加发行清单哈希认，同号重发的另一份不受影响。 */
  readonly failed: readonly FailedRelease[];
}
/**
 * 没能直接升到最新版的原因：plugin 是插件版本不够；stone 是当前版本低于最新版的 upgradeFrom，
 * loader 是引导页版本低于它的要求，这两种都先升到垫脚石，重启后再继续；manual 是最新版要求
 * 本更新器核对不了的组件。
 */
export type SelectionLimit = 'plugin' | 'stone' | 'loader' | 'manual';
export type ReleaseChoice =
  | { readonly kind: 'current' }
  | {
      readonly kind: 'install';
      readonly candidate: Candidate;
      /** 去掉旧版、撤回与拉黑之后的最高版本。 */
      readonly latest: string;
      /** 选中的就是最新版时为 null。 */
      readonly limit: SelectionLimit | null;
      /** limit 为 plugin 时，最新版要求的插件版本范围。 */
      readonly pluginRange: string | null;
    }
  | {
      readonly kind: 'blocked';
      readonly latest: string;
      readonly limit: SelectionLimit;
      readonly pluginRange: string | null;
    };

function limitOf(candidate: Candidate, context: SelectionContext): SelectionLimit | null {
  if (Object.keys(candidate.requires).some((name) => name !== PLUGIN_COMPONENT)) return 'manual';
  const plugin = candidate.requires[PLUGIN_COMPONENT];
  if (plugin !== undefined && !satisfies(context.plugin, plugin)) return 'plugin';
  if (!satisfies(context.current, candidate.upgradeFrom)) return 'stone';
  if (candidate.requiresLoader > context.loader) return 'loader';
  return null;
}

/** 每次只升一步，从不降级：选中版本确认之后，下一次检查再看能不能继续升。 */
export function selectRelease(
  candidates: readonly Candidate[],
  context: SelectionContext,
): ReleaseChoice {
  const newer = candidates
    .filter(
      (candidate) =>
        (compareVersions(candidate.version, context.current) ?? 0) > 0 &&
        !context.revoked.includes(candidate.version) &&
        !context.failed.some(
          (entry) =>
            entry.v === candidate.version && entry.releaseSha256 === candidate.releaseSha256,
        ),
    )
    .sort((a, b) => compareVersions(b.version, a.version) ?? 0);
  const latest = newer[0];
  if (!latest) return { kind: 'current' };
  const limit = limitOf(latest, context);
  const pluginRange = limit === 'plugin' ? (latest.requires[PLUGIN_COMPONENT] ?? null) : null;
  const target = newer.find((candidate) => limitOf(candidate, context) === null);
  if (!target)
    return { kind: 'blocked', latest: latest.version, limit: limit ?? 'manual', pluginRange };
  return { kind: 'install', candidate: target, latest: latest.version, limit, pluginRange };
}
