import { isBackendId } from './backendProtocol.ts';

export interface PluginMaintenance {
  readonly schema: 1;
  readonly id: string;
  readonly nonce: string;
  readonly phase: string;
  readonly installId: string;
  readonly templateDirectory: string;
  readonly profileDirectory: string;
  readonly componentDirectory: string;
  readonly version: string;
  readonly themeVersion: string;
  readonly themeDirectory: string;
  readonly themeRelease: string;
}
export interface PluginConfirmation {
  readonly schema: 1;
  readonly id: string;
  readonly nonce: string;
  readonly sessionId: string;
  readonly hostPid: number;
  readonly installId: string;
  readonly profileDirectory: string;
  readonly componentDirectory: string;
  readonly version: string;
  readonly themeVersion: string;
  readonly themeDirectory: string;
  readonly themeRelease: string;
}
export const PLUGIN_MAINTENANCE = 'state/plugin-maintenance.json';
export function maintenanceRecord(value: unknown): PluginMaintenance | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const schema: unknown = Reflect.get(value, 'schema');
  const id: unknown = Reflect.get(value, 'id');
  const nonce: unknown = Reflect.get(value, 'nonce');
  const installId: unknown = Reflect.get(value, 'installId');
  if (
    schema !== 1 ||
    !isBackendId(id) ||
    !isBackendId(installId) ||
    typeof nonce !== 'string' ||
    !/^[a-f0-9]{64}$/.test(nonce)
  )
    return null;
  const text = (key: string): string | null => {
    const result: unknown = Reflect.get(value, key);
    return typeof result === 'string' && result.length > 0 && result.length <= 512 ? result : null;
  };
  const phase = text('phase'),
    templateDirectory = text('templateDirectory'),
    profileDirectory = text('profileDirectory'),
    componentDirectory = text('componentDirectory');
  const version = text('version'),
    themeVersion = text('themeVersion'),
    themeDirectory = text('themeDirectory'),
    themeRelease = text('themeRelease');
  if (
    !phase ||
    !templateDirectory ||
    !profileDirectory ||
    !componentDirectory ||
    !version ||
    !themeVersion ||
    !themeDirectory ||
    !themeRelease ||
    !/^[a-f0-9]{64}$/.test(themeRelease)
  )
    return null;
  return {
    schema,
    id,
    nonce,
    installId,
    phase,
    templateDirectory,
    profileDirectory,
    componentDirectory,
    version,
    themeVersion,
    themeDirectory,
    themeRelease,
  };
}
export function maintenanceFinished(value: PluginMaintenance): boolean {
  return ['committed', 'rolledBack', 'cancelled'].includes(value.phase);
}

export const PLUGIN_TRANSACTION = 'state/plugin-transaction.json';
export const PLUGIN_PHASES = [
  'prepared',
  'armed',
  'waitingExit',
  'backingUp',
  'replacing',
  'verifying',
  'recovering',
  'committed',
  'rolledBack',
  'cancelled',
  'needsRepair',
] as const;

export interface PluginTransactionRef {
  readonly id: string;
  readonly nonce: string;
  readonly sha256: string;
  readonly directory: string;
}

export interface PluginTransactionStatus extends PluginTransactionRef {
  readonly phase: (typeof PLUGIN_PHASES)[number];
  readonly version: string;
  readonly releaseSha256: string;
  readonly error: string | null;
  readonly running: boolean;
  readonly attempt: string | null;
}

export function readPluginTransaction(value: unknown): PluginTransactionRef | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const id: unknown = Reflect.get(value, 'id');
  const nonce: unknown = Reflect.get(value, 'nonce');
  const sha256: unknown = Reflect.get(value, 'sha256');
  const directory: unknown = Reflect.get(value, 'directory');
  if (
    !isBackendId(id) ||
    typeof nonce !== 'string' ||
    !/^[a-f0-9]{64}$/.test(nonce) ||
    typeof sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    typeof directory !== 'string' ||
    !directory ||
    directory.length > 240
  )
    return null;
  return { id, nonce, sha256, directory };
}

export function readPluginStatus(value: unknown): PluginTransactionStatus | null {
  const reference = readPluginTransaction(value);
  if (!reference || typeof value !== 'object' || value === null) return null;
  const phase = PLUGIN_PHASES.find((item) => item === Reflect.get(value, 'phase'));
  const version: unknown = Reflect.get(value, 'version');
  const releaseSha256: unknown = Reflect.get(value, 'releaseSha256');
  const error: unknown = Reflect.get(value, 'error');
  const running: unknown = Reflect.get(value, 'running');
  const attempt: unknown = Reflect.get(value, 'attempt');
  if (
    !phase ||
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    typeof releaseSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(releaseSha256) ||
    (error !== null && typeof error !== 'string') ||
    typeof running !== 'boolean' ||
    (attempt !== null && (typeof attempt !== 'string' || !/^[a-f0-9]{64}$/.test(attempt)))
  )
    return null;
  return { ...reference, phase, version, releaseSha256, error, running, attempt };
}
