import {
  ATTEMPTS_KEY,
  LOADER_VERSION,
  attempts,
  candidates,
  cookieName,
  installationId,
  installed,
  json,
  readAttempts,
  readSession,
  selectVersion,
  setAttempts,
  type VersionRef,
} from './loader.ts';

const ZH = navigator.language.toLowerCase().startsWith('zh');
const ROOT = new URL('./', location.href);
const title = document.getElementById('title');
const detail = document.getElementById('detail');
const list = document.getElementById('attempts');
const retry = document.getElementById('retry');
// 等待层盖在说明上面；出错时摘掉它，宿主也据此显示窗口。
const overlay = document.getElementById('server-loading');
const stage = document.getElementById('stage');
let installId = '';
document.documentElement.lang = ZH ? 'zh-CN' : 'en';
if (stage) stage.textContent = ZH ? '正在检查主题版本…' : 'Checking the theme version…';

async function read(path: string, missing = false): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(new URL(path, ROOT), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    // 虚拟主机的缺失文件会拒绝 fetch；应用确认时还会经宿主核对安装标识。
    if (missing && ROOT.origin === 'https://foo-ui-webview2.local' && error instanceof TypeError)
      return null;
    throw error;
  }
  if (missing && response.status === 404) return null;
  if (!response.ok) throw new Error('无法读取主题文件');
  const text = await response.text();
  if (text.length > 1024 * 1024) throw new Error('主题文件过大');
  return text;
}
function getCookie(name: string): string | null {
  const entry = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  try {
    return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
}
function putCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`;
  if (getCookie(name) !== value) throw new Error('无法保存启动会话');
}
function saveCounts(value: string): void {
  localStorage.setItem(ATTEMPTS_KEY, value);
  if (localStorage.getItem(ATTEMPTS_KEY) !== value) throw new Error('无法保存启动计数');
}
function explain(refs: readonly VersionRef[], complete: ReadonlySet<string>): void {
  overlay?.remove();
  const ledger = readAttempts(json(localStorage.getItem(ATTEMPTS_KEY)));
  if (title) title.textContent = ZH ? '无法启动主题' : 'The theme could not start';
  if (detail)
    detail.textContent = ZH
      ? '主题文件可能不完整，或已连续启动失败。若重试后仍无法启动，请将完整主题包解压到新目录，再在组件设置中选择该目录。'
      : 'Theme files may be incomplete, or repeated startup attempts have failed. If retrying fails, extract a complete theme package to a new directory and select it in the component settings.';
  list?.replaceChildren(
    ...refs.map((ref) => {
      const item = document.createElement('li');
      const count = attempts(ledger, installId, ref.dir);
      item.textContent = `${ref.v} · ${complete.has(ref.dir) ? (ZH ? `连续 ${count} 次未确认启动` : `${count} unconfirmed starts`) : ZH ? '文件不完整' : 'incomplete files'}`;
      return item;
    }),
  );
  if (retry) {
    retry.hidden = false;
    retry.textContent = ZH ? '重置启动计数并重试' : 'Reset startup counts and retry';
  }
}

async function boot(): Promise<void> {
  installId = (await read('install-id', true))?.trim() ?? '';
  if (installId && !installationId(installId)) throw new Error('安装标识无效');
  let refs: readonly VersionRef[] | null = null;
  for (const path of ['current.json', 'last-good.json']) {
    try {
      refs = candidates(json(await read(path)));
    } catch {
      refs = null;
    }
    if (refs) break;
  }
  if (!refs) {
    explain([], new Set());
    return;
  }
  const session = readSession(json(getCookie(cookieName(installId))));
  const toCheck = [...refs, ...(session ? [session.version] : [])];
  const complete = new Set<string>();
  await Promise.all(
    toCheck.map(async (ref) => {
      try {
        if (installed(json(await read(`fe/${ref.dir}/installed.json`)), ref)) complete.add(ref.dir);
      } catch {
        /* 缺失或损坏的目录不能启动。 */
      }
    }),
  );
  const ledger = readAttempts(json(localStorage.getItem(ATTEMPTS_KEY)));
  const selected = selectVersion(refs, session, ledger, installId, complete);
  if (!selected) {
    explain(refs, complete);
    return;
  }
  const next =
    selected.reused && session
      ? session
      : {
          schema: 1,
          sessionId: crypto.randomUUID(),
          version: selected.version,
          loader: LOADER_VERSION,
          skipped: selected.skipped,
        };
  if (!selected.reused)
    saveCounts(
      JSON.stringify(
        setAttempts(
          ledger,
          installId,
          selected.version.dir,
          attempts(ledger, installId, selected.version.dir) + 1,
        ),
      ),
    );
  putCookie(cookieName(installId), JSON.stringify(next));
  location.replace(
    new URL(`fe/${selected.version.dir}/index.html${location.search}${location.hash}`, ROOT),
  );
}

retry?.addEventListener('click', () => {
  if (retry.dataset.reload) {
    location.reload();
    return;
  }
  void navigator.locks
    .request('default-theme.boot.v1', () => {
      const ledger = readAttempts(json(localStorage.getItem(ATTEMPTS_KEY)));
      saveCounts(
        JSON.stringify({ ...ledger, installations: { ...ledger.installations, [installId]: {} } }),
      );
      document.cookie = `${cookieName(installId)}=; Path=/; Max-Age=0; SameSite=Strict`;
      location.reload();
    })
    .catch(fail);
});
function fail(): void {
  overlay?.remove();
  if (retry) {
    retry.hidden = false;
    retry.dataset.reload = 'true';
    retry.textContent = ZH ? '重新加载' : 'Reload';
  }
  if (title) title.textContent = ZH ? '无法读取或保存启动状态' : 'Startup state is unavailable';
  if (detail)
    detail.textContent = ZH
      ? '请检查主题文件是否完整，以及浏览器存储是否可用。'
      : 'Check that the theme files are complete and browser storage is available.';
}
void (
  navigator.locks
    ? navigator.locks.request('default-theme.boot.v1', boot)
    : Promise.reject(new Error('缺少共享写锁'))
).catch(fail);
