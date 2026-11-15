import { Button, Field, Input } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import type { BiographyProblem } from '../biographyModel.ts';
import type { BiographySourcePrefsService } from '../biographySourcePrefs.ts';
import type { BiographyTranslate } from '../BiographyPanel.tsx';
import type { AppleIdentityService } from './appleIdentity.ts';
import { AppleCandidateList, type MatchSource } from './AppleCandidateList.tsx';
import { AppleIdentitySearch } from './AppleIdentitySearch.tsx';
import styles from './AppleIdentityChoice.module.css';

type Reason = 'link' | 'missing' | 'save' | BiographyProblem;

function reasonText(reason: Reason, t: BiographyTranslate): string {
  if (reason === 'link') return t('biography.appleInvalidUrl');
  if (reason === 'missing') return t('biography.appleNone');
  if (reason === 'save') return t('biography.prefsFailed');
  return `${t('biography.identityFailed')} · ${t(`biography.${reason}`)}`;
}

interface LinkFormProps {
  readonly identity: Pick<AppleIdentityService, 'resolveLink'>;
  readonly prefs: Pick<BiographySourcePrefsService, 'confirm'>;
  readonly disabled: boolean;
  readonly t: BiographyTranslate;
}

/** 粘贴 Apple 艺人链接：按链接里的 ID 查一次，成功就存成手选，失败在输入框下写原因 */
function AppleLinkForm({ identity, prefs, disabled, t }: LinkFormProps) {
  const controls = useViewControlStyles();
  const [url, setUrl] = useState('');
  const [reason, setReason] = useState<Reason | null>(null);
  const [checking, setChecking] = useState(false);
  const submit = async () => {
    setChecking(true);
    setReason(null);
    const result = await identity.resolveLink(url);
    const saved = result.ok && (await prefs.confirm(result.identity));
    setChecking(false);
    if (!result.ok) setReason(result.reason);
    else if (!saved) setReason('save');
  };
  return (
    <form
      className={styles.form}
      data-apple-link
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field
        className={styles.field}
        label={t('biography.appleLinkLabel')}
        validationState={reason ? 'error' : 'none'}
        validationMessage={reason ? reasonText(reason, t) : undefined}
      >
        <Input
          className={controls.field}
          value={url}
          onChange={(_, data) => {
            setUrl(data.value);
            setReason(null);
          }}
        />
      </Field>
      <Button
        className={controls.field}
        type="submit"
        disabled={disabled || checking || !url.trim()}
      >
        {t('biography.confirm')}
      </Button>
    </form>
  );
}

export interface AppleIdentityChoiceProps {
  /** 身份的键 */
  readonly artist: string;
  /** 艺人名，预填进搜索框；缺省取 `artist` */
  readonly name?: string;
  readonly identity: AppleIdentityService;
  readonly prefs: BiographySourcePrefsService;
  /** 候选里重合的专辑出自哪份名单，缺省是本地媒体库 */
  readonly matchSource?: MatchSource;
  readonly t: BiographyTranslate;
}

/**
 * 没认定 Apple 艺人时简介里显示的那一块：同名候选、查无此人，或选了「不关联任何艺人」之后留下的
 * 重新认定入口。选中一位、粘贴链接确认都存成手选，之后头部与简介按这位取数；认定中与失败
 * 的提示由面板的状态行与这里的失败行承担
 */
export function AppleIdentityChoice({
  artist,
  name,
  identity,
  prefs,
  matchSource,
  t,
}: AppleIdentityChoiceProps) {
  const controls = useViewControlStyles();
  const state = useAtomValueRawSync(identity.state);
  const loaded = useAtomValueRawSync(prefs.loaded);
  const [open, setOpen] = useState<'search' | 'link' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (state.artist !== artist) return null;
  const pick = async (id: string) => {
    setBusy(id);
    setFailed(null);
    const manual = identity.pick(id);
    const saved = manual ? await prefs.confirm(manual) : false;
    setBusy(null);
    if (!saved) setFailed(id);
  };
  if (state.status === 'failed')
    return (
      <div className={styles.note} role="status">
        <span>{reasonText(state.problem, t)}</span>
        <Button className={controls.field} size="small" onClick={() => identity.refresh()}>
          {t('biography.retry')}
        </Button>
      </div>
    );
  if (state.status !== 'ambiguous' && state.status !== 'none' && state.status !== 'declined')
    return null;
  const toggle = (next: 'search' | 'link') => setOpen(open === next ? null : next);
  return (
    <section
      className={styles.root}
      aria-label={t('biography.unconfirmed')}
      data-apple-identity={state.status}
    >
      {state.status === 'none' && <p className={styles.note}>{t('biography.appleNone')}</p>}
      {state.status === 'ambiguous' && (
        <>
          <h3 className={styles.heading}>{t('biography.identityCandidates')}</h3>
          <AppleCandidateList
            candidates={state.candidates}
            busy={busy}
            failed={failed}
            disabled={!loaded}
            onPick={(id) => void pick(id)}
            {...(matchSource ? { matchSource } : {})}
            t={t}
          />
        </>
      )}
      <div className={styles.actions}>
        <Button
          size="small"
          appearance="subtle"
          className={controls.icon}
          aria-expanded={open === 'search'}
          onClick={() => toggle('search')}
        >
          {t('biography.appleSearch')}
        </Button>
        <Button
          size="small"
          appearance="subtle"
          className={controls.icon}
          aria-expanded={open === 'link'}
          onClick={() => toggle('link')}
        >
          {t('biography.appleLink')}
        </Button>
        {state.status === 'ambiguous' && (
          <Button
            size="small"
            appearance="subtle"
            className={controls.icon}
            disabled={!loaded}
            onClick={() => {
              const manual = identity.decline();
              if (manual) void prefs.confirm(manual);
            }}
          >
            {t('biography.appleDecline')}
          </Button>
        )}
      </div>
      {open === 'search' && (
        <AppleIdentitySearch
          artist={name ?? artist}
          identity={identity}
          busy={busy}
          failed={failed}
          disabled={!loaded}
          onPick={(id) => void pick(id)}
          onClose={() => setOpen(null)}
          t={t}
        />
      )}
      {open === 'link' && (
        <AppleLinkForm identity={identity} prefs={prefs} disabled={!loaded} t={t} />
      )}
    </section>
  );
}
