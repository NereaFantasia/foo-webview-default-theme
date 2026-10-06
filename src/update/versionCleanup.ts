import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';
import { json, readPointer, type VersionRef } from './loaderContract.ts';
import type { TemplateFiles } from './templateFiles.ts';

/**
 * 清理不再引用的前端版本目录。保留集是 current.json 与 last-good.json 引用的目录，加上这次运行在用的
 * 目录；两份指针都读不出时不删任何目录。每个目录先删 `installed.json`，删成之后它就被当作不存在，
 * 再整个交给宿主后台删除；标记删不掉时整个目录跳过，删不掉的目录（被占用、带只读属性）留到下次启动。
 * 只碰名字像版本目录的子目录，用户自己放进来的东西不动。调用方要保证清理期间没有安装在进行。
 */

export type CleanupHost = {
  readonly file: Pick<typeof fb.file, 'list' | 'delete' | 'deleteAsync'>;
};

const VERSION_DIRECTORY = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:_[a-z0-9]{6})?$/;
/** 宿主原子写留下的临时文件名。 */
const ATOMIC_TEMP = /^\.~\d+-\d+\.tmp$/;

async function listing(files: TemplateFiles, host: CleanupHost, relative: string) {
  const target = relative ? files.path(relative) : files.directory;
  const answer = await settle(() => host.file.list(target));
  return answer && answer.success !== false ? answer : { files: [], directories: [] };
}
async function remove(files: TemplateFiles, host: CleanupHost, relative: string) {
  const answer = await settle(() => host.file.delete(files.path(relative), { moveToTrash: false }));
  return answer?.success === true || answer?.code === 'NOT_FOUND';
}
async function referenced(files: TemplateFiles, name: string): Promise<VersionRef[] | null> {
  try {
    return readPointer(json(await files.readText(name)))?.refs.slice() ?? null;
  } catch {
    return null;
  }
}

/** `extra` 是另外要删的文件，例如已不再刷新的运行标记。返回交给宿主删除的目录名。 */
export async function cleanVersions(
  files: TemplateFiles,
  host: CleanupHost,
  running: VersionRef,
  extra: readonly string[] = [],
  check: () => void = () => {},
): Promise<string[]> {
  check();
  const current = await referenced(files, 'current.json');
  const good = await referenced(files, 'last-good.json');
  const doomed: string[] = [];
  if (current || good) {
    const keep = new Set([running, ...(current ?? []), ...(good ?? [])].map((ref) => ref.dir));
    for (const name of (await listing(files, host, 'fe')).directories) {
      check();
      if (!VERSION_DIRECTORY.test(name) || keep.has(name)) continue;
      if (await remove(files, host, `fe/${name}/installed.json`)) doomed.push(name);
    }
  }
  for (const folder of ['', 'state'])
    for (const name of (await listing(files, host, folder)).files) {
      check();
      if (ATOMIC_TEMP.test(name)) await remove(files, host, folder ? `${folder}/${name}` : name);
    }
  for (const path of extra) {
    check();
    await remove(files, host, path);
  }
  check();
  if (doomed.length)
    await settle(() =>
      host.file.deleteAsync(
        doomed.map((name) => files.path(`fe/${name}`)),
        { moveToTrash: false },
      ),
    );
  return doomed;
}
