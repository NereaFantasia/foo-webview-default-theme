import { Button, Popover, PopoverTrigger, Tooltip, mergeClasses } from '@fluentui/react-components';
import {
  ChevronLeft20Regular,
  CommentText20Regular,
  MoreHorizontal20Regular,
  Search20Regular,
  Settings20Regular,
  TextFontSize20Regular,
  Timer20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useElementWidth } from '../../kit/useElementWidth.ts';
import { usePresence } from '../../kit/usePresence.ts';
import { useService } from '../../kit/useService.ts';
import { lyricsKey } from '../../lyrics/lyricsService.ts';
import { lyricsSettingsKey } from '../../lyrics/lyricsSettings.ts';
import { FLYOUT_MOTION } from '../../motion/Surfaces.tsx';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { DURATION_MS, motionDuration } from '../../motion/timing.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { PanelBackgroundContext, PopoverSurface } from '../../theme/PopoverSurface.tsx';
import { useBarSurface } from '../scene/acrylic.ts';
import { lyricsSearchOpenAtom, setLyricsSearchOpen } from '../scene/lyricsSearch.ts';
import { toolbarCollapsedPref } from '../scene/scenePrefs.ts';
import {
  AlignControl,
  DisplayToggle,
  FontSizeControl,
  TimingControl,
} from './LyricsToolbarControls.tsx';
import { LyricsToolbarSearch } from './LyricsToolbarSearch.tsx';
import { toolbarFormOf, toolbarSubjectsOf } from './lyricsToolbar.ts';
import styles from './LyricsToolbar.module.css';
import { usePanelSurface, useToolsStyles } from './toolsStyles.ts';

type PanelName = 'font' | 'timing' | 'more';

/** 折叠收起状态下的图标展示：与右侧卡歌词页图标保持一致 */
const CollapsedIcon = CommentText20Regular;

/** 工具栏按钮分组配置 */
interface Group {
  readonly node: ReactNode;
  readonly className?: string;
}

/**
 * 弹出式子面板按钮：面板内展示对应控件的垂直排列形态
 *
 * 主题层把整窗算好的面板实底色经上下文交给浮层，浮层会写成行内变量，覆盖这里的 Acrylic 着色，因此这块面板不取该色
 */
function PanelKey({
  name,
  current,
  label,
  icon,
  available,
  onChange,
  children,
}: {
  readonly name: PanelName;
  readonly current: PanelName | null;
  readonly label: string;
  readonly icon: ReactElement;
  /** 是否有可用操作对象：不可用时按钮置灰禁用，保持悬浮提示响应 */
  readonly available: boolean;
  onChange(panel: PanelName | null): void;
  readonly children: ReactNode;
}) {
  const classes = useToolsStyles();
  const controls = useViewControlStyles();
  const surface = usePanelSurface();
  return (
    <PanelBackgroundContext value={undefined}>
      <Popover
        open={current === name}
        onOpenChange={(_, data) => onChange(data.open ? name : null)}
        positioning={{ position: 'below', align: 'start', autoSize: 'height' }}
        trapFocus
        surfaceMotion={FLYOUT_MOTION}
      >
        <PopoverTrigger disableButtonEnhancement>
          <Tooltip content={label} relationship="label">
            <Button
              appearance="subtle"
              shape="rounded"
              className={mergeClasses(classes.key, controls.icon)}
              icon={icon}
              disabledFocusable={!available}
              data-lyrics-tool={name}
            />
          </Tooltip>
        </PopoverTrigger>
        <PopoverSurface className={mergeClasses(classes.panel, surface)} aria-label={label}>
          <div className={styles.stack}>{children}</div>
        </PopoverSurface>
      </Popover>
    </PanelBackgroundContext>
  );
}

/** 排布按钮分组并渲染分割线 */
function joinGroups(groups: readonly Group[]): ReactNode {
  return groups.map((group, index) => (
    <Fragment key={index}>
      {index > 0 && <span className={styles.sep} aria-hidden />}
      <div className={mergeClasses(styles.group, group.className)}>{group.node}</div>
    </Fragment>
  ));
}

/**
 * 歌词元素顶部工具栏：集成搜索、译文与音译开关、文字对齐、字号与时间轴校正、折叠收起及歌词设置
 *
 * 宽度与水平位置对齐歌词排版区域，按可用宽度排布为宽档（双行磁贴）、中档（图标按键加小面板）
 * 或窄档（折叠更多面板）。无可用操作对象时保持控件占位并禁用，避免界面跳变
 *
 * 外壳尺寸随状态平滑过渡，内部包含三层交叉淡变（常规按键层、折叠收起层与搜索输入层），
 * 搜索展开时 Esc 优先收起搜索面板。键盘焦点位于工具栏内部或下拉面板开启期间，工具栏保持常驻
 */
export function LyricsToolbar({ active }: { readonly active: boolean }) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useToolsStyles();
  const controls = useViewControlStyles();
  const barSurface = useBarSurface();
  const store = useStore();
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const state = useAtomValueRawSync(useService(lyricsKey).state);
  const settings = useService(lyricsSettingsKey);
  const collapsedPref = useAtomValueRawSync(toolbarCollapsedPref.atom);
  const subjects = useMemo(
    () => toolbarSubjectsOf(state.status === 'ready' ? state.content : null),
    [state],
  );
  const [width, setWidth] = useState(0);
  const measure = useElementWidth<HTMLDivElement>(setWidth);
  const form = width > 0 ? toolbarFormOf(width) : null;
  const searching = useAtomValueRawSync(lyricsSearchOpenAtom);
  const setSearching = (open: boolean) => setLyricsSearchOpen(store, open);
  // 预留退场过渡时长以完整播放搜索层淡出动效；开启当帧即刻就绪
  const searchPresent = usePresence(searching, motionDuration(DURATION_MS.fast, reduced)).mounted;
  const [resultsHost, setResultsHost] = useState<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<PanelName | null>(null);
  const searchKey = useRef<HTMLButtonElement>(null);
  const collapseKey = useRef<HTMLButtonElement>(null);
  const miniKey = useRef<HTMLButtonElement>(null);
  const refocus = useRef<'search' | 'collapse' | 'mini' | null>(null);
  // 工具栏卸载时同步重置搜索状态；搜索开启期间侧栏不触发因无歌词导致的自动居中
  useLayoutEffect(() => () => setLyricsSearchOpen(store, false), [store]);
  const collapsed = collapsedPref && !searching;
  const mode = searching ? 'searching' : collapsed ? 'collapsed' : 'open';
  // 操作对象缺失、排布切换或工具栏折叠时自动收起面板
  const reachable: Record<PanelName, boolean> = {
    font: form === 'medium' && subjects.font,
    timing: form === 'medium' && subjects.timing,
    more: form === 'narrow',
  };
  const openPanel = mode === 'open' && panel !== null && reachable[panel] ? panel : null;
  // 控件被置为 inert 时将焦点平滑流转至接替控件
  useLayoutEffect(() => {
    const target = refocus.current;
    if (!target) return;
    if (target === 'search' && !searching) searchKey.current?.focus();
    else if (target === 'collapse' && !collapsed) collapseKey.current?.focus();
    else if (target === 'mini' && collapsed) miniKey.current?.focus();
    else return;
    refocus.current = null;
  }, [searching, collapsed]);
  const closeSearch = () => {
    refocus.current = 'search';
    setSearching(false);
  };
  const setCollapsed = (next: boolean) => {
    refocus.current = next ? 'mini' : 'collapse';
    toolbarCollapsedPref.set(store, next);
  };
  const wide = form === 'wide';
  const key = mergeClasses(classes.key, controls.icon);
  // 宽档排布下使用整高图标按钮，文本说明由悬浮提示提供
  const actionKey = wide ? mergeClasses(key, classes.tall) : key;
  const groups: Group[] = [
    {
      node: (
        <Tooltip content={t('lyrics.search')} relationship="label">
          <Button
            ref={searchKey}
            appearance="subtle"
            shape="rounded"
            className={actionKey}
            icon={<Search20Regular />}
            data-lyrics-tool="search"
            onClick={() => setSearching(true)}
          />
        </Tooltip>
      ),
    },
  ];
  // 无可用对象时保持禁用占位以稳定排布；窄档仅保留译文切换，音译收纳至更多面板
  const toggleLayout = wide ? 'tall' : 'icon';
  groups.push({
    className: wide ? styles.toggles : undefined,
    node: [
      <DisplayToggle
        key="t"
        field="showTranslation"
        layout={toggleLayout}
        available={subjects.translation}
      />,
      form !== 'narrow' && (
        <DisplayToggle
          key="r"
          field="showRomanization"
          layout={toggleLayout}
          available={subjects.romanization}
        />
      ),
      form !== 'narrow' && (
        <AlignControl key="a" layout={toggleLayout} available={subjects.align} />
      ),
    ],
  });
  if (wide) {
    groups.push({
      className: styles.tileGroup,
      node: <FontSizeControl layout="tile" available={subjects.font} />,
    });
    groups.push({ node: <TimingControl layout="tile" available={subjects.timing} /> });
  } else if (form === 'medium') {
    groups.push({
      node: (
        <>
          <PanelKey
            name="font"
            current={openPanel}
            label={t('lyrics.fontSize')}
            icon={<TextFontSize20Regular />}
            available={subjects.font}
            onChange={setPanel}
          >
            <FontSizeControl layout="panel" available={subjects.font} />
          </PanelKey>
          <PanelKey
            name="timing"
            current={openPanel}
            label={t('lyrics.timing')}
            icon={<Timer20Regular />}
            available={subjects.timing}
            onChange={setPanel}
          >
            <TimingControl layout="panel" available={subjects.timing} />
          </PanelKey>
        </>
      ),
    });
  }
  const more =
    form === 'narrow' ? (
      <PanelKey
        name="more"
        current={openPanel}
        label={t('lyrics.more')}
        icon={<MoreHorizontal20Regular />}
        available
        onChange={setPanel}
      >
        <FontSizeControl layout="panel" available={subjects.font} />
        <TimingControl layout="panel" available={subjects.timing} />
        <DisplayToggle field="showRomanization" layout="panel" available={subjects.romanization} />
        <DisplayToggle field="showTranslation" layout="panel" available={subjects.translation} />
        <AlignControl layout="panel" available={subjects.align} />
      </PanelKey>
    ) : null;
  return (
    <div
      ref={measure}
      className={styles.toolbar}
      style={{ '--toolbar-width': `${width}px` } as CSSProperties}
      role="group"
      aria-label={t('lyrics.tools')}
      data-lyrics-toolbar
      data-pending={form === null || undefined}
      data-collapsed={mode === 'collapsed' || undefined}
      data-open={openPanel !== null || searching || undefined}
      onKeyDown={(event) => {
        // 搜索展开时 Esc 优先收起搜索面板并阻止冒泡，避免误退沉浸视图
        if (event.key !== 'Escape' || event.defaultPrevented || !searching) return;
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        event.preventDefault();
        closeSearch();
      }}
    >
      <div
        className={mergeClasses(styles.bar, barSurface)}
        data-state={mode}
        data-form={form ?? undefined}
      >
        <div
          className={styles.layer}
          data-hidden={mode !== 'open' || undefined}
          inert={mode !== 'open'}
        >
          <div key={form ?? 'pending'} className={styles.keys}>
            {joinGroups(groups)}
            <span className={styles.fill} />
            <div className={styles.group}>
              {more}
              <Tooltip content={t('lyrics.collapseTools')} relationship="label">
                <Button
                  ref={collapseKey}
                  appearance="subtle"
                  shape="rounded"
                  className={actionKey}
                  icon={<ChevronLeft20Regular />}
                  data-lyrics-tool="collapse"
                  onClick={() => setCollapsed(true)}
                />
              </Tooltip>
              <Tooltip content={t('lyrics.settings')} relationship="label">
                <Button
                  appearance="subtle"
                  shape="rounded"
                  className={actionKey}
                  icon={<Settings20Regular />}
                  data-lyrics-tool="settings"
                  onClick={settings.open}
                />
              </Tooltip>
            </div>
          </div>
        </div>
        <div
          className={mergeClasses(styles.layer, styles.layerMini)}
          data-hidden={mode !== 'collapsed' || undefined}
          inert={mode !== 'collapsed'}
        >
          <Tooltip content={t('lyrics.expandTools')} relationship="label">
            <Button
              ref={miniKey}
              appearance="subtle"
              shape="rounded"
              className={mergeClasses(classes.mini, controls.icon)}
              icon={<CollapsedIcon />}
              aria-expanded={false}
              data-lyrics-tool="expand"
              onClick={() => setCollapsed(false)}
            />
          </Tooltip>
        </div>
        {searchPresent && (
          <div className={styles.layer} data-hidden={!searching || undefined} inert={!searching}>
            <LyricsToolbarSearch
              active={active}
              leaving={!searching}
              resultsHost={resultsHost}
              onClose={closeSearch}
            />
          </div>
        )}
      </div>
      <div ref={setResultsHost} className={styles.resultsHost} />
    </div>
  );
}
