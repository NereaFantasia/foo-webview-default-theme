import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { libraryAnswers, SAMPLE_ALBUMS } from './albumLibrary.ts';
import { installPageHost } from './pageHost.ts';
import { hostFailure } from './hostAnswers.ts';

export const LOADER_CURRENT = { v: '0.1.0', dir: '0.1.0' };
export const LOADER_NEXT = { v: '0.2.0', dir: '0.2.0_abc123' };
export const LOADER_OLD = { v: '0.0.9', dir: '0.0.9_xyz789' };
const DISK_ROOT = 'E:\\loader-example';

export function builtLoaderFiles(): Map<string, string> {
  const root = resolve('dist');
  const files = new Map<string, string>();
  function read(relative = ''): void {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) read(path);
      else if (entry.isFile()) files.set(path, readFileSync(join(root, path), 'utf8'));
    }
  }
  read();
  return files;
}

export function minimalFrontend(files: Map<string, string>, ref = LOADER_CURRENT): void {
  files.set(
    `fe/${ref.dir}/index.html`,
    `<!doctype html><html><body><h1>Frontend ${ref.v}</h1></body></html>`,
  );
  files.set(
    `fe/${ref.dir}/installed.json`,
    JSON.stringify({
      schema: 1,
      version: ref.v,
      files: { 'index.html': 'f'.repeat(64) },
      releaseSha256: 'a'.repeat(64),
    }),
  );
}

export async function serveLoader(
  page: Page,
  files: Map<string, string>,
  options: {
    mode?: 'standalone' | 'dui' | 'cui';
    windowId?: string;
  } = {},
) {
  const mode = options.mode ?? 'standalone';
  const host = await installPageHost(page, { answers: libraryAnswers(SAMPLE_ALBUMS) });
  host.answer('window.getMode', {
    success: true,
    mode,
    panelMode: mode !== 'standalone',
    windowId: options.windowId ?? 'main',
  });
  host.answer('window.getCurrentWindowId', { success: true, windowId: options.windowId ?? 'main' });
  host.answer('webview.getSource', {
    success: true,
    source: 'activeTemplate',
    directory: DISK_ROOT,
    templateName: 'default',
    activeTemplateName: 'default',
    templatesDirectory: 'E:\\',
  });
  const failWrite: { path: string | null } = { path: null };
  const writes: string[] = [];
  const relative = (raw: unknown): string | null =>
    typeof raw === 'string' && raw.startsWith(`${DISK_ROOT}\\`)
      ? raw.slice(DISK_ROOT.length + 1).replaceAll('\\', '/')
      : null;
  host.answer('file.read', (params) => {
    const path = relative(params['path']);
    const content = path === null ? undefined : files.get(path);
    return content === undefined
      ? hostFailure('OPERATION_FAILED')
      : { success: true, content, size: content.length };
  });
  host.answer('file.exists', (params) => {
    const path = relative(params['path']);
    const exists = path !== null && files.has(path);
    return { success: true, exists, isFile: exists, isDirectory: false };
  });
  host.answer('file.write', (params) => {
    const path = relative(params['path']);
    if (path === null || path === failWrite.path) return hostFailure('OPERATION_FAILED');
    if (params['atomic'] !== true || typeof params['content'] !== 'string')
      return hostFailure('INVALID_PARAMS');
    writes.push(path);
    files.set(path, params['content']);
    return { success: true, path: params['path'], bytesWritten: params['content'].length };
  });
  await page.route('**/*', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\//, '') || 'index.html';
    const content = files.get(path);
    if (content === undefined) return route.fulfill({ status: 404, body: 'Not found' });
    const contentType = path.endsWith('.js')
      ? 'text/javascript'
      : path.endsWith('.css')
        ? 'text/css'
        : path.endsWith('.html')
          ? 'text/html'
          : 'application/json';
    return route.fulfill({ contentType, headers: { 'Cache-Control': 'no-store' }, body: content });
  });
  return { host, writes, failWrite };
}
