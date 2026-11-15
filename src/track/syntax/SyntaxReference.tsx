import {
  Button,
  Input,
  Popover,
  ToggleButton,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  Dismiss20Regular,
  Pin20Filled,
  Pin20Regular,
  Search16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { Fragment, useMemo, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useSectionNav, type SectionSpec } from '../../kit/useSectionNav.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { PopoverSurface } from '../../theme/PopoverSurface.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { DescriptionCell, EntryDetail } from './SyntaxPopups.tsx';
import { useCopied } from './syntaxCopy.ts';
import {
  itemCopyText,
  itemDescription,
  itemName,
  referenceGroups,
  type ReferenceItem,
} from './syntaxReference.ts';
import type { PanelGroup } from './syntaxText.ts';
import styles from './SyntaxReference.module.css';

const useStyles = makeStyles({
  surface: {
    boxSizing: 'border-box',
    width: '440px',
    maxWidth: 'calc(100vw - 32px)',
    height: '480px',
    maxHeight: 'calc(100vh - 96px)',
    padding: 0,
    overflow: 'hidden',
  },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  chip: { minWidth: 'auto', flexShrink: 0 },
});

/** 各组按 `data-syntax-group` 认；点标签时焦点留在查询框里，不往组里放 */
const GROUP_SPEC: SectionSpec = {
  attr: 'data-syntax-group',
  find: (box, group) => box.querySelector<HTMLElement>(`[data-syntax-group="${group}"]`),
};

function ReferenceBody({
  pinned = false,
  playcountMissing,
  only,
  onClose,
  onPinned,
  onInsert,
}: {
  /** 弹出面板的固定与关闭键；内嵌在对话框里时都不给，头上只有搜索 */
  readonly pinned?: boolean;
  readonly playcountMissing: boolean;
  /** 只列这几组；缺省全列 */
  readonly only?: readonly PanelGroup[];
  onClose?(): void;
  onPinned?(next: boolean): void;
  onInsert(item: ReferenceItem): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const controls = useViewControlStyles();
  const classes = useStyles();
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<ReferenceItem | null>(null);
  const [flash, copy] = useCopied();
  const [copiedName, setCopiedName] = useState('');
  const groups = useMemo(() => referenceGroups(t, query, only), [t, query, only]);
  const order = useMemo(() => groups.map(({ group }) => group), [groups]);
  // 点标签滚到那一组：途中标签钉在点的那一组上，不逐个闪过中间的组；用户自己滚了再跟着滚动走
  const nav = useSectionNav(order, reduced, GROUP_SPEC);
  // 点面板不能抢走查询框的焦点和选区；搜索框自己要焦点，不在此列
  const keepFocus = (event: { preventDefault(): void }) => event.preventDefault();

  return (
    <div className={styles['body']}>
      <div className={styles['head']}>
        <Input
          className={mergeClasses(styles['search'], controls.field)}
          size="small"
          contentBefore={<Search16Regular />}
          placeholder={t('query.syntax.search')}
          aria-label={t('query.syntax.search')}
          value={query}
          onChange={(_, data) => setQuery(data.value)}
          data-syntax-search
        />
        {onPinned && (
          <Tooltip
            content={t(pinned ? 'query.syntax.unpin' : 'query.syntax.pin')}
            relationship="label"
          >
            <Button
              appearance="subtle"
              size="small"
              className={controls.icon}
              icon={pinned ? <Pin20Filled /> : <Pin20Regular />}
              aria-pressed={pinned}
              onMouseDown={keepFocus}
              onClick={() => onPinned(!pinned)}
              data-syntax-pin
            />
          </Tooltip>
        )}
        {onClose && (
          <Tooltip content={t('query.syntax.close')} relationship="label">
            <Button
              appearance="subtle"
              size="small"
              className={controls.icon}
              icon={<Dismiss20Regular />}
              onMouseDown={keepFocus}
              onClick={onClose}
              data-syntax-close
            />
          </Tooltip>
        )}
      </div>
      <div className={styles['nav']} role="group" aria-label={t('query.syntax.nav')}>
        {groups.map(({ group }) => (
          <ToggleButton
            key={group}
            appearance="subtle"
            size="small"
            className={mergeClasses(controls.icon, classes.chip)}
            checked={nav.current === group}
            onMouseDown={keepFocus}
            onClick={() => nav.select(group)}
            data-syntax-nav={group}
          >
            {t(`query.syntax.group.${group}`)}
          </ToggleButton>
        ))}
      </div>
      <div ref={nav.attach} className={styles['scroll']}>
        {groups.length === 0 && <div className={styles['empty']}>{t('query.syntax.empty')}</div>}
        {groups.map(({ group, sections: parts }) => (
          <div
            key={group}
            className={styles['group']}
            role="group"
            aria-label={t(`query.syntax.group.${group}`)}
            data-syntax-group={group}
          >
            <div className={styles['title']}>{t(`query.syntax.group.${group}`)}</div>
            {parts.map(({ topic, items }) => (
              <Fragment key={topic ?? group}>
                {topic && (
                  <div className={styles['topic']} data-syntax-topic={topic}>
                    {t(`query.syntax.topic.${topic}`)}
                  </div>
                )}
                {items.map((item) => {
                  const name = itemName(item);
                  return (
                    <div
                      key={name}
                      className={styles['row']}
                      data-syntax-row={name}
                      onMouseEnter={() => setHover(item)}
                    >
                      <button
                        type="button"
                        className={styles['insert']}
                        onMouseDown={keepFocus}
                        onFocus={() => setHover(item)}
                        onClick={() => onInsert(item)}
                      >
                        <span className={styles['name']}>{name}</span>
                        <DescriptionCell
                          text={itemDescription(item, t)}
                          entry={item.kind === 'entry' ? item.entry : undefined}
                          missing={playcountMissing}
                        />
                      </button>
                      <Tooltip content={t('query.syntax.copyExample')} relationship="label">
                        <Button
                          appearance="subtle"
                          size="small"
                          className={mergeClasses(controls.icon, styles['copy'])}
                          icon={
                            flash && copiedName === name ? (
                              <Checkmark16Regular />
                            ) : (
                              <Copy16Regular />
                            )
                          }
                          onMouseDown={keepFocus}
                          onClick={() => {
                            setCopiedName(name);
                            copy(itemCopyText(item));
                          }}
                          data-syntax-copy
                        />
                      </Tooltip>
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        ))}
      </div>
      <div className={styles['foot']}>
        {hover?.kind === 'entry' && <EntryDetail entry={hover.entry} missing={playcountMissing} />}
        {hover?.kind === 'snippet' && (
          <div className={styles['detail']}>
            <code className={classes.mono}>{hover.snippet.text.trim()}</code>
          </div>
        )}
      </div>
    </div>
  );
}

export interface SyntaxReferencePanelProps {
  readonly open: boolean;
  readonly pinned: boolean;
  /** 面板贴着它的下沿展开；还没量到时不出 */
  readonly target: HTMLElement | null;
  /** 与 `target` 的哪一边对齐：缺省与它左对齐向右展开；`end` 与它右对齐向左展开，给贴着右边的触发键用 */
  readonly align?: 'start' | 'end';
  /** foo_playcount 确认没装 */
  readonly playcountMissing: boolean;
  onClose(): void;
  onPinned(next: boolean): void;
  onInsert(item: ReferenceItem): void;
}

/**
 * 语法参考面板：搜索、顶上一排分节标签、按使用先后分组（字段与函数再分小节）、点一行插入到查询框、
 * 行尾复制示例；悬停或聚焦一行时底部写它的签名与示例
 * 缺省是弹出层，点外面或按 Esc 收起；固定之后只有它自己的关闭键能收，可以连着点
 */
export function SyntaxReferencePanel(props: SyntaxReferencePanelProps) {
  const {
    open,
    pinned,
    target,
    align = 'start',
    playcountMissing,
    onClose,
    onPinned,
    onInsert,
  } = props;
  const classes = useStyles();
  const t = useAtomValueRawSync(translateAtom);
  if (!target) return null;
  return (
    <Popover
      open={open}
      trapFocus={false}
      onOpenChange={(_, data) => {
        if (!data.open && !pinned) onClose();
      }}
      positioning={{ target, position: 'below', align, offset: { mainAxis: 4 } }}
    >
      <PopoverSurface
        className={classes.surface}
        aria-label={t('query.syntax.reference')}
        data-syntax-reference
      >
        <ReferenceBody
          pinned={pinned}
          playcountMissing={playcountMissing}
          onClose={onClose}
          onPinned={onPinned}
          onInsert={onInsert}
        />
      </PopoverSurface>
    </Popover>
  );
}

export interface SyntaxReferenceColumnProps {
  /** foo_playcount 确认没装 */
  readonly playcountMissing: boolean;
  /** 只列这几组；缺省全列 */
  readonly only?: readonly PanelGroup[];
  onInsert(item: ReferenceItem): void;
}

/**
 * 内嵌在对话框里的参考栏：内容与弹出面板相同，没有固定与关闭键；填满父元素给的高度
 * 点一行把它插到调用方指定的输入框，焦点不动
 */
export function SyntaxReferenceColumn(props: SyntaxReferenceColumnProps) {
  return <ReferenceBody {...props} />;
}
