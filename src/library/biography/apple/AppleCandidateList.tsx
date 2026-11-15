import { Button, makeStyles, mergeClasses, Spinner, tokens } from '@fluentui/react-components';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import type { BiographyTranslate } from '../BiographyPanel.tsx';
import type { AppleCandidate } from './appleMatch.ts';
import styles from './AppleCandidateList.module.css';

// 候选行比 Fluent 按钮高、字也多：放开默认的最大宽度与固定行高，允许换行
const useStyles = makeStyles({
  row: {
    justifyContent: 'flex-start',
    width: '100%',
    maxWidth: 'none',
    height: 'auto',
    paddingBlock: tokens.spacingVerticalS,
    textAlign: 'start',
    whiteSpace: 'normal',
    fontWeight: 'inherit',
  },
});

function yearsOf(years: AppleCandidate['years']): string {
  if (!years) return '';
  return years[0] === years[1] ? String(years[0]) : `${years[0]}–${years[1]}`;
}

function albumsOf(candidate: AppleCandidate, t: BiographyTranslate): string {
  if (!candidate.albumCount) return '';
  return t(candidate.albumCount === 1 ? 'biography.appleAlbumOne' : 'biography.appleAlbumCount', {
    count: candidate.albumCount,
  });
}

/** 重合的专辑所属的名单：本地艺人是媒体库里的专辑，在线艺人是平台给的专辑 */
export type MatchSource = 'library' | 'platform';

/** 与名单重合的专辑：写第一张，多张时加「等 N 张」 */
function overlapOf(candidate: AppleCandidate, source: MatchSource, t: BiographyTranslate): string {
  const [first] = candidate.matched;
  if (!first) return '';
  if (source === 'platform')
    return candidate.matched.length > 1
      ? t('biography.platformMatchedMore', { album: first, count: candidate.matched.length })
      : t('biography.platformMatched', { album: first });
  return candidate.matched.length > 1
    ? t('biography.appleMatchedMore', { album: first, count: candidate.matched.length })
    : t('biography.appleMatched', { album: first });
}

export interface AppleCandidateListProps {
  readonly candidates: readonly AppleCandidate[];
  /** 正在存手选的那一位 */
  readonly busy: string | null;
  /** 手选没能保存的那一位 */
  readonly failed: string | null;
  readonly disabled: boolean;
  readonly onPick: (id: string) => void;
  /** 重合的专辑出自哪份名单，缺省是本地媒体库 */
  readonly matchSource?: MatchSource;
  readonly t: BiographyTranslate;
}

/**
 * 同名候选：一行一位，靠曲风、发行年份范围、专辑数与前几张专辑名认人，有与本地重合的专辑时
 * 行末标出。整行是按钮，点一下选中；认定器给的次序不在这里重排
 */
export function AppleCandidateList({
  candidates,
  busy,
  failed,
  disabled,
  onPick,
  matchSource = 'library',
  t,
}: AppleCandidateListProps) {
  const classes = useStyles();
  const viewControls = useViewControlStyles();
  return (
    <ul className={styles.list} data-apple-candidates>
      {candidates.map((candidate) => {
        const detail = [yearsOf(candidate.years), albumsOf(candidate, t)]
          .filter(Boolean)
          .join(' · ');
        const matched = overlapOf(candidate, matchSource, t);
        return (
          <li key={candidate.id}>
            <Button
              appearance="subtle"
              className={mergeClasses(classes.row, viewControls.icon)}
              disabled={disabled || !!busy}
              icon={busy === candidate.id ? <Spinner size="extra-tiny" /> : undefined}
              data-apple-candidate={candidate.id}
              onClick={() => onPick(candidate.id)}
            >
              <span className={styles.candidate}>
                <span className={styles.head}>
                  <span className={styles.name}>{candidate.name}</span>
                  {candidate.genre && <span className={styles.meta}>{candidate.genre}</span>}
                </span>
                {detail && <span className={styles.meta}>{detail}</span>}
                {candidate.samples.length > 0 && (
                  <span className={styles.meta}>{candidate.samples.join(' · ')}</span>
                )}
                {matched && <span className={styles.matched}>{matched}</span>}
              </span>
            </Button>
            {failed === candidate.id && (
              <span className={styles.meta} role="status">
                {t('biography.prefsFailed')}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
