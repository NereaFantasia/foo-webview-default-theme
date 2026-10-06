import { ChevronDown16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FOLD_CLOSE, FOLD_OPEN } from '../motion/foldMotion.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { motionDuration } from '../motion/timing.ts';
import { ErrorAnnouncer, type SettingsCardIds } from './SettingsCard.tsx';
import styles from './SettingsExpander.module.css';
import { useSettingsLayout } from './useSettingsLayout.ts';

export interface SettingsExpanderProps {
  readonly icon: ReactElement;
  readonly title: string;
  /** 说明行，同设置卡：只写状态、禁用的原因或出错的原因。子行出错时写同一条错误，收起时也看得见。 */
  readonly description?: string;
  /** 说明行写的是出错的原因：换成错误色，读屏播报一次。 */
  readonly error?: boolean;
  /** 图标用强调色。 */
  readonly accent?: boolean;
  /** 附在说明下面的操作反馈。 */
  readonly feedback?: ReactNode;
  /** 卡头的主控件，无障碍名按两个 id 挂。有它时卡头不是按钮，开合经右端的箭头或点卡头空白处。 */
  readonly control?: (ids: SettingsCardIds) => ReactNode;
  /** 主控件要占宽度（下拉框）：卡窄时换到标题下面、占满一行。 */
  readonly field?: boolean;
  /** 箭头前面的预览，不能操作，读屏不念。 */
  readonly preview?: ReactNode;
  /** 起步是不是展开的，缺省展开。开合不记，每次进页面都回到这个值。 */
  readonly defaultOpen?: boolean;
  /** 展开区。没有（null 或 false）时没有箭头，这张卡就和设置卡一样。 */
  readonly children?: ReactNode;
}

const HIDDEN = 'translateY(-100%)';
const SHOWN = 'translateY(0)';

/**
 * 可展开卡：卡头与设置卡同版式，展开区在它下面。卡头没有控件时整条是开合的按钮；有控件时卡头是普通容器，
 * 控件照常操作，开合交给右端的箭头。没有展开区时不画箭头。
 *
 * 展开区从无到有（用户在卡头换了一档，多出了可调的项）时随即展开；进页面时照 `defaultOpen`。
 *
 * 动效照 Windows 11 的折叠卡：展开时布局当场到终值，展开区从卡头下面滑出来；收起时先滑回去，播完才把
 * 展开区卸掉。减弱动效时两头都当场到位。
 */
export function SettingsExpander({
  icon,
  title,
  description,
  error = false,
  accent = false,
  feedback,
  control,
  field = false,
  preview,
  defaultOpen = true,
  children,
}: SettingsExpanderProps) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const { compact } = useSettingsLayout();
  const expandable = children !== undefined && children !== null && children !== false;
  const [open, setOpen] = useState(defaultOpen);
  // 展开区在不在文档里。收起的动画播完才卸，所以比 `open` 晚一步变假。
  const [mounted, setMounted] = useState(defaultOpen);
  const panel = useRef<HTMLDivElement>(null);
  const played = useRef(defaultOpen);
  const wasExpandable = useRef(expandable);
  const head = useRef<HTMLDivElement>(null);
  const controlBox = useRef<HTMLDivElement>(null);
  const feedbackBox = useRef<HTMLDivElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const panelId = useId();
  const described = description || feedback ? descriptionId : undefined;

  useEffect(() => {
    if (expandable === wasExpandable.current) return;
    wasExpandable.current = expandable;
    if (expandable) {
      setMounted(true);
      setOpen(true);
    } else {
      // 展开区没了，下次再有时从收起的样子滑出来。
      played.current = false;
      setMounted(false);
      setOpen(false);
    }
  }, [expandable]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (played.current === open || !element) return;
    played.current = open;
    for (const running of element.getAnimations()) running.cancel();
    const spec = open ? FOLD_OPEN : FOLD_CLOSE;
    const animation = element.animate(
      { transform: open ? [HIDDEN, SHOWN] : [SHOWN, HIDDEN] },
      {
        duration: motionDuration(spec.duration, reduced),
        easing: spec.curve.timing,
        // 收起播完到卸掉之间还有一帧，停在滑回去的位置上，不闪回来。
        fill: open ? 'none' : 'forwards',
      },
    );
    if (open) return;
    // 被下一次开合打断时 `finished` 拒绝，展开区留着。
    void animation.finished.then(
      () => setMounted(false),
      () => {},
    );
  }, [open, reduced]);

  const toggle = () => {
    if (!open) setMounted(true);
    setOpen(!open);
  };

  const text = (
    <>
      <span id={titleId} className={styles.title}>
        {title}
      </span>
      {(description || feedback) && (
        <span id={descriptionId} className={styles.described}>
          {description && (
            <span
              className={error ? `${styles.description} ${styles.error}` : styles.description}
              aria-hidden={error || undefined}
            >
              {description}
            </span>
          )}
          {feedback && <span ref={feedbackBox}>{feedback}</span>}
        </span>
      )}
    </>
  );
  const chevron = (
    <ChevronDown16Regular
      className={open ? `${styles.chevron} ${styles.flipped}` : styles.chevron}
      aria-hidden
    />
  );
  const iconBox = (
    <span className={accent ? `${styles.icon} ${styles.accent}` : styles.icon} aria-hidden>
      {icon}
    </span>
  );
  const previewBox = preview && (
    <span className={styles.preview} aria-hidden>
      {preview}
    </span>
  );

  // 点卡头的空白处开合；点在控件、操作反馈或箭头上的不算，下拉列表经 Portal 冒上来的也不算。
  const clickHead = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!expandable || !(target instanceof Node) || !head.current?.contains(target)) return;
    for (const box of [controlBox, feedbackBox, toggleButton]) {
      if (box.current?.contains(target)) return;
    }
    toggle();
  };

  const header =
    control || feedback || !expandable ? (
      <div
        ref={head}
        className={[
          styles.head,
          expandable && styles.interactive,
          field && compact && styles.stacked,
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={clickHead}
      >
        {iconBox}
        <span className={styles.text}>{text}</span>
        {control && (
          <div ref={controlBox} className={styles.control}>
            {control({ labelId: titleId, descriptionId: described })}
          </div>
        )}
        {previewBox}
        {expandable && (
          <button
            ref={toggleButton}
            type="button"
            className={styles.toggle}
            data-settings-toggle
            aria-expanded={open}
            aria-controls={mounted ? panelId : undefined}
            aria-labelledby={titleId}
            aria-describedby={described}
            onClick={toggle}
          >
            {chevron}
          </button>
        )}
      </div>
    ) : (
      <button
        type="button"
        className={`${styles.head} ${styles.interactive}`}
        data-settings-toggle
        aria-expanded={open}
        aria-controls={mounted ? panelId : undefined}
        aria-labelledby={titleId}
        aria-describedby={described}
        onClick={toggle}
      >
        {iconBox}
        <span className={styles.text}>{text}</span>
        {previewBox}
        {chevron}
      </button>
    );

  return (
    <div className={styles.root} data-settings-expander>
      {header}
      <ErrorAnnouncer text={error ? description : undefined} />
      {expandable && mounted && (
        <div className={styles.clip}>
          <div
            ref={panel}
            id={panelId}
            className={styles.panel}
            role="region"
            aria-labelledby={titleId}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
