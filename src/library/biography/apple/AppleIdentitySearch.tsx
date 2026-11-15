import { Button, Input, mergeClasses, Spinner } from '@fluentui/react-components';
import { useEffect, useRef, useState } from 'react';
import { useCommand } from '../../../nav/useCommand.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import type { BiographyProblem } from '../biographyModel.ts';
import type { BiographyTranslate } from '../BiographyPanel.tsx';
import type { AppleIdentityService } from './appleIdentity.ts';
import type { AppleCandidate } from './appleMatch.ts';
import { AppleCandidateList } from './AppleCandidateList.tsx';
import styles from './AppleIdentitySearch.module.css';

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | {
      readonly kind: 'found';
      readonly term: string;
      readonly candidates: readonly AppleCandidate[];
    }
  | { readonly kind: 'failed'; readonly reason: BiographyProblem };

export interface AppleIdentitySearchProps {
  /** 本地艺人名，预填进搜索框 */
  readonly artist: string;
  readonly identity: Pick<AppleIdentityService, 'search'>;
  readonly busy: string | null;
  readonly failed: string | null;
  readonly disabled: boolean;
  readonly onPick: (id: string) => void;
  readonly onClose: () => void;
  readonly t: BiographyTranslate;
}

/**
 * 手动搜索其他艺人：预填本地艺人名，按 Enter 或点搜索才发请求，不边输边搜。结果复用候选行，
 * 没有「与本地重合」的标记（手动搜的不比对）。Esc 收起
 */
export function AppleIdentitySearch({
  artist,
  identity,
  busy,
  failed,
  disabled,
  onPick,
  onClose,
  t,
}: AppleIdentitySearchProps) {
  const controls = useViewControlStyles();
  const [term, setTerm] = useState(artist);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // 后发的搜索盖过先发的；收起后晚到的应答也丢掉
  const run = useRef(0);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
    return () => {
      run.current += 1;
    };
  }, []);
  useCommand({
    id: 'biography.appleSearch.escape',
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () => !!root.current?.contains(document.activeElement),
    run: onClose,
  });
  const search = async () => {
    const keyword = term.trim();
    if (!keyword) return;
    run.current += 1;
    const mine = run.current;
    setPhase({ kind: 'searching' });
    const result = await identity.search(keyword);
    if (mine !== run.current) return;
    setPhase(
      result.ok
        ? { kind: 'found', term: keyword, candidates: result.candidates }
        : { kind: 'failed', reason: result.reason },
    );
  };
  return (
    <div className={styles.root} ref={root} data-apple-search>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Input
          className={mergeClasses(controls.field, styles.input)}
          input={{ ref: input }}
          value={term}
          aria-label={t('biography.appleSearchLabel')}
          onChange={(_, data) => setTerm(data.value)}
        />
        <Button
          className={controls.field}
          type="submit"
          disabled={!term.trim() || phase.kind === 'searching'}
        >
          {t('biography.appleSearchRun')}
        </Button>
      </form>
      <div role="status">
        {phase.kind === 'searching' && (
          <Spinner size="tiny" aria-label={t('biography.appleSearchRun')} />
        )}
        {phase.kind === 'found' && phase.candidates.length === 0 && (
          <p className={styles.note}>{t('biography.appleSearchEmpty', { term: phase.term })}</p>
        )}
        {phase.kind === 'failed' && (
          <p className={styles.note}>
            <span>
              {t('biography.identityFailed')} · {t(`biography.${phase.reason}`)}
            </span>
            <Button className={controls.field} size="small" onClick={() => void search()}>
              {t('biography.retry')}
            </Button>
          </p>
        )}
      </div>
      {phase.kind === 'found' && phase.candidates.length > 0 && (
        <AppleCandidateList
          candidates={phase.candidates}
          busy={busy}
          failed={failed}
          disabled={disabled}
          onPick={onPick}
          t={t}
        />
      )}
    </div>
  );
}
