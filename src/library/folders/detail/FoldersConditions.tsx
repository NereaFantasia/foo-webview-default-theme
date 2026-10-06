import { Button, Tag, TagGroup, makeStyles } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import { songsConditions } from '../../songs/songsLabels.ts';
import type { SongsFilter } from '../../songs/songsFilter.ts';
import styles from './FoldersConditions.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';

const useStyles = makeStyles({
  tags: { minWidth: 0, flexWrap: 'wrap' },
  tag: { maxWidth: '160px' },
  text: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});
export function FoldersConditions({ filter }: { readonly filter: SongsFilter }) {
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const classes = useStyles();
  const conditions = songsConditions(filter, t);
  if (!conditions.length) return null;
  return (
    <div className={styles.root}>
      <TagGroup
        className={classes.tags}
        size="small"
        aria-label={t('songs.conditions')}
        onDismiss={(_, data) => {
          const ref = conditions.find((item) => item.key === data.value)?.ref;
          if (ref?.kind === 'preset') folders.results.togglePreset(ref.id);
          else if (ref) folders.results.toggleFacet(ref.facet, ref.name);
        }}
      >
        {conditions.map((condition) => (
          <Tag
            key={condition.key}
            className={classes.tag}
            primaryText={{ className: classes.text }}
            value={condition.key}
            title={condition.label}
            dismissible
            dismissIcon={{
              'aria-label': t('songs.conditionRemove', { condition: condition.label }),
            }}
          >
            {condition.label}
          </Tag>
        ))}
      </TagGroup>
      <Button size="small" appearance="transparent" onClick={folders.results.clearConditions}>
        {t('songs.conditionsClear')}
      </Button>
    </div>
  );
}
