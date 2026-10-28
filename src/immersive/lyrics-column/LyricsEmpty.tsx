import { Button, Spinner } from '@fluentui/react-components';
import { ArrowClockwise16Regular, Globe20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useRef } from 'react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { lyricsEmpty } from '../../lyrics/lyricsEmpty.ts';
import { lyricsPrefsKey } from '../../lyrics/lyricsPrefs.ts';
import { lyricsKey, type LyricsState } from '../../lyrics/lyricsService.ts';
import { playbackKey } from '../../playback/playbackContract.ts';
import { playbackTrackStatusAtom } from '../../playback/playback.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import styles from './LyricsEmpty.module.css';

/**
 * 沉浸模式歌词缺省与空状态占位组件
 *
 * 统一承载加载中、连接失败、暂无歌词等空状态提示及重试与联网搜索引导；点击操作前主动将焦点回收至容器以防按键销毁导致焦点散失
 */
export function LyricsEmpty({ state }: { readonly state: LyricsState }) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const locale = useAtomValueRawSync(localeAtom).active;
  const lyrics = useService(lyricsKey);
  const prefs = useService(lyricsPrefsKey);
  const playback = useService(playbackKey);
  const online = useAtomValueRawSync(prefs.pref).enabled;
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const trackStatus = useAtomValueRawSync(playbackTrackStatusAtom);
  const privacyId = useId();
  const box = useRef<HTMLDivElement>(null);
  const empty = lyricsEmpty(state, { connected, trackStatus });
  const retry = empty.retry === 'playback' ? playback.retry : lyrics.refresh;
  return (
    <div ref={box} className={styles.empty} tabIndex={-1}>
      {empty.loading ? (
        <Spinner size="small" label={t(empty.message)} />
      ) : (
        <p role="status" className={styles.message}>
          {t(empty.message)}
        </p>
      )}
      {empty.canRetry && (
        <Button
          className={controls.field}
          icon={<ArrowClockwise16Regular />}
          onClick={() => {
            box.current?.focus();
            retry();
          }}
        >
          {t('lyrics.retry')}
        </Button>
      )}
      {!online && empty.canSearchOnline && (
        <>
          <Button
            appearance="primary"
            icon={<Globe20Regular />}
            aria-describedby={privacyId}
            onClick={() => {
              box.current?.focus();
              void prefs.setEnabled(true, locale);
            }}
          >
            {t('lyrics.searchOnline')}
          </Button>
          <p id={privacyId} className={styles.privacy}>
            {t('lyrics.privacy')}
          </p>
        </>
      )}
    </div>
  );
}
