import { describe, expect, it } from 'vitest';
import { BACKEND_REQUEST_PATH } from '../../../src/server/backendConnection.ts';
import { LIBRARY_MIRROR_ACTIONS } from '../../../src/server/libraryMirrorProtocol.ts';

describe('媒体库镜像的请求路径', () => {
  it('每个动作的路径都能通过页面连接的路径校验，否则真实连接会在发出前就拒掉它', () => {
    for (const action of LIBRARY_MIRROR_ACTIONS) {
      expect(BACKEND_REQUEST_PATH.test(`/library/${action}`), action).toBe(true);
    }
  });
});
