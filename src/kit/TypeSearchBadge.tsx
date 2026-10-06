import { useAtomValueRawSync } from 'jotai/react';
import { useSyncExternalStore } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import styles from './TypeSearchBadge.module.css';
import type { TypeSearch } from './typeSearch.ts';

export interface TypeSearchBadgeProps {
  readonly search: TypeSearch;
}

/** 打字即跳正在累积的串，浮在网格右上角；没有以它开头的项时换成提示。串空了就不画。 */
export function TypeSearchBadge({ search }: TypeSearchBadgeProps) {
  const t = useAtomValueRawSync(translateAtom);
  const state = useSyncExternalStore(search.subscribe, () => search.state);
  if (!state.text) return null;
  return (
    <div className={styles.root} role="status" data-no-match={state.noMatch || undefined}>
      {state.noMatch ? t('album.typeSearchNoMatch', { text: state.text }) : state.text}
    </div>
  );
}
