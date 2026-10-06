import { Body1, makeStyles, Subtitle2 } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { roleVar } from '../../theme/roles.ts';
import type { BrowsePhase } from './albumBrowse.ts';
import styles from './BrowseEmptyState.module.css';
import { AddFoldersAction } from '../AddFoldersAction.tsx';

const useStyles = makeStyles({ detail: { color: roleVar('text-secondary') } });

export interface BrowseEmptyStateProps {
  readonly phase: Extract<BrowsePhase, 'disabled' | 'empty' | 'noMatch'>;
}

/** 网格上没有图块可画时占住它的位置：媒体库没开、库是空的、过滤后一张不剩。 */
export function BrowseEmptyState({ phase }: BrowseEmptyStateProps) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  return (
    <div className={styles.root} data-browse-empty={phase}>
      {phase === 'disabled' ? (
        <>
          <Subtitle2>{t('album.disabledTitle')}</Subtitle2>
          <Body1 className={classes.detail}>{t('album.disabledDetail')}</Body1>
        </>
      ) : (
        <Subtitle2>{t(phase === 'empty' ? 'album.empty' : 'album.noMatch')}</Subtitle2>
      )}
      {phase !== 'noMatch' && <AddFoldersAction />}
    </div>
  );
}
