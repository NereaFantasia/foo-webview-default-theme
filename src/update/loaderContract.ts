/** 引导页独立发布，应用按同一份持久契约读写；两端不能互相导入实现。 */
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
export interface Pointer {
  readonly raw: Record<string, unknown>;
  readonly frontend: Record<string, unknown>;
  readonly refs: readonly VersionRef[];
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
export function sameVersion(a: VersionRef | null, b: VersionRef): boolean {
  return a?.v === b.v && a.dir === b.dir;
}
export function installationId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
export function cookieName(id: string): string {
  return `default-theme.session.v1.${id || 'initial'}`;
}
export function readPointer(value: unknown): Pointer | null {
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
  return refs.length ? { raw: value, frontend, refs } : null;
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
  return { ...value, schema: 1, installations: Object.fromEntries(entries) };
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
export function marker(
  value: unknown,
  ref: VersionRef,
): { readonly releaseSha256: string | null } | null {
  if (
    !record(value) ||
    value.schema !== 1 ||
    value.version !== ref.v ||
    !record(value.files) ||
    typeof value.files['index.html'] !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.files['index.html'])
  )
    return null;
  return {
    releaseSha256:
      typeof value.releaseSha256 === 'string' && /^[0-9a-f]{64}$/.test(value.releaseSha256)
        ? value.releaseSha256
        : null,
  };
}
export function loadedVersion(url: URL): VersionRef | null {
  const match = /^\/fe\/([^/]+)\/index\.html$/.exec(url.pathname);
  const dir = match?.[1];
  return dir ? versionRef({ v: dir.split('_')[0], dir }) : null;
}

/** 只移除本次引导实际跳过的引用，运行中新增的 pending 留到下次启动。 */
export function confirmedPointer(
  pointer: Pointer,
  session: LoaderSession,
): Record<string, unknown> | null {
  if (!pointer.refs.some((ref) => sameVersion(ref, session.version))) return null;
  const frontend = { ...pointer.frontend };
  const skipped = (ref: VersionRef | null) =>
    ref && session.skipped.some((item) => sameVersion(ref, item));
  const current = versionRef(frontend.version);
  if (sameVersion(versionRef(frontend.pending), session.version)) {
    frontend.version = session.version;
    delete frontend.pending;
    if (current && !sameVersion(current, session.version) && !skipped(current))
      frontend.previous = current;
  } else if (sameVersion(versionRef(frontend.previous), session.version)) {
    if (current && !skipped(current)) return null;
    frontend.version = session.version;
    delete frontend.previous;
  }
  for (const key of ['pending', 'previous'])
    if (skipped(versionRef(frontend[key]))) delete frontend[key];
  return { ...pointer.raw, frontend };
}

/** 换掉或去掉 pending；原来的 pending 不再被引用，它的目录留给清理。其余字段原样保留。 */
export function pendingPointer(
  pointer: Pointer,
  pending: VersionRef | null,
): Record<string, unknown> {
  const frontend = { ...pointer.frontend };
  if (pending) frontend.pending = { v: pending.v, dir: pending.dir };
  else delete frontend.pending;
  return { ...pointer.raw, frontend };
}
