import { Button, Tooltip } from '@fluentui/react-components';
import {
  RecordRegular,
  ChevronRight16Regular,
  Globe16Regular,
  Info16Regular,
  MicRegular,
  SoundWaveCircle16Regular,
  Translate16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { RefObject } from 'react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { ReadingSurface } from '../../theme/ReadingSurface.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { lyricsCandidateId } from '../lyricsSearchSession.ts';
import type { LyricsCandidate } from '../online/lyricsSource.ts';
import { LyricsCandidateCover } from './LyricsCandidateCover.tsx';
import {
  candidateHasTranslation,
  candidateKind,
  type LyricsCandidateChoice,
} from './lyricsCandidateFilter.ts';
import styles from './LyricsCandidateCard.module.css';

export interface LyricsCandidateCardProps {
  readonly candidate: LyricsCandidateChoice;
  readonly enabled: boolean;
  /** 结果列表的滚动容器，封面按它判断露出了没有 */
  readonly viewport: RefObject<HTMLElement | null>;
  /** 当前激活使用的候选标识（空字符串表示无选中；有应用项时其余候选按钮禁用） */
  readonly using: string;
  /** 预览回调（缺省时不呈现预览入口按钮） */
  onPreview?(candidate: LyricsCandidate): void;
  onUse(candidate: LyricsCandidate): void;
}

/**
 * 歌词检索候选卡片组件（供右侧卡搜索页与沉浸视图共享）
 *
 * 展示封面缩略图、曲目标题、艺人专辑、来源平台、逐字/逐句同步类型及译文标识；
 * 应用操作按钮在悬停、键盘获焦或触屏交互时可见
 */
export function LyricsCandidateCard({
  candidate,
  enabled,
  viewport,
  using,
  onPreview,
  onUse,
}: LyricsCandidateCardProps) {
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const listFormat = new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' });
  const controls = useViewControlStyles();
  const id = lyricsCandidateId(candidate);
  const kind = candidateKind(candidate);
  return (
    <article className={styles.candidate} data-lyrics-candidate>
      <ReadingSurface />
      <LyricsCandidateCover
        candidate={candidate}
        enabled={enabled}
        viewport={viewport}
        className={styles.cover}
      />
      <div className={styles.heading}>
        <strong>{candidate.title}</strong>
        {onPreview && (
          <Tooltip content={t('lyrics.preview')} relationship="label">
            <Button
              size="small"
              appearance="subtle"
              className={controls.icon}
              icon={<ChevronRight16Regular />}
              data-lyrics-focus={`preview:${id}`}
              onClick={() => onPreview(candidate)}
            />
          </Tooltip>
        )}
      </div>
      <div className={styles.byline}>
        {candidate.artists.length > 0 && (
          <span className={styles.field}>
            <MicRegular aria-label={t('trackInfo.artist')} />
            <span>{listFormat.format(candidate.artists)}</span>
          </span>
        )}
        {candidate.album && (
          <span className={styles.field}>
            <RecordRegular aria-label={t('trackInfo.album')} />
            <span>{candidate.album}</span>
          </span>
        )}
      </div>
      <div className={styles.footer}>
        <div className={styles.metadata}>
          <span className={styles.field}>
            <Globe16Regular aria-label={t('lyrics.sourceLabel')} />
            <span>{t(`lyrics.source.${candidate.source}`)}</span>
          </span>
          {candidate.content ? (
            <span className={styles.field}>
              <SoundWaveCircle16Regular aria-label={t('lyrics.format')} />
              <span>{t(`lyrics.${kind}`)}</span>
            </span>
          ) : (
            kind !== 'unknownFormat' && (
              <span className={styles.field}>
                <Info16Regular aria-hidden />
                <span>{t(`lyrics.${kind}`)}</span>
              </span>
            )
          )}
          {candidateHasTranslation(candidate) && (
            <span className={styles.field}>
              <Translate16Regular aria-hidden />
              <span>{t('lyrics.hasTranslation')}</span>
            </span>
          )}
        </div>
        <div className={styles.use}>
          <Button
            size="small"
            appearance="primary"
            data-lyrics-focus={`use:${id}`}
            disabled={!!using}
            onClick={() => onUse(candidate)}
          >
            {using === id ? t('lyrics.loading') : t('lyrics.use')}
          </Button>
        </div>
      </div>
    </article>
  );
}
