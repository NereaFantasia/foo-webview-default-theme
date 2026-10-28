import { ScrollMenu as Menu, ScrollMenuPopover as MenuPopover } from './ScrollMenuPopover.tsx';
import {
  Button,
  MenuButton,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tooltip,
  mergeClasses,
} from '@fluentui/react-components';
import {
  ArrowDown20Regular,
  ArrowSortDownLines20Regular,
  ArrowSortUpLines20Regular,
  ArrowUp20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { useCommandButtonStyles } from './CommandBar.tsx';
import styles from './SortMenu.module.css';

export interface SortOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SortGroup<T extends string> {
  readonly label?: string;
  readonly options: readonly SortOption<T>[];
}

export interface SortMenuProps<T extends string> {
  readonly groups: readonly SortGroup<T>[];
  readonly field: T;
  readonly descending: boolean;
  readonly valueLabel?: string;
  readonly onField: (field: T) => void;
  readonly onDescending?: (descending: boolean) => void;
  /** 随机排序每次点击都要重排，因此作为命令而非单选项 */
  readonly shuffle?: { readonly value: T; readonly label: string; readonly run: () => void };
  readonly buttonAttributes?: Readonly<Record<`data-${string}`, string>>;
  /**
   * 命令栏里的排序键：键上固定写「排序」，图标随方向变，方向只在菜单里改；`labelled` 为 false 时只留图标
   * 不传时是左栏那种写当前字段的键，旁边另有方向键
   */
  readonly tool?: { readonly labelled: boolean };
  /** 左栏这类窄处保留字段名、只在菜单里改方向时传 false */
  readonly directionKey?: boolean;
}

/**
 * 只编辑排序选择；实际排序、保存与操作范围由调用方负责。左栏的字段键写当前字段，方向另有一个图标键一点就反转；
 * 命令栏里的排序键文字固定，当前字段与方向写在 Tooltip 和菜单的勾选里
 */
export function SortMenu<T extends string>(props: SortMenuProps<T>) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const command = useCommandButtonStyles();
  const { tool } = props;
  const options = props.groups.flatMap((group) => group.options);
  const random = props.shuffle?.value === props.field;
  const selected = random ? props.shuffle : options.find((option) => option.value === props.field);
  const direction = props.descending ? 'descending' : 'ascending';
  const value = props.valueLabel ?? selected?.label ?? '';
  const flip =
    props.onDescending && !random && !tool && props.directionKey !== false
      ? props.onDescending
      : null;
  // 没有方向可选时（随机、缺省顺序）提示里不写升降序
  const tooltip =
    tool && !random && props.onDescending
      ? t('query.sortTool', { value, direction: t(`query.${direction}`) })
      : t('query.sortValue', { value });
  return (
    <span className={styles.root}>
      <Menu
        checkedValues={{ field: [props.field], direction: random ? [] : [direction] }}
        onCheckedValueChange={(_, data) => {
          if (data.name === 'direction') {
            props.onDescending?.(data.checkedItems.includes('descending'));
          } else if (data.name === 'field') {
            const next = options.find((option) => data.checkedItems.includes(option.value));
            if (next && !next.disabled) props.onField(next.value);
          }
        }}
      >
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content={tooltip} relationship="label">
            <MenuButton
              {...props.buttonAttributes}
              className={mergeClasses(controls.icon, tool?.labelled && command.labelled)}
              data-sort-menu
              icon={
                tool && !props.descending ? (
                  <ArrowSortUpLines20Regular />
                ) : (
                  <ArrowSortDownLines20Regular />
                )
              }
              menuIcon={tool && !tool.labelled ? null : undefined}
              appearance="subtle"
            >
              {tool ? (tool.labelled ? t('query.sort') : undefined) : value}
            </MenuButton>
          </Tooltip>
        </MenuTrigger>
        <MenuPopover>
          <MenuList aria-label={t('query.sort')}>
            {props.groups.map((group, index) => (
              <MenuGroup key={group.label ?? index}>
                {index > 0 && <MenuDivider />}
                {group.label && <MenuGroupHeader>{group.label}</MenuGroupHeader>}
                {group.options.map((option) => (
                  <MenuItemRadio
                    key={option.value}
                    name="field"
                    value={option.value}
                    disabled={option.disabled}
                    data-sort-field={option.value}
                  >
                    {option.label}
                  </MenuItemRadio>
                ))}
              </MenuGroup>
            ))}
            {props.shuffle && (
              <>
                <MenuDivider />
                <MenuItem data-sort-field={props.shuffle.value} onClick={props.shuffle.run}>
                  {props.shuffle.label}
                </MenuItem>
              </>
            )}
            {props.onDescending && (
              <>
                <MenuDivider />
                <MenuGroup>
                  <MenuGroupHeader>{t('query.sortDirection')}</MenuGroupHeader>
                  <MenuItemRadio name="direction" value="ascending" disabled={random}>
                    {t('query.ascending')}
                  </MenuItemRadio>
                  <MenuItemRadio name="direction" value="descending" disabled={random}>
                    {t('query.descending')}
                  </MenuItemRadio>
                </MenuGroup>
              </>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
      {flip && (
        <Tooltip
          content={t(props.descending ? 'query.toAscending' : 'query.toDescending')}
          relationship="label"
        >
          <Button
            appearance="subtle"
            className={controls.icon}
            icon={props.descending ? <ArrowDown20Regular /> : <ArrowUp20Regular />}
            onClick={() => flip(!props.descending)}
            data-sort-direction={props.descending ? 'descending' : 'ascending'}
          />
        </Tooltip>
      )}
    </span>
  );
}
