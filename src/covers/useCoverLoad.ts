import { useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createCoverLoad, type CoverLoadReport } from './coverLoad.ts';

export interface CoverImage {
  /** 交给 `<img>` 的地址；空串画占位。 */
  readonly src: string;
  readonly onLoad: () => void;
  readonly onError: () => void;
}

/**
 * 图块的 `<img>` 接上封面服务：想画 `url` 时先要名额，拿到了才把地址交给 `<img>`，拿不到先画 `stand`；
 * 结局经 `report` 报回，卸掉时还没结局的报放弃，出错的地址不再画（见 `createCoverLoad`）。`stand` 与
 * `report` 取最近一次渲染传进来的。
 */
export function useCoverLoad(url: string, stand: string, report: CoverLoadReport): CoverImage {
  const latest = useRef({ report, stand });
  useLayoutEffect(() => {
    latest.current = { report, stand };
  });
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const [load] = useState(() =>
    createCoverLoad(
      {
        acquire: () => latest.current.report.acquire(),
        settle: (outcome) => latest.current.report.settle(outcome),
        wait: (retry) => latest.current.report.wait(retry),
      },
      redraw,
    ),
  );
  useLayoutEffect(() => {
    load.attach();
    return () => load.detach();
  }, [load]);
  useLayoutEffect(() => {
    load.show(url, latest.current.stand);
  }, [load, url]);
  const src = load.src();
  return {
    src,
    onLoad: () => load.finish('load', src),
    onError: () => load.finish('error', src),
  };
}
