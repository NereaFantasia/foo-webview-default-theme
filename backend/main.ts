import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isBackendId } from '../src/server/backendProtocol.ts';
import { startBackend } from './server.ts';

declare const __BACKEND_VERSION__: string;

const { values } = parseArgs({
  options: {
    directory: { type: 'string' },
    'install-id': { type: 'string' },
    'session-id': { type: 'string' },
    'launch-id': { type: 'string' },
  },
});
const directory = values.directory;
const installId = values['install-id'];
const sessionId = values['session-id'];
const launchId = values['launch-id'];

async function main(): Promise<void> {
  if (!directory || !isBackendId(installId) || !isBackendId(sessionId) || !isBackendId(launchId))
    throw new Error('后端启动参数无效');
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH)
    throw new Error('后端运行环境包含 NODE_OPTIONS 或 NODE_PATH');
  await startBackend({
    directory,
    installId,
    sessionId,
    launchId,
    version: __BACKEND_VERSION__,
  });
}

void main().catch(async (error: unknown) => {
  if (directory && isBackendId(sessionId) && isBackendId(launchId)) {
    await writeFile(
      join(resolve(directory), 'state', `backend-error-${launchId}.json`),
      JSON.stringify({ launchId, error: error instanceof Error ? error.message : '后端启动失败' }),
      { flag: 'wx' },
    ).catch(() => {});
  }
  process.exitCode = 1;
});
