import {
  useEventCallback,
  useMergedRefs,
  type PresenceComponentProps,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import {
  cloneElement,
  isValidElement,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  createSurfaceTransition,
  type SurfaceKind,
  type SurfaceTransition,
} from './surfaceTransition.ts';
import { reducedMotionAtom } from './reducedMotion.ts';

interface SurfacePresenceProps extends PresenceComponentProps {
  readonly kind: SurfaceKind;
}

const NO_MOTION_CALLBACK: NonNullable<PresenceComponentProps['onMotionStart']> = () => {};

/** 保留退场节点直到动画结束，关闭当帧移出指针、键盘和读屏的可访问范围。 */
export function SurfacePresence({
  children,
  kind,
  visible = false,
  appear = false,
  unmountOnExit = false,
  imperativeRef,
  onMotionStart,
  onMotionFinish,
  onMotionCancel,
}: SurfacePresenceProps) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [present, setPresent] = useState(visible || !unmountOnExit);
  if (visible && !present) setPresent(true);
  const element = useRef<HTMLElement>(null);
  const transition = useRef<SurfaceTransition | null>(null);
  const initialized = useRef(false);
  const initialVisibility = useRef(visible);
  const toggled = useRef(false);
  const previous = useRef(visible);
  const busy = useRef(false);
  const generation = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const inlineStyles = useRef({ pointers: '', visibility: '' });
  const emitStart = useEventCallback(onMotionStart ?? NO_MOTION_CALLBACK);
  const emitFinish = useEventCallback(onMotionFinish ?? NO_MOTION_CALLBACK);
  const emitCancel = useEventCallback(onMotionCancel ?? NO_MOTION_CALLBACK);
  const cancelPending = useEventCallback(() => {
    if (!busy.current) return;
    busy.current = false;
    emitCancel(null, { direction: previous.current ? 'enter' : 'exit' });
  });
  const child = isValidElement<{ ref?: Ref<HTMLElement> }>(children) ? children : null;
  const ref = useMergedRefs(element, child?.props.ref);

  useImperativeHandle(
    imperativeRef,
    () => ({
      setPlaybackRate: (rate) => transition.current?.setPlaybackRate(rate),
      setPlayState: (state) => transition.current?.setPlayState(state),
    }),
    [],
  );

  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const wasInert = node.inert;
    const hidden = node.getAttribute('aria-hidden');
    const pointers = node.style.pointerEvents;
    const visibility = node.style.visibility;
    inlineStyles.current = { pointers, visibility };
    const motion = createSurfaceTransition(node, kind);
    const lifetime = generation;
    transition.current = motion;
    initialized.current = false;
    return () => {
      lifetime.current++;
      motion.dispose();
      cancelPending();
      transition.current = null;
      node.inert = wasInert;
      if (hidden === null) node.removeAttribute('aria-hidden');
      else node.setAttribute('aria-hidden', hidden);
      node.style.pointerEvents = pointers;
      node.style.visibility = visibility;
    };
  }, [cancelPending, kind, present]);

  useLayoutEffect(() => {
    if (visible !== initialVisibility.current) toggled.current = true;
    const node = element.current;
    const motion = transition.current;
    if (!node || !motion) return;
    const direction = visible ? 'enter' : 'exit';
    const first = !initialized.current;
    if (!first && visible === previous.current && !busy.current) return;
    cancelPending();
    const doc = node.ownerDocument;
    if (visible) {
      if (first || !previous.current) {
        const active = doc.activeElement;
        if (active instanceof HTMLElement && active !== doc.body && !node.contains(active)) {
          opener.current = active;
        }
      }
      node.inert = false;
      node.removeAttribute('aria-hidden');
      node.style.pointerEvents = inlineStyles.current.pointers;
      node.style.visibility = inlineStyles.current.visibility;
    } else {
      // 新浮层已接走焦点时不再还焦点；旧浮层最终卸载也不另安排还焦点的回调。
      if (node.contains(doc.activeElement)) {
        const target = opener.current;
        if (target?.isConnected && !target.closest('[inert]'))
          target.focus({ preventScroll: true });
        if (node.contains(doc.activeElement) && doc.activeElement instanceof HTMLElement) {
          doc.activeElement.blur();
        }
      }
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
      node.style.pointerEvents = 'none';
    }
    initialized.current = true;
    previous.current = visible;
    busy.current = false;
    const mine = ++generation.current;
    // appear 只管整个组件的首次显示，关闭后重新挂载的节点仍要播放入场。
    if (first && (!visible || (!appear && !toggled.current))) {
      motion.jump(visible);
      if (!visible) node.style.visibility = 'hidden';
      return;
    }
    busy.current = true;
    emitStart(null, { direction });
    const skip =
      reduced || (doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false);
    void motion.play(visible, skip).then((finished) => {
      if (!finished || mine !== generation.current) return;
      busy.current = false;
      if (!visible) {
        node.style.visibility = 'hidden';
        if (unmountOnExit) setPresent(false);
      }
      emitFinish(null, { direction });
    });
  }, [
    appear,
    cancelPending,
    emitFinish,
    emitStart,
    kind,
    present,
    reduced,
    unmountOnExit,
    visible,
  ]);

  if (!child) throw new Error('浮层动效需要一个能接收 ref 的子元素');
  return present ? cloneElement(child, { ref }) : null;
}
