export const NCM_INSTALL_FAILURES = ['download', 'verify', 'write'] as const;
export type NcmInstallFailure = (typeof NCM_INSTALL_FAILURES)[number];

const PHASES = ['missing', 'downloading', 'installing', 'installed'] as const;

/** 这个后端登记的、可下载的网易云组件 */
export interface NcmComponentPackage {
  /** 组件里 NCM API Enhanced 的版本 */
  readonly version: string;
  /** 下载的字节数 */
  readonly size: number;
  /** 装好后占用的字节数 */
  readonly unpackedSize: number;
  /** 组件里各个包声明的许可，去重后排序 */
  readonly licenses: readonly string[];
}

export interface NcmComponentState {
  /** 后端没有登记可下载的组件时为 null，这时只能用已经装在组件目录里的那份 */
  readonly package: NcmComponentPackage | null;
  readonly phase: (typeof PHASES)[number];
  /** 本次已下载的字节；下载开始前为 0 */
  readonly received: number;
  /**
   * 上一次安装失败的原因，再次开始安装时清空。download 是取不到附件，verify 是大小、哈希或包的结构
   * 与描述不符，write 是写不进组件目录
   */
  readonly failure: NcmInstallFailure | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bytes(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readPackage(value: unknown): NcmComponentPackage | null {
  if (
    !record(value) ||
    typeof value.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.version) ||
    !bytes(value.size) ||
    !bytes(value.unpackedSize) ||
    !Array.isArray(value.licenses) ||
    value.licenses.length > 100
  )
    return null;
  const licenses = value.licenses.filter(
    (item): item is string => typeof item === 'string' && /^\S.{0,126}$/.test(item),
  );
  if (licenses.length !== value.licenses.length) return null;
  return {
    version: value.version,
    size: value.size,
    unpackedSize: value.unpackedSize,
    licenses,
  };
}

export function readNcmComponentState(value: unknown): NcmComponentState | null {
  if (!record(value)) return null;
  const phase = PHASES.find((item) => item === value.phase);
  const failure =
    value.failure === null ? null : NCM_INSTALL_FAILURES.find((item) => item === value.failure);
  const component = value.package === null ? null : readPackage(value.package);
  if (
    !phase ||
    failure === undefined ||
    (value.package !== null && !component) ||
    !bytes(value.received) ||
    value.received > (component?.size ?? 0)
  )
    return null;
  return { package: component, phase, received: value.received, failure };
}
