import { Button, Input, Switch, Tooltip, mergeClasses } from '@fluentui/react-components';
import { Dismiss20Regular, Search20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { LyricsCandidateResults } from '../../lyrics/candidates/LyricsCandidateResults.tsx';
import { LyricsCandidateSkeleton } from '../../lyrics/candidates/LyricsCandidateSkeleton.tsx';
import { lyricsPrefsKey } from '../../lyrics/lyricsPrefs.ts';
import { useLyricsSearchQuery } from '../../lyrics/useLyricsSearchQuery.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import styles from './LyricsToolbar.module.css';
import { usePanelSurface, useToolsStyles } from './toolsStyles.ts';

/**
 * 歌词搜索展开态的输入层与下拉结果面板
 *
 * 输入层内嵌于工具栏外壳（默认预填曲名与艺人），结果面板通过 Portal 挂载至外壳之外的独立宿主节点以避免溢出裁剪
 * 面板集成过滤开关与候选结果卡片，网络未就绪时提示连接状态。防抖检索与输入法合成事件遵从搜索服务契约
 * 候选卡片仅提供应用操作并于点击后收起面板。退场过渡期间（`leaving` 为真）仅执行淡出动效
 */
export function LyricsToolbarSearch({
  active,
  leaving,
  resultsHost,
  onClose,
}: {
  readonly active: boolean;
  readonly leaving: boolean;
  readonly resultsHost: HTMLElement | null;
  onClose(): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useToolsStyles();
  const controls = useViewControlStyles();
  const surface = usePanelSurface();
  const locale = useAtomValueRawSync(localeAtom).active;
  const track = useAtomValueRawSync(currentTrackAtom);
  const prefs = useService(lyricsPrefsKey);
  const online = useAtomValueRawSync(prefs.pref).enabled;
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const enabled = active && online && connected;
  const query = useLyricsSearchQuery({
    enabled,
    fallbackKeywords: [track?.title, track?.artist].filter(Boolean).join(' '),
    onUsed: onClose,
  });
  const results = useRef<HTMLDivElement>(null);
  const privacyId = useId();
  const { status, candidates } = query.result;
  // 关键词已输入且防抖等待期间展示骨架屏。无关键词且无结果时不渲染面板以避免呈现空边框
  const searchPending = enabled && status === 'idle' && query.keywords.trim() !== '';
  const showResults = !enabled || status !== 'idle' || candidates.length > 0 || searchPending;
  return (
    <>
      <form
        className={styles.search}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          query.submit();
        }}
      >
        <span className={styles.searchIcon} aria-hidden>
          <Search20Regular />
        </span>
        <Input
          className={mergeClasses(styles.query, controls.windowField)}
          autoFocus
          aria-label={t('lyrics.keywords')}
          placeholder={t('lyrics.keywords')}
          value={query.keywords}
          onChange={(_, data) => query.change(data.value)}
          onCompositionStart={() => query.setComposing(true)}
          onCompositionEnd={() => query.setComposing(false)}
        />
        <Tooltip content={t('lyrics.closeSearch')} relationship="label">
          <Button
            appearance="subtle"
            shape="rounded"
            className={mergeClasses(classes.key, controls.icon)}
            icon={<Dismiss20Regular />}
            onClick={onClose}
          />
        </Tooltip>
      </form>
      {resultsHost &&
        showResults &&
        createPortal(
          <div
            ref={results}
            className={mergeClasses(styles.results, surface)}
            role="region"
            aria-label={t('lyrics.search')}
            data-leaving={leaving || undefined}
            data-lyrics-toolbar-results
          >
            {enabled ? (
              <>
                {searchPending && <LyricsCandidateSkeleton />}
                <LyricsCandidateResults
                  result={query.result}
                  enabled
                  viewport={results}
                  using={query.using}
                  onUse={query.use}
                />
              </>
            ) : (
              <div className={styles.online}>
                <Switch
                  label={t('lyrics.online')}
                  checked={online}
                  disabled={!connected}
                  aria-describedby={!online ? privacyId : undefined}
                  onChange={(_, data) => void prefs.setEnabled(data.checked, locale)}
                />
                {!online && <p role="status">{t('lyrics.onlineOff')}</p>}
                {!online && <p id={privacyId}>{t('lyrics.privacy')}</p>}
              </div>
            )}
          </div>,
          resultsHost,
        )}
    </>
  );
}
