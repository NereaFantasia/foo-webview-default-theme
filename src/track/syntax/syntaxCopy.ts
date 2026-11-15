import { fb } from 'foo-webview-sdk/bridge';
import { useEffect, useRef, useState } from 'react';
import { hostCommand } from '../../host/hostCall.ts';

/** 把一段文字放进系统剪贴板；宿主没答应时为 false */
export function copyText(text: string): Promise<boolean> {
  return hostCommand(() => fb.clipboard.write(text));
}

const FLASH_MS = 1500;

/** 复制并让按钮短暂变成对勾；`copied` 是对勾还亮着 */
export function useCopied(): readonly [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = (text: string) => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), FLASH_MS);
    });
  };
  return [copied, copy];
}
