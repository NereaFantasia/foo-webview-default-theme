import { atom, type Atom } from 'jotai/vanilla';

/** 图像拉取进度定义：`source` 非空表示具备图像拉取源，`state` 记录拉取状态 */
export interface BiographyImageProgress {
  readonly source: Atom<unknown>;
  readonly state: Atom<{
    readonly photo: unknown;
    readonly loading: boolean;
    readonly problem: unknown;
  }>;
}

export interface BiographySearchingDeps {
  readonly enabled: Atom<boolean>;
  readonly active: Atom<boolean>;
  /** 艺人身份标识；为空（如合辑名称）时不触发拉取 */
  readonly subject: Atom<string | null>;
  /** 当前数据源的艺人身份认定状态 */
  readonly identity: Atom<{ readonly artist: string | null; readonly status: string }>;
  readonly input: Atom<{ readonly sourceId: string | null } | null>;
  /** 简介正文拉取完成且艺术照数据源已就绪 */
  readonly ready: Atom<boolean>;
  readonly images: readonly BiographyImageProgress[];
}

/**
 * 汇总数据源拉取状态：
 * 判定条件包括身份认定、正文拉取及各图像源（含相册）加载是否仍在进行中；
 * 流程全部完成前持续保持加载态，避免首张图像到达或正文返回瞬间加载指示器闪烁；
 * 在线功能未启用、视图非激活、缺少艺人标识或流程全部完结（含无图/失败）时不视为拉取中
 */
export function biographySearching(deps: BiographySearchingDeps): Atom<boolean> {
  return atom((get) => {
    const subject = get(deps.subject);
    if (!get(deps.enabled) || !get(deps.active) || subject === null) return false;
    const found = get(deps.identity);
    const identifying =
      found.artist !== subject || found.status === 'idle' || found.status === 'resolving';
    const reading = !!get(deps.input)?.sourceId && !get(deps.ready);
    const pending = deps.images.some(({ source, state }) => {
      const image = get(state);
      return image.loading || (get(source) !== null && !image.photo && image.problem === null);
    });
    return identifying || reading || pending;
  });
}
