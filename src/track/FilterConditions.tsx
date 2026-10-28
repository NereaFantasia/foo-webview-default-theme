import { ScrollMenu as Menu, ScrollMenuPopover as MenuPopover } from '../kit/ScrollMenuPopover.tsx';
import { ConditionEditor } from './ConditionEditor.tsx';
import type { TrackCondition } from './trackConditions.ts';
import {
  mergeClasses,
  Button,
  MenuButton,
  MenuItem,
  MenuList,
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
import { useState, type ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useElementWidth } from '../kit/useElementWidth.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import styles from './FilterConditions.module.css';
import type { TrackFilter } from './trackFilter.ts';
import { filterConditions, type FilterCondition } from './filterLabels.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';

/** 条件片容器末尾留给「添加条件」的宽度，像素：它跟在最后一片之后，溢出计算要把它算进去 */
const ADD_WIDTH = 128;

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
  clear: { marginLeft: 'auto' },
});

/**
 * 已选条件一行：条件片在前，「添加条件」接在最后一片之后，「清除条件」靠右；清除条件保留输入框中的两份草稿
 * `tools` 是页面放在行首的工具。`hideWhenEmpty` 时没有条件就整行不出，添加入口改由筛选浮层提供
 */
export interface FilterConditionsProps {
  readonly filter: TrackFilter;
  readonly onRemove: (condition: FilterCondition) => void;
  readonly onClear: () => void;
  readonly playcount: boolean | null;
  readonly onAdd: (condition: TrackCondition) => void;
  readonly tools?: ReactNode;
  readonly hideWhenEmpty?: boolean;
}

export function FilterConditions({
  filter,
  onRemove,
  onClear,
  playcount,
  onAdd,
  tools,
  hideWhenEmpty,
}: FilterConditionsProps) {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const [narrow, setNarrow] = useState(false);
  const measure = useElementWidth<HTMLDivElement>((width) => setNarrow(width < 520));
  const conditions = filterConditions(filter, t);
  const offered = narrow ? conditions.slice(0, 3) : conditions;
  const editor = <ConditionEditor playcount={playcount} onAdd={onAdd} />;
  if (conditions.length === 0)
    return hideWhenEmpty ? null : (
      <div className={styles.toolbar}>
        {tools}
        {editor}
      </div>
    );
  const remove = onRemove;
  return (
    <div className={styles.toolbar}>
      {tools}
      <div ref={measure} className={styles.root} data-query-conditions>
        <Overflow hasHiddenItems={offered.length < conditions.length} padding={ADD_WIDTH}>
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
                  className={classes.tag}
                  primaryText={{ className: classes.text }}
                  title={condition.label}
                  value={condition.key}
                  dismissible
                  dismissIcon={{
                    'aria-label': t('songs.conditionRemove', { condition: condition.label }),
                  }}
                  data-query-condition={condition.key.replace('\n', ':')}
                  appearance="outline"
                >
                  {condition.label}
                </Tag>
              </OverflowItem>
            ))}
            <ConditionsOverflow conditions={conditions} offered={offered} remove={remove} />
            {editor}
          </TagGroup>
        </Overflow>
        <Button
          className={mergeClasses(controls.icon, classes.clear)}
          size="small"
          appearance="subtle"
          onClick={onClear}
        >
          {t('songs.conditionsClear')}
        </Button>
      </div>
    </div>
  );
}

interface ConditionsOverflowProps {
  readonly conditions: readonly FilterCondition[];
  readonly offered: readonly FilterCondition[];
  readonly remove: (condition: FilterCondition) => void;
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
          data-query-condition-overflow
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
  readonly condition: FilterCondition;
  readonly offered: boolean;
  readonly remove: (condition: FilterCondition) => void;
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
