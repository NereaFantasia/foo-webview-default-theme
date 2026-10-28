import { useEffect, useRef, useState } from 'react';
import { copyText } from './hostActions.ts';

/** 「已复制」在按钮上留多久，毫秒 */
const COPIED_MS = 2000;

export type CopyOutcome = 'idle' | 'copied' | 'failed';

/**
 * 设置卡上「复制」键的状态：复制成功后写「已复制」，2 秒后复原；失败一直留着，下一次复制再改
 * 复制的应答可能在离开设置页之后才回来，那时不再改状态、不再起定时器
 */
export function useCopyAction() {
  const [outcome, setOutcome] = useState<CopyOutcome>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const copy = async (text: string) => {
    const done = await copyText(text);
    if (!alive.current) return;
    clearTimeout(timer.current);
    setOutcome(done ? 'copied' : 'failed');
    if (done) timer.current = setTimeout(() => setOutcome('idle'), COPIED_MS);
  };
  return { outcome, copy };
}
