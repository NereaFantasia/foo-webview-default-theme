import {
  AccordionHeader as FluentAccordionHeader,
  AccordionPanel as FluentAccordionPanel,
  makeStyles,
  mergeClasses,
  useAccordionItemContext_unstable,
  useFluent,
  useMergedRefs,
  type AccordionPanelProps,
  type PresenceComponentProps,
} from '@fluentui/react-components';
import { ChevronRight16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import {
  cloneElement,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
  type ReactNode,
} from 'react';
import { createFlowFold, followersOf, partsOf } from './flowFold.ts';
import { reducedMotionAtom } from './reducedMotion.ts';
import { CURVE, durationVar } from './timing.ts';
import styles from './FlowAccordion.module.css';

const useStyles = makeStyles({
  panel: { boxSizing: 'border-box' },
  chevron: {
    transitionProperty: 'transform',
    transitionDuration: durationVar('fast'),
    transitionTimingFunction: CURVE.decelerateMid.css,
  },
});

/** Fluent 保留标题与按键语义，箭头与内容使用同一组开合状态。 */
export function AccordionHeader(props: ComponentProps<typeof FluentAccordionHeader>) {
  const { open } = useAccordionItemContext_unstable();
  const { dir } = useFluent();
  const classes = useStyles();
  const rotation =
    props.expandIconPosition === 'end' ? (open ? -90 : 90) : open ? 90 : dir === 'rtl' ? 180 : 0;
  return (
    <FluentAccordionHeader
      expandIcon={
        <ChevronRight16Regular
          className={classes.chevron}
          style={{ transform: `rotate(${rotation}deg)` }}
        />
      }
      {...props}
    />
  );
}

function FlowPanelMotion({ children, visible = false }: PresenceComponentProps) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const body = useRef<HTMLElement>(null);
  const [present, setPresent] = useState(visible);
  if (visible && !present) setPresent(true);
  const child = isValidElement<{
    ref?: Ref<HTMLElement>;
    inert?: boolean;
    'aria-hidden'?: boolean;
    children?: ReactNode;
  }>(children)
    ? children
    : null;
  const ref = useMergedRefs(body, child?.props.ref);
  const [fold] = useState(() =>
    createFlowFold({
      open: visible,
      body: () => body.current,
      followers: followersOf,
      parts: partsOf,
      onClosed: () => setPresent(false),
    }),
  );
  useLayoutEffect(() => {
    const node = body.current;
    if (!visible && node?.contains(node.ownerDocument.activeElement)) {
      node.parentElement
        ?.querySelector<HTMLButtonElement>('.fui-AccordionHeader button')
        ?.focus({ preventScroll: true });
    }
    fold.set(visible, reduced);
    if (node) node.inert = !visible;
  }, [fold, reduced, visible]);
  useLayoutEffect(() => () => fold.dispose(), [fold]);
  if (!child) throw new Error('折叠内容需要一个能接收 ref 的子元素');
  return present
    ? cloneElement(child, {
        ref,
        inert: false,
        'aria-hidden': !visible,
        children: <div className={styles.content}>{child.props.children}</div>,
      })
    : null;
}

const FLOW_PANEL_MOTION: AccordionPanelProps['collapseMotion'] = {
  children: (_, props) => <FlowPanelMotion {...props} />,
};

/** 内容滑回标题下方，退场完成才卸载；调用方不再按 open 提前移除子内容。 */
export function AccordionPanel({
  className,
  ...props
}: ComponentProps<typeof FluentAccordionPanel>) {
  const classes = useStyles();
  return (
    <FluentAccordionPanel
      collapseMotion={FLOW_PANEL_MOTION}
      {...props}
      className={mergeClasses(classes.panel, className)}
    />
  );
}
