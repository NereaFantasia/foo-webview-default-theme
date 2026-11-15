import {
  makeStyles,
  mergeClasses,
  Option,
  tokens,
  type ComboboxProps,
} from '@fluentui/react-components';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fontNameOf, quoteFont } from '../theme/fontStack.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { ScrollCombobox } from './ScrollCombobox.tsx';
import { useStableCallback } from './useStableCallback.ts';
import { canvasMeasure, COMMON_FONTS, fontInstalled, loadSystemFonts } from './systemFonts.ts';

export interface FontPickerProps {
  /** 家族名；空串是默认 */
  readonly value: string;
  /** 第一项与没选时的占位 */
  readonly defaultLabel: string;
  readonly disabled?: boolean;
  /** 卡窄时占满一行 */
  readonly fill?: boolean;
  readonly labelId?: string;
  readonly descriptionId?: string;
  /** 选中一项，或输完字体名回车、离开输入框时给出；不合格的字体名按默认给 */
  onChange(value: string): void;
}

const useStyles = makeStyles({
  root: { minWidth: 0, width: '220px' },
  fill: { width: '100%' },
  // 名字在上、样字在下，同设置下拉里「选项名加说明」的写法：一行里放两样，窄了总有一样被裁
  option: { display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0 },
  name: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sample: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
});

// 列表最多约五项高，只往下展开：往上会顶进标题栏的拖拽区，点不到
const LIST_MAX_HEIGHT = 288;
// 输入框下面剩余的空间不够时列表收缩，下限留够三项
const LIST_MIN_HEIGHT = 144;
const LIST_EDGE = 12;
// 不让 Fluent 按可用空间自己改最大高度：它会写到元素上，盖掉下面按输入框位置算的上限
const POSITIONING = { position: 'below', align: 'start', autoSize: false } as const;

/**
 * 字体选择器：可以直接输入字体名，也可以从下拉里选。下拉第一项是「默认」，其余每项上面是字体名，
 * 下面一行用这个字体写西文、汉字与假名的样字；输入时按字体名过滤。名字不用自己的字体写：符号字体
 * （如 Bookshelf Symbol）会把名字写成一串符号，看不出是哪个字体
 *
 * 本机字体列表在第一次点开时取（需要用户手势），取不到时只列常用字体里本机装了的
 */
export function FontPicker({
  value,
  defaultLabel,
  disabled = false,
  fill = false,
  labelId,
  descriptionId,
  onChange,
}: FontPickerProps) {
  const classes = useStyles();
  const controls = useViewControlStyles();
  const [typed, setTyped] = useState<string | null>(null);
  const [fonts, setFonts] = useState<readonly string[] | null>(null);
  const [opened, setOpened] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [listHeight, setListHeight] = useState(LIST_MAX_HEIGHT);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const suggestions = useMemo(() => {
    if (!opened) return [];
    const measure = canvasMeasure();
    return COMMON_FONTS.filter((name) => fontInstalled(name, measure));
  }, [opened]);
  const query = (typed ?? '').trim().toLowerCase();
  const names = (fonts ?? suggestions).filter(
    (name) => !query || name.toLowerCase().includes(query),
  );

  // 输入过程中的文字另存一份引用：回车与失焦的处理要读到最新的，不能等重渲染
  const pending = useRef<string | null>(null);
  function setPending(next: string | null): void {
    pending.current = next;
    setTyped(next);
  }

  function commit(text: string): void {
    setPending(null);
    const name = text.trim() === defaultLabel ? '' : fontNameOf(text);
    if (name !== value) onChange(name);
  }

  // Fluent 每次输入都以没有选项（optionValue 为 undefined）报一次，表示清掉了已选项，不是用户做了选择
  const select = useStableCallback<Parameters<NonNullable<ComboboxProps['onOptionSelect']>>, void>(
    (_event, data) => {
      if (data.optionValue !== undefined) commit(data.optionValue);
    },
  );
  const leave = useStableCallback(() => {
    if (pending.current !== null) commit(pending.current);
  });
  const enter = useStableCallback((event: KeyboardEvent<HTMLInputElement>) => {
    // 回车选中下拉里高亮的一项时选中事件先到、已提交；等它处理完还有没提交的输入再提交
    if (event.key === 'Enter') queueMicrotask(() => leave());
  });

  return (
    <ScrollCombobox
      className={mergeClasses(classes.root, fill && classes.fill, controls.field)}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      disabled={disabled}
      freeform
      value={typed ?? value}
      placeholder={defaultLabel}
      selectedOptions={[value]}
      positioning={POSITIONING}
      listboxMaxHeight={listHeight}
      inputRef={input}
      onOpenChange={(_, data) => {
        if (!data.open) return;
        const rect = input.current?.getBoundingClientRect();
        if (rect)
          setListHeight(
            Math.max(
              LIST_MIN_HEIGHT,
              Math.min(LIST_MAX_HEIGHT, window.innerHeight - rect.bottom - LIST_EDGE),
            ),
          );
        setOpened(true);
        // 点开的这一下是用户手势，本机字体列表的请求要在这里发
        void loadSystemFonts().then((list) => {
          if (list && alive.current) setFonts(list);
        });
      }}
      onChange={(event) => setPending(event.target.value)}
      onOptionSelect={select}
      onBlur={leave}
      onKeyDown={enter}
    >
      <Option value="" text={defaultLabel}>
        {defaultLabel}
      </Option>
      {names.map((name) => (
        <Option key={name} value={name} text={name}>
          <span className={classes.option}>
            <span className={classes.name} title={name}>
              {name}
            </span>
            <span
              className={classes.sample}
              style={{ fontFamily: `${quoteFont(name)}, sans-serif` }}
            >
              Aa 永 あ
            </span>
          </span>
        </Option>
      ))}
    </ScrollCombobox>
  );
}
