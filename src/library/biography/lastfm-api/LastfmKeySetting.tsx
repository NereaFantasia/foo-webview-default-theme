import { mergeClasses, Button, Input, makeStyles } from '@fluentui/react-components';
import { Eye16Regular, EyeOff16Regular, Open16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { useExternalLinks } from '../../../kit/external-link/ExternalLinkProvider.tsx';
import type { BiographyTranslate } from '../BiographyPanel.tsx';
import type { LastfmKeyCheck, LastfmKeyService } from './lastfmKey.ts';
import styles from './LastfmKeySetting.module.css';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';

/** Last.fm 发 API key 的页面。 */
const APPLY_URL = 'https://www.last.fm/api/account/create';

const useStyles = makeStyles({
  input: { width: '280px', maxWidth: '100%' },
});

export interface LastfmKeySettingProps {
  readonly service: LastfmKeyService;
  readonly online: boolean;
  readonly labelId: string;
  readonly descriptionId: string | undefined;
  readonly t: BiographyTranslate;
}

export function LastfmKeySetting({
  service,
  online,
  labelId,
  descriptionId,
  t,
}: LastfmKeySettingProps) {
  const viewControls = useViewControlStyles();
  const classes = useStyles();
  const links = useExternalLinks();
  const key = useAtomValueRawSync(service.key);
  const check = useAtomValueRawSync(service.check);
  // 没在改时显示存着的 key；改到一半时显示草稿，填完（回车或离开输入框）才提交。
  const [draft, setDraft] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const commit = () => {
    if (draft !== null && service.commit(draft, online)) setDraft(null);
  };
  return (
    <form
      className={styles.root}
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <Input
        className={mergeClasses(classes.input, viewControls.field)}
        type={shown ? 'text' : 'password'}
        value={draft ?? key}
        disabled={!online}
        spellCheck={false}
        autoComplete="off"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        aria-invalid={check === 'malformed' || check === 'invalid' || check === 'suspended'}
        onChange={(_, data) => setDraft(data.value)}
        onBlur={commit}
        contentAfter={
          <Button
            className={viewControls.icon}
            appearance="transparent"
            size="small"
            icon={shown ? <EyeOff16Regular /> : <Eye16Regular />}
            aria-label={t(shown ? 'biography.hideKey' : 'biography.showKey')}
            aria-pressed={shown}
            disabled={!online}
            onClick={() => setShown(!shown)}
          />
        }
      />
      <Button
        className={viewControls.field}
        icon={<Open16Regular />}
        iconPosition="after"
        onClick={() => links.open(APPLY_URL)}
      >
        {t('biography.getKey')}
      </Button>
    </form>
  );
}

/** 卡片说明行写的状态，以及它是不是出错的原因。 */
export function lastfmKeyStatus(
  key: string,
  check: LastfmKeyCheck,
  online: boolean,
  t: BiographyTranslate,
): { readonly text: string | undefined; readonly error: boolean } {
  if (check === 'malformed') return { text: t('biography.keyMalformed'), error: true };
  if (!online) return { text: t('biography.keyOffline'), error: false };
  if (check === 'checking') return { text: t('biography.keyChecking'), error: false };
  if (check === 'valid') return { text: t('biography.keyValid'), error: false };
  if (check === 'invalid') return { text: t('biography.keyInvalid'), error: true };
  if (check === 'suspended') return { text: t('biography.keySuspended'), error: true };
  if (check === 'unverified') return { text: t('biography.keyUnverified'), error: false };
  return { text: key ? undefined : t('biography.keyEmpty'), error: false };
}
