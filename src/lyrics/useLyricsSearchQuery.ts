import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import { useService } from '../kit/useService.ts';
import { lyricsKey } from './lyricsService.ts';
import { lyricsCandidateId } from './lyricsSearchSession.ts';
import type { LyricsCandidate } from './online/lyricsSource.ts';

/** 输入停顿后触发自动搜索的防抖延迟，单位毫秒 */
const SEARCH_DELAY_MS = 400;

export interface LyricsSearchQueryOptions {
  /** 是否开启在线联网搜索；禁用时仅保留输入文本 */
  readonly enabled: boolean;
  /** 上次搜索无输入时的默认填充关键词 */
  readonly fallbackKeywords: string;
  /** 选中并应用候选歌词后的回调 */
  onUsed(): void;
}

/**
 * 歌词搜索输入与候选应用交互 hook
 * 文本变动后防抖 400ms 触发搜索，IME 输入法组合态不触发，回车立即提交；管理候选歌词采纳与执行状态，供右侧卡与沉浸视图共享
 */
export function useLyricsSearchQuery({
  enabled,
  fallbackKeywords,
  onUsed,
}: LyricsSearchQueryOptions) {
  const service = useService(lyricsKey);
  const result = useAtomValueRawSync(service.choices);
  const subject = useAtomValueRawSync(service.subject);
  const [keywords, setKeywords] = useState(result.keywords || fallbackKeywords);
  const [composing, setComposing] = useState(false);
  const [using, setUsing] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      enabled &&
      !composing &&
      keywords.trim() &&
      (keywords.trim() !== result.keywords.trim() || result.status === 'idle')
    )
      timer.current = setTimeout(() => void service.search(keywords), SEARCH_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [service, enabled, composing, keywords, result.keywords, result.status]);
  return {
    result,
    keywords,
    /** 直接设置关键词而不中断进行中的搜索；用户交互输入需调用 change */
    setKeywords,
    using,
    setComposing,
    change(value: string) {
      service.cancelSearch();
      setKeywords(value);
    },
    clear() {
      service.cancelSearch();
      setKeywords('');
    },
    submit() {
      if (!enabled || composing) return;
      clearTimeout(timer.current);
      void service.search(keywords, true);
    },
    use(candidate: LyricsCandidate) {
      setUsing(lyricsCandidateId(candidate));
      void service.choose(candidate, false, subject).then((used) => {
        if (!mounted.current) return;
        setUsing('');
        if (used) onUsed();
      });
    },
  };
}
