import { createCustomFocusIndicatorStyle, makeStyles, tokens } from '@fluentui/react-components';
import { LIST_ROW_MOTION, LIST_ROW_SELECTED_MOTION } from '../motion/listRowMotion.ts';
import { COLUMN_IDS } from './columns/columns.ts';
import { roleVar } from '../theme/roles.ts';

/** 选中行的底：品牌色按比例混进透明，悬停时再深一档。 */
const SELECTED = `color-mix(in oklab, ${tokens.colorBrandStroke1} 18%, transparent)`;
const SELECTED_HOVER = `color-mix(in oklab, ${tokens.colorBrandStroke1} 24%, transparent)`;

/**
 * 换列时每一格按自己那一列的变量横移。CSS 拼不出 `var(--column-<列>-shift)` 这样的动态名字，只能逐列写。
 * 规则挂在表格根上、按 `data-column-id` 找格子：表格不会嵌在表格里，不会连带别的表。
 */
const COLUMN_SHIFTS = Object.fromEntries(
  COLUMN_IDS.map((id) => [
    `& [data-column-id="${id}"]`,
    { '--column-shift': `var(--column-${id}-shift, 0px)` },
  ]),
);

/**
 * 改 Fluent 表格各件（表格、列头、行、格子）的样式。表格自己的几层容器、格子与列头里的文字是自己的元素，
 * 样式在各自组件的 CSS Module 里。
 */
export const useTrackTableStyles = makeStyles({
  table: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: 'transparent',
    outlineStyle: 'none',
    // 拖动时顺带选中的文字会让下一次按下变成浏览器自己的拖放，列头的拖动换列就接不到后续的指针事件。
    userSelect: 'none',
    ...COLUMN_SHIFTS,
    '&[data-column-motion] [data-column-id]': {
      transform: 'translateX(var(--column-shift, 0px))',
      transitionProperty: 'transform',
      transitionDuration: 'var(--column-shift-duration)',
      transitionTimingFunction: 'var(--motion-curve-point-to-point)',
    },
    '&[data-column-motion="rebasing"] [data-column-id]': { transitionProperty: 'none' },
    // 用键盘时焦点所在的那一条描一圈：多选之后「选中的一批」与「焦点在哪」是两回事，只靠底色分不出来。
    // 按 Fluent 的键盘导航判定：先用鼠标点进表格、再按方向键，这一圈也会出来。
    ...createCustomFocusIndicatorStyle(
      {
        outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
        outlineOffset: `calc(${tokens.strokeWidthThick} * -1)`,
      },
      { selector: 'focus', customizeSelector: (selector) => `${selector} [data-row-focus]` },
    ),
  },
  // 行跟着页面滚：表格按内容高，不撑满父容器。
  pageScrollTable: { height: 'auto' },
  // 列头不跟着行滚，但与行的滚动区一样留出滚动条的槽，两边的栅格才一样宽。
  header: {
    flex: 'none',
    overflow: 'hidden',
    scrollbarGutter: 'stable',
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  // 行跟着页面滚时列头吸在滚动元素顶上；行区不再有自己的滚动条，列头也不留槽。
  stickyHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    scrollbarGutter: 'auto',
  },
  body: { position: 'relative' },
  headerRow: {
    display: 'grid',
    gridTemplateColumns: 'var(--table-header-frozen, var(--table-header-template))',
    alignItems: 'stretch',
    minHeight: '32px',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  headerCell: { minWidth: 0 },
  headerDragging: { opacity: 0.35, cursor: 'grabbing' },
  numericHeader: { justifyContent: 'flex-end', textAlign: 'end' },
  handle: {
    '&[data-dragging]': {
      opacity: 1,
      '::after': { backgroundColor: tokens.colorBrandStroke1 },
    },
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'var(--table-row-frozen, var(--table-row-template))',
    position: 'absolute',
    top: 0,
    left: 'var(--table-row-left, 0px)',
    width: 'calc(100% - var(--table-row-left, 0px))',
    height: 'var(--table-row-height)',
    boxSizing: 'border-box',
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'default',
    fontSize: tokens.fontSizeBase200,
    ...LIST_ROW_MOTION,
    '@media (forced-colors: none)': {
      backgroundColor: 'transparent',
      ':hover': { backgroundColor: roleVar('state-hover') },
      ':active': { backgroundColor: roleVar('state-pressed') },
    },
  },
  selected: {
    ...LIST_ROW_SELECTED_MOTION,
    '@media (forced-colors: none)': {
      backgroundColor: SELECTED,
      ':hover': { backgroundColor: SELECTED_HOVER },
      ':active': { backgroundColor: SELECTED_HOVER },
    },
    '@media (forced-colors: active)': {
      outline: `${tokens.strokeWidthThin} solid Highlight`,
      outlineOffset: `calc(-3 * ${tokens.strokeWidthThin})`,
    },
  },
  cell: { minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden' },
  numeric: {
    justifyContent: 'flex-end',
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
  },
  // 正在播放的那一行整行文字取品牌色，悬停、按下时也不变；各格自己的次要色在这一行让位。
  playing: {
    color: tokens.colorBrandForeground1,
    ':hover': { color: tokens.colorBrandForeground1 },
    ':active': { color: tokens.colorBrandForeground1 },
    '& [data-column-id]': { color: 'inherit' },
    '& [data-column-id] > span, & [data-column-id] > button': { color: 'inherit' },
  },
  skeleton: { width: '70%' },
});
