import { Button, Tag, TagGroup, makeStyles } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { Translate } from '../../i18n/translate.ts';
import styles from './PlaylistConditions.module.css';
import type { ConditionField, PlaylistCondition } from './playlistMatch.ts';
import { useService } from '../../kit/useService.ts';
import { playlistPageKey } from '../playlistPageServices.ts';

/** 条件行与行菜单「筛选」共用的字段名。 */
export const CONDITION_LABELS: Readonly<Record<ConditionField, MessageKey>> = {
  artist: 'playlistPage.scopeArtist',
  album: 'playlistPage.scopeAlbum',
  genre: 'playlistPage.scopeGenre',
  year: 'playlistPage.conditionYear',
};

const useStyles = makeStyles({ tags: { flexWrap: 'wrap' } });

const keyOf = (condition: PlaylistCondition) =>
  `${condition.field}:${condition.value.toLowerCase()}`;
const labelOf = (t: Translate, condition: PlaylistCondition) =>
  `${t(CONDITION_LABELS[condition.field])} ${condition.value}`;

export interface PlaylistConditionsProps {
  readonly guid: string;
  readonly conditions: readonly PlaylistCondition[];
}

/**
 * 页头下面的条件行：只在有条件时出，逐个列出生效的条件，✕ 去掉一个，末尾「清除条件」只清条件、不动过滤词。
 * 条件从行菜单的「筛选」加。
 */
export function PlaylistConditions({ guid, conditions }: PlaylistConditionsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const playlistPage = useService(playlistPageKey);
  const classes = useStyles();
  if (conditions.length === 0) return null;
  return (
    <div className={styles.root} data-playlist-conditions>
      <TagGroup
        className={classes.tags}
        size="small"
        aria-label={t('playlistPage.conditions')}
        onDismiss={(_, data) => {
          const condition = conditions.find((item) => keyOf(item) === data.value);
          if (condition) playlistPage.filter.removeCondition(guid, condition);
        }}
      >
        {conditions.map((condition) => (
          <Tag
            key={keyOf(condition)}
            value={keyOf(condition)}
            dismissible
            dismissIcon={{
              'aria-label': t('playlistPage.conditionRemove', {
                condition: labelOf(t, condition),
              }),
            }}
            data-playlist-condition={keyOf(condition)}
          >
            {labelOf(t, condition)}
          </Tag>
        ))}
      </TagGroup>
      <Button
        size="small"
        appearance="subtle"
        onClick={() => playlistPage.filter.clearConditions(guid)}
      >
        {t('playlistPage.conditionsClear')}
      </Button>
    </div>
  );
}
