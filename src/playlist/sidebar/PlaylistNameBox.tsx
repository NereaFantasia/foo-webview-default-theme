import { mergeClasses, Input, makeStyles } from '@fluentui/react-components';
import { useLayoutEffect, useRef, type ReactElement } from 'react';
import { TEXTBOX_KEYS } from '../../kit/textboxKeys.ts';
import styles from './PlaylistNameBox.module.css';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

export interface PlaylistNameBoxProps {
  /** 行首的状态图标。 */
  readonly icon: ReactElement;
  /** 框里一开始的名字，挂上时全选。 */
  readonly name: string;
  readonly label: string;
  /** 改名的那张的 GUID；新建的那一行还没有列表，给 null。按键命令按它分辨是改名还是新建。 */
  readonly guid: string | null;
  /** 名字已经交出去、等宿主建成：框还留着，但不能再改。 */
  readonly readOnly?: boolean;
  /** 失焦时交出框里的名字；回车与 Esc 由命令登记处接手。 */
  onBlur(name: string): void;
}

const useStyles = makeStyles({
  input: { flex: '1 1 auto', minWidth: 0 },
});

/** 双击的第二下最晚这么久之后到，毫秒：Windows 的缺省双击间隔。 */
const DOUBLE_CLICK_MS = 500;

/**
 * 播放列表节里输入名字的那一行，改名与新建共用：整行是一个输入框（导航项是按钮，里面不能放输入框），
 * 挂上就聚焦并全选。
 */
export function PlaylistNameBox(props: PlaylistNameBoxProps) {
  const viewControls = useViewControlStyles();
  const { icon, name, label, guid, readOnly = false, onBlur } = props;
  const classes = useStyles();
  const input = useRef<HTMLInputElement>(null);

  // 新建那一行开在节末，列表放不下时聚焦会把它滚进来，「新建」随之挪走，双击的第二下就落到别的行上、
  // 名字框失焦就按缺省名建了。所以新建时先不滚，等过双击间隔再滚进视口；改名的那一行本来就在视口里。
  const creating = guid === null;
  useLayoutEffect(() => {
    const box = input.current;
    box?.focus({ preventScroll: creating });
    box?.select();
    if (!creating) return;
    const timer = setTimeout(() => box?.scrollIntoView({ block: 'nearest' }), DOUBLE_CLICK_MS);
    return () => clearTimeout(timer);
  }, [creating]);

  return (
    <div className={styles.row}>
      <span className={styles.icon}>{icon}</span>
      <Input
        ref={input}
        className={mergeClasses(classes.input, viewControls.windowField)}
        size="small"
        defaultValue={name}
        readOnly={readOnly}
        aria-label={label}
        data-rename-input={guid ?? undefined}
        data-new-playlist-input={guid === null || undefined}
        {...TEXTBOX_KEYS}
        onBlur={(event) => onBlur(event.currentTarget.value)}
        onContextMenu={(event) => event.stopPropagation()}
      />
    </div>
  );
}
