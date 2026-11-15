import { Popover, makeStyles, tokens } from '@fluentui/react-components';
import {
  ErrorCircle16Regular,
  Info16Regular,
  Warning12Filled,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { PopoverSurface } from '../../theme/PopoverSurface.tsx';
import type { Completion } from './queryComplete.ts';
import type { Hint } from './syntaxHint.ts';
import { entryDescription } from './syntaxText.ts';
import type { SyntaxEntry } from './syntaxTable.ts';
import styles from './SyntaxPopups.module.css';

const useStyles = makeStyles({
  // 列表可滚、详情钉在底部：浮层的高度被定位压到视口余量时，是列表缩，不是整块溢出
  list: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: '460px',
    maxWidth: 'calc(100vw - 32px)',
    padding: tokens.spacingVerticalXS,
  },
  // 说明行只是提示，不接收鼠标：它浮在输入框下面，点击要落到它盖住的控件上
  hint: {
    boxSizing: 'border-box',
    maxWidth: 'min(480px, calc(100vw - 32px))',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    pointerEvents: 'none',
  },
});

/** 提供字段的组件名，原样写在标签与说明里，不翻译 */
const SOURCE_NAME = { playcount: 'foo_playcount' } as const;

/** 没装提供字段的组件：软来源（另有标签可读）不算 */
function isMissing(entry: SyntaxEntry, missing: boolean): boolean {
  return missing && entry.source !== undefined && entry.soft !== true;
}

/** 一条目的详情：签名、一句说明、示例与要留意的两点；补全列表底部与参考面板底部共用 */
export function EntryDetail({
  entry,
  missing = false,
}: {
  readonly entry: SyntaxEntry;
  /** 提供字段的组件没装 */
  readonly missing?: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const description = entryDescription(entry, t);
  const sourceNote = entry.soft
    ? 'query.syntax.playcountOrTag'
    : missing
      ? 'query.syntax.playcountMissing'
      : 'query.needsPlaycount';
  return (
    <div className={styles['detail']} data-syntax-detail>
      <code className={styles['signature']}>{entry.signature}</code>
      {description && <p className={styles['body']}>{description}</p>}
      {entry.example && <p className={styles['example']}>{entry.example}</p>}
      {entry.technical && <p className={styles['note']}>{t('query.syntax.technical')}</p>}
      {entry.source && <p className={styles['note']}>{t(sourceNote)}</p>}
    </div>
  );
}

/** 列表行里的说明格：一句说明在前（放不下时省略），依赖别的组件的字段在行尾带一个组件名标签；补全列表与参考面板共用 */
export function DescriptionCell({
  text,
  entry,
  missing = false,
}: {
  readonly text: string | null;
  readonly entry?: SyntaxEntry;
  /** 提供字段的组件没装：标签换成警示色并带图标，不只靠颜色 */
  readonly missing?: boolean;
}) {
  const source = entry?.source;
  return (
    <span className={styles['descCell']}>
      <span className={styles['desc']}>{text}</span>
      {source && (
        <span
          className={styles['tag']}
          data-missing={entry && isMissing(entry, missing) ? '' : undefined}
          data-syntax-source={source}
        >
          {entry && isMissing(entry, missing) && <Warning12Filled />}
          {SOURCE_NAME[source]}
        </span>
      )}
    </span>
  );
}

export function optionId(listId: string, at: number): string {
  return `${listId}-option-${at}`;
}

/** 补全列表：名称、一句说明、类别，选中项的详情在底部；键盘焦点始终留在输入框里 */
export function CompletionPopup({
  listId,
  completion,
  active,
  target,
  playcountMissing,
  onPick,
  onActive,
}: {
  readonly listId: string;
  readonly completion: Completion;
  readonly active: number;
  readonly target: HTMLElement;
  /** foo_playcount 确认没装 */
  readonly playcountMissing: boolean;
  onPick(at: number): void;
  onActive(at: number): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const current = completion.items[active]?.entry;
  // 方向键换选中项时让它留在列表可见的那一段里
  useEffect(() => {
    document.getElementById(optionId(listId, active))?.scrollIntoView({ block: 'nearest' });
  }, [listId, active]);
  return (
    <Popover
      open
      trapFocus={false}
      positioning={{
        target,
        position: 'below',
        align: 'start',
        offset: { mainAxis: 4 },
        autoSize: 'height',
      }}
    >
      <PopoverSurface className={classes.list} data-syntax-completion>
        <div
          id={listId}
          className={styles['list']}
          role="listbox"
          aria-label={t('query.syntax.completions')}
          // 点列表不能抢走输入框的焦点和选区
          onMouseDown={(event) => event.preventDefault()}
        >
          {completion.items.map((item, at) => (
            <div
              key={`${item.entry.kind}:${item.entry.id}`}
              id={optionId(listId, at)}
              className={styles['row']}
              role="option"
              aria-selected={at === active}
              data-on={at === active || undefined}
              data-syntax-option={item.entry.id}
              onMouseMove={() => at !== active && onActive(at)}
              onClick={() => onPick(at)}
            >
              <span className={styles['name']}>{item.entry.name}</span>
              <DescriptionCell
                text={entryDescription(item.entry, t)}
                entry={item.entry}
                missing={playcountMissing}
              />
              <span className={styles['kind']}>{t(`query.syntax.kind.${item.entry.kind}`)}</span>
            </div>
          ))}
        </div>
        {current && <EntryDetail entry={current} missing={playcountMissing} />}
      </PopoverSurface>
    </Popover>
  );
}

const LEVEL_ICON = {
  error: <ErrorCircle16Regular />,
  warn: <Warning16Regular />,
  info: <Info16Regular />,
};

/** 说明行：浮在输入框下面，光标所在词的签名与一句说明，或最该提示的问题 */
export function HintBubble({
  hint,
  target,
}: {
  readonly hint: Hint;
  readonly target: HTMLElement;
}) {
  const classes = useStyles();
  return (
    <Popover
      open
      trapFocus={false}
      positioning={{ target, position: 'below', align: 'start', offset: { mainAxis: 4 } }}
    >
      <PopoverSurface className={classes.hint} data-syntax-hint={hint.level}>
        <div className={styles['hint']} data-level={hint.level} role="status">
          {LEVEL_ICON[hint.level]}
          {hint.signature && <code className={styles['signature']}>{hint.signature}</code>}
          <span className={styles['hintText']}>{hint.text}</span>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
