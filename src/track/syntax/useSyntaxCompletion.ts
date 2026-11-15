import { useRef, useState, type KeyboardEvent } from 'react';
import type { Region } from './queryLexer.ts';
import {
  applyCompletion,
  completeAt,
  type Candidate,
  type Completion,
  type Filled,
} from './queryComplete.ts';

// 补全的开合与选中：只管状态与按键，不碰界面也不写文字，落字交给调用方

export interface KeyResult {
  /** 这一下按键补全已经处理了，调用方不要再处理 */
  readonly handled: boolean;
  /** 接受了一项：要写进文字的结果 */
  readonly filled?: Filled;
}

export interface SyntaxCompletion {
  readonly completion: Completion | null;
  readonly active: number;
  /** 同步读开没开：命令登记处里的 `enabled` 在渲染之外调 */
  readonly openRef: { readonly current: boolean };
  /** 文字刚被改过，光标在 `caret` */
  typed(text: string, caret: number): void;
  /** 光标挪了；挪出了要替换的那一段就收起 */
  moved(caret: number): void;
  key(event: KeyboardEvent, text: string, caret: number): KeyResult;
  pick(text: string, item: Candidate): Filled | null;
  setActive(at: number): void;
  close(): void;
}

/** `region` 给 `format` 时整段是 Title Formatting（独立的排序框），缺省按查询补 */
export function useSyntaxCompletion(region: Region = 'query'): SyntaxCompletion {
  const [state, setState] = useState<{ completion: Completion | null; active: number }>({
    completion: null,
    active: 0,
  });
  const openRef = useRef(false);
  const show = (completion: Completion | null) => {
    openRef.current = completion !== null;
    setState({ completion, active: 0 });
  };
  const { completion, active } = state;
  return {
    completion,
    active,
    openRef,
    typed: (text, caret) => show(completeAt(text, caret, false, region)),
    moved: (caret) => {
      if (completion && (caret < completion.from || caret > completion.to)) show(null);
    },
    key(event, text, caret) {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === ' ') {
        show(completeAt(text, caret, true, region));
        return { handled: true };
      }
      if (!completion || event.ctrlKey || event.altKey || event.metaKey) return { handled: false };
      const count = completion.items.length;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : count - 1;
        setState({ completion, active: (active + step) % count });
        return { handled: true };
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        const item = completion.items[active];
        if (!item) return { handled: false };
        show(null);
        return { handled: true, filled: applyCompletion(text, completion, item) };
      }
      if (event.key === 'Escape') {
        show(null);
        return { handled: true };
      }
      return { handled: false };
    },
    pick(text, item) {
      if (!completion) return null;
      show(null);
      return applyCompletion(text, completion, item);
    },
    setActive: (at) => setState((current) => ({ ...current, active: at })),
    close: () => show(null),
  };
}
