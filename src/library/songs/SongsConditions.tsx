import {
  mergeClasses,
  Button,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Overflow,
  OverflowItem,
  Tag,
  TagGroup,
  makeStyles,
  useIsOverflowItemVisible,
  useOverflowMenu,
} from '@fluentui/react-components';
import { Dismiss16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useElementWidth } from '../../kit/useElementWidth.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import styles from './SongsConditions.module.css';
import type { SongsFilter } from './songsFilter.ts';
import { songsConditions, type SongsCondition } from './songsLabels.ts';
import { useService } from '../../kit/useService.ts';
import { songsKey } from './songsServices.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

const useStyles = makeStyles({
  tags: {
    minWidth: 0,
    flexGrow: 1,
    flexWrap: 'nowrap',
    overflow: 'hidden',
    '& [data-overflowing]': { display: 'none' },
  },
  tag: { flexShrink: 0, maxWidth: '160px' },
  text: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

/**
 * 页头下面的条件行：只在有条件时出，列出勾上的预设与分面，✕ 去掉一个，末尾「清除条件」只清条件、不动框里的字。
 */
export function SongsConditions({ filter }: { readonly filter: SongsFilter }) {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const songs = useService(songsKey);
  const classes = useStyles();
  const [narrow, setNarrow] = useState(false);
  const measure = useElementWidth<HTMLDivElement>((width) => setNarrow(width < 520));
  const conditions = songsConditions(filter, t);
  const offered = narrow ? conditions.slice(0, 3) : conditions;
  if (conditions.length === 0) return null;
  const remove = (condition: SongsCondition) => {
    const { ref } = condition;
    if (ref.kind === 'preset') songs.filter.togglePreset(ref.id);
    else songs.filter.toggleFacet(ref.facet, ref.name);
  };
  return (
    <div ref={measure} className={styles.root} data-songs-conditions>
      <Overflow hasHiddenItems={offered.length < conditions.length}>
        <TagGroup
          className={classes.tags}
          size="small"
          aria-label={t('songs.conditions')}
          onDismiss={(_, data) => {
            const condition = conditions.find((item) => item.key === data.value);
            if (condition) remove(condition);
          }}
        >
          {offered.map((condition) => (
            <OverflowItem key={condition.key} id={condition.key}>
              <Tag
                key={condition.key}
                className={mergeClasses(classes.tag, controls.tag)}
                primaryText={{ className: classes.text }}
                title={condition.label}
                value={condition.key}
                dismissible
                dismissIcon={{
                  'aria-label': t('songs.conditionRemove', { condition: condition.label }),
                }}
                data-songs-condition={condition.key.replace('\n', ':')}
                appearance="outline"
              >
                {condition.label}
              </Tag>
            </OverflowItem>
          ))}
          <ConditionsOverflow conditions={conditions} offered={offered} remove={remove} />
        </TagGroup>
      </Overflow>
      <Button
        className={controls.icon}
        size="small"
        appearance="subtle"
        onClick={() => songs.filter.clearConditions()}
      >
        {t('songs.conditionsClear')}
      </Button>
    </div>
  );
}

interface ConditionsOverflowProps {
  readonly conditions: readonly SongsCondition[];
  readonly offered: readonly SongsCondition[];
  readonly remove: (condition: SongsCondition) => void;
}

function ConditionsOverflow({ conditions, offered, remove }: ConditionsOverflowProps) {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const { ref, isOverflowing, overflowCount } = useOverflowMenu<HTMLButtonElement>();
  const extra = conditions.length - offered.length;
  if (!isOverflowing && extra === 0) return null;
  return (
    <Menu surfaceMotion={MENU_SURFACE_MOTION}>
      <MenuTrigger disableButtonEnhancement>
        <MenuButton
          className={controls.field}
          ref={ref}
          size="small"
          appearance="subtle"
          data-songs-condition-overflow
        >
          {t('songs.conditionsMore', { count: overflowCount + extra })}
        </MenuButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {conditions.map((condition) => (
            <OverflowCondition
              key={condition.key}
              condition={condition}
              offered={offered.includes(condition)}
              remove={remove}
            />
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

function OverflowCondition({
  condition,
  offered,
  remove,
}: {
  readonly condition: SongsCondition;
  readonly offered: boolean;
  readonly remove: (condition: SongsCondition) => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const visible = useIsOverflowItemVisible(condition.key);
  if (offered && visible) return null;
  return (
    <MenuItem
      icon={<Dismiss16Regular />}
      aria-label={t('songs.conditionRemove', { condition: condition.label })}
      onClick={() => remove(condition)}
    >
      {condition.label}
    </MenuItem>
  );
}
