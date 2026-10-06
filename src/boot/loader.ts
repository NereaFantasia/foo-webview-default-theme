export const LOADER_VERSION = 1;
export const ATTEMPTS_KEY = 'default-theme.update.v1';
export const COOKIE_PREFIX = 'default-theme.session.v1.';
export const MAX_ATTEMPTS = 3;

export interface VersionRef {
  readonly v: string;
  readonly dir: string;
  readonly [key: string]: unknown;
}
export interface LoaderSession {
  readonly [key: string]: unknown;
  readonly schema: 1;
  readonly sessionId: string;
  readonly version: VersionRef;
  readonly loader: number;
  readonly skipped: readonly VersionRef[];
}
export interface AttemptLedger {
  readonly schema: 1;
  readonly installations: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly [key: string]: unknown;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function json(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}
export function versionRef(value: unknown): VersionRef | null {
  if (!record(value) || typeof value.v !== 'string' || typeof value.dir !== 'string') return null;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.v) || value.v.length > 48)
    return null;
  return value.dir === value.v ||
    (value.dir.startsWith(`${value.v}_`) &&
      /^[a-z0-9]{6}$/.test(value.dir.slice(value.v.length + 1)))
    ? { ...value, v: value.v, dir: value.dir }
    : null;
}
export function installationId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
export function cookieName(id: string): string {
  return `${COOKIE_PREFIX}${id || 'initial'}`;
}

/** frontend 的三个槽永久保持含义，其余字段与 schema 的后续取值不参与选版。 */
export function candidates(value: unknown): readonly VersionRef[] | null {
  if (
    !record(value) ||
    typeof value.schema !== 'number' ||
    !Number.isSafeInteger(value.schema) ||
    value.schema < 1 ||
    !record(value.frontend)
  )
    return null;
  const frontend = value.frontend;
  const refs = ['pending', 'version', 'previous'].flatMap((key) => {
    const ref = versionRef(frontend[key]);
    return ref ? [ref] : [];
  });
  return refs.length > 0
    ? refs.filter((ref, index) => refs.findIndex((other) => other.dir === ref.dir) === index)
    : null;
}

export function readSession(value: unknown): LoaderSession | null {
  if (
    !record(value) ||
    value.schema !== 1 ||
    typeof value.sessionId !== 'string' ||
    !installationId(value.sessionId)
  )
    return null;
  const version = versionRef(value.version);
  if (
    !version ||
    typeof value.loader !== 'number' ||
    !Number.isSafeInteger(value.loader) ||
    value.loader < 1
  )
    return null;
  if (value.skipped !== undefined && !Array.isArray(value.skipped)) return null;
  const skipped = Array.isArray(value.skipped) ? value.skipped.map(versionRef) : [];
  if (
    skipped.length > 2 ||
    skipped.some((ref) => ref === null || ref.dir === version.dir) ||
    new Set(skipped.map((ref) => ref?.dir)).size !== skipped.length
  )
    return null;
  return {
    ...value,
    schema: 1,
    sessionId: value.sessionId,
    version,
    loader: value.loader,
    skipped: skipped.filter((ref): ref is VersionRef => ref !== null),
  };
}

export function readAttempts(value: unknown): AttemptLedger {
  if (!record(value) || value.schema !== 1 || !record(value.installations))
    return { schema: 1, installations: {} };
  const entries: [string, Record<string, number>][] = [];
  for (const [id, raw] of Object.entries(value.installations)) {
    if ((id !== '' && !installationId(id)) || !record(raw)) continue;
    const counts: [string, number][] = [];
    for (const [dir, count] of Object.entries(raw))
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
        counts.push([dir, count]);
    entries.push([id, Object.fromEntries(counts)]);
  }
  const installations = Object.fromEntries(entries);
  return { ...value, schema: 1, installations };
}
export function attempts(ledger: AttemptLedger, id: string, dir: string): number {
  return ledger.installations[id]?.[dir] ?? 0;
}
export function setAttempts(
  ledger: AttemptLedger,
  id: string,
  dir: string,
  count: number,
): AttemptLedger {
  return {
    ...ledger,
    installations: { ...ledger.installations, [id]: { ...ledger.installations[id], [dir]: count } },
  };
}

/** 完整标记至少包含入口文件的哈希；发行身份由发行包的安装过程补入。 */
export function installed(value: unknown, ref: VersionRef): boolean {
  return (
    record(value) &&
    value.schema === 1 &&
    value.version === ref.v &&
    record(value.files) &&
    typeof value.files['index.html'] === 'string' &&
    /^[0-9a-f]{64}$/.test(value.files['index.html'])
  );
}

export interface Selection {
  readonly version: VersionRef;
  readonly reused: boolean;
  readonly skipped: readonly VersionRef[];
}
export function selectVersion(
  refs: readonly VersionRef[],
  session: LoaderSession | null,
  ledger: AttemptLedger,
  id: string,
  complete: ReadonlySet<string>,
): Selection | null {
  if (session && complete.has(session.version.dir))
    return { version: session.version, reused: true, skipped: session.skipped };
  const skipped: VersionRef[] = [];
  for (const version of refs) {
    if (complete.has(version.dir) && attempts(ledger, id, version.dir) < MAX_ATTEMPTS)
      return { version, reused: false, skipped };
    skipped.push(version);
  }
  return null;
}
