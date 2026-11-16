import { describe, expect, it } from 'vitest';
import { BACKEND_REQUEST_PATH } from '../../../src/server/backendConnection.ts';
import { LIBRARY_MIRROR_ACTIONS } from '../../../src/server/libraryMirrorProtocol.ts';
import {
  readLibraryStatsPage,
  readLibraryStatsRow,
  readLibraryStatsStatus,
} from '../../../src/server/libraryStatsProtocol.ts';

describe('媒体库镜像的请求路径', () => {
  it('缓存的非法统计字段与不完整状态不能当作有效数据', () => {
    const row = { handle: 'h', path: 'file://\\\\nas\\music\\x.flac', success: true, playCount: 1 };
    expect(readLibraryStatsRow(row)).toEqual(row);
    expect(readLibraryStatsRow({ ...row, playCount: -1 })).toBeNull();
    expect(readLibraryStatsRow({ ...row, rating: 6 })).toBeNull();
    expect(readLibraryStatsRow({ ...row, added: 123 })).toBeNull();
    expect(readLibraryStatsPage({ rows: [row, {}], next: null })).toBeNull();
    expect(readLibraryStatsStatus({ ready: true, revision: 1, epoch: 'E' })).toBeNull();
  });
  it('每个动作的路径都能通过页面连接的路径校验，否则真实连接会在发出前就拒掉它', () => {
    for (const action of LIBRARY_MIRROR_ACTIONS) {
      expect(BACKEND_REQUEST_PATH.test(`/library/${action}`), action).toBe(true);
    }
  });
});
