import { Button, Popover, PopoverSurface, Tooltip, mergeClasses } from '@fluentui/react-components';
import { Checkmark12Regular, Pen16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { Fragment, useEffect, type MouseEvent } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import styles from './QueryMenu.module.css';
import {
  GROUP_LABELS,
  PRESET_LABELS,
  SNIPPET_LABELS,
  type QueryMenuEntry,
} from './queryMenuEntries.ts';
import { PLAYCOUNT_GROUP, type PresetId } from './queryPresets.ts';

export interface QueryMenuProps {
  readonly open: boolean;
  /** 点到菜单与过滤框之外时报关。 */
  readonly onDismiss: () => void;
  /** 菜单挂在它下面：整个过滤框。点在它里面不算点到外面。 */
  readonly target: HTMLElement | null;
  readonly id: string;
  readonly entries: readonly QueryMenuEntry[];
  /** 键盘或指针落在第几条；-1 是哪条都没有。 */
  readonly active: number;
  readonly onActive: (index: number) => void;
  readonly checked: ReadonlySet<PresetId>;
  /** 点了一条：预设是勾上或取消，写法是填进框里。 */
  readonly onPick: (entry: QueryMenuEntry) => void;
  /** 预设行尾的笔：把这条的查询写进框里接着改。 */
  readonly onEdit: (entry: QueryMenuEntry) => void;
}

/** 选项的元素 id，过滤框用它写 `aria-activedescendant`。 */
export const queryOptionId = (menu: string, index: number) => `${menu}-${index}`;

/** 点菜单里的东西不拿走焦点：焦点留在过滤框里，键盘接着打字、上下选。 */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * 查询菜单：挂在过滤框下面，上面是可勾选的预设（每条右边写出它的查询），下面是只填进框里的写法。焦点一直在
 * 框里，菜单是框的弹出列表（`role="listbox"`），框经 `aria-activedescendant` 指出键盘落在哪一条。要装
 * foo_playcount 的一节没装时整节置灰并写明。
 */
export function QueryMenu(props: QueryMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { entries, active, checked } = props;
  useEffect(() => {
    if (props.open && active >= 0) {
      document
        .getElementById(queryOptionId(props.id, active))
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [props.open, props.id, active]);
  return (
    <Popover
      open={props.open}
      positioning={{ target: props.target, position: 'below', align: 'start', offset: 4 }}
      onOpenChange={(event, data) => {
        const inside = event.target instanceof Node && props.target?.contains(event.target);
        if (!data.open && !inside) props.onDismiss();
      }}
    >
      <PopoverSurface className={styles.surface} onMouseDown={keepFocus}>
        <div
          id={props.id}
          role="listbox"
          aria-label={t('query.menu')}
          aria-multiselectable
          className={styles.list}
          data-query-menu
        >
          {entries.map((entry, index) => {
            const previous = entries[index - 1];
            const group = entry.kind === 'preset' ? entry.preset.group : 'snippets';
            const before =
              previous === undefined
                ? null
                : previous.kind === 'preset'
                  ? previous.preset.group
                  : 'snippets';
            const head = group !== before && (
              <div className={styles.group} role="presentation">
                <span>{group === 'snippets' ? t('query.snippets') : t(GROUP_LABELS[group])}</span>
                {group === PLAYCOUNT_GROUP && (
                  <span className={styles.note}>{t('query.needsPlaycount')}</span>
                )}
              </div>
            );
            const isPreset = entry.kind === 'preset';
            const on = isPreset && checked.has(entry.preset.id);
            const name = isPreset
              ? t(PRESET_LABELS[entry.preset.id])
              : t(SNIPPET_LABELS[entry.snippet.id]);
            const query = isPreset ? entry.preset.query : entry.snippet.text.trim() || '…';
            return (
              <Fragment key={isPreset ? entry.preset.id : entry.snippet.id}>
                {head}
                <div
                  id={queryOptionId(props.id, index)}
                  role="option"
                  aria-selected={on}
                  aria-disabled={entry.disabled || undefined}
                  className={mergeClasses(styles.option, index === active && styles.active)}
                  data-query-option={isPreset ? entry.preset.id : entry.snippet.id}
                  onMouseEnter={() => props.onActive(index)}
                  onClick={() => !entry.disabled && props.onPick(entry)}
                >
                  {isPreset && (
                    <span className={mergeClasses(styles.check, on && styles.checked)}>
                      {on && <Checkmark12Regular />}
                    </span>
                  )}
                  <span className={styles.name}>{name}</span>
                  <span className={styles.query}>{query}</span>
                  {isPreset && (
                    <Tooltip content={t('query.edit')} relationship="label">
                      <Button
                        className={styles.edit}
                        appearance="transparent"
                        size="small"
                        icon={<Pen16Regular />}
                        tabIndex={-1}
                        aria-label={t('query.edit')}
                        disabled={entry.disabled}
                        data-query-edit
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onEdit(entry);
                        }}
                      />
                    </Tooltip>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>
      </PopoverSurface>
    </Popover>
  );
}
