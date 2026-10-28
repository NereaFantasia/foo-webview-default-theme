import type { KindOpener } from '../../nav/objectOpener.ts';
import type { ObjectRef } from '../../nav/objectRef.ts';
import { trackOrigin } from '../../host/trackOrigin.ts';
import type { FoldersServices } from './foldersServices.ts';

type FolderRef = Extract<ObjectRef, { kind: 'folder' }>;

/**
 * 构造目录对象打开器契约
 * 仅本地独立文件支持所在目录操作；库根以内导航至文件夹视图，库外文件调起系统资源管理器
 * 解析定位在 prepare 阶段执行，导航或外部调起在 settle 阶段确认执行，以防被并发操作作废
 */
export function folderKind(folders: () => FoldersServices): KindOpener<FolderRef> {
  return {
    availability: (ref) => (trackOrigin(ref.path) === 'file' ? 'ready' : 'missing'),
    async prepare(ref) {
      const subject = await folders().locateFile(ref.path);
      // 库根列表未就绪时判定打开失败，由调用方负责错误提示
      if (subject === undefined) return { ok: false, result: 'failed', notice: null };
      return {
        ok: true,
        async settle() {
          if (subject !== null) {
            folders().enter(subject);
            return 'done';
          }
          return (await folders().showInExplorer(ref.path)) ? 'external' : 'failed';
        },
      };
    },
  };
}
