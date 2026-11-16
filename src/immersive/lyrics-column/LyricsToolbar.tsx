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

/** 工具条收起后显示的图标，与右侧卡歌词页的图标相同 */
const CollapsedIcon = CommentText20Regular;

/** 工具条上的一组按钮，组与组之间有分隔线 */
interface Group {
  readonly node: ReactNode;
  readonly className?: string;
}

/**
 * 打开子面板的按钮，面板里是对应控件的竖排形态
 *
 * 主题层经上下文把整窗计算好的面板实底色交给浮层，浮层会把它写成行内变量，覆盖这里的 Acrylic 着色。
 * 因此这块面板把上下文置空，不使用该颜色
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
  /** 当前歌词是否支持面板里的操作。为假时按钮禁用，但仍可获得焦点并显示悬浮提示 */
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

/** 依次排出各组按钮，组与组之间加分隔线 */
function joinGroups(groups: readonly Group[]): ReactNode {
  return groups.map((group, index) => (
    <Fragment key={index}>
      {index > 0 && <span className={styles.sep} aria-hidden />}
      <div className={mergeClasses(styles.group, group.className)}>{group.node}</div>
    </Fragment>
  ));
}

/**
 * 歌词栏顶部的工具条：搜索、译文与音译开关、文字对齐、缩放、时间校正、收起与歌词设置
 *
 * 工具条的宽度与位置对齐歌词排版区，按可用宽度分为三档（`toolbarFormOf`）：宽档是双行磁贴，
 * 中档是图标键加小面板，窄档把多数控件收进「更多」面板。
 * 当前歌词不支持的控件保持占位并禁用，排布不随曲目变化。
 *
 * 常规按键、收起后的图标与搜索框分为三层，切换时交叉淡变，外框尺寸随之过渡。
 * 搜索展开时 Esc 先收起搜索。焦点在工具条内或面板打开时，工具条保持显示
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
  // 搜索关闭后保留挂载一段过渡时长，使搜索层的淡出完整播放。打开时当帧挂载
  const searchPresent = usePresence(searching, motionDuration(DURATION_MS.fast, reduced)).mounted;
  const [resultsHost, setResultsHost] = useState<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<PanelName | null>(null);
  const searchKey = useRef<HTMLButtonElement>(null);
  const collapseKey = useRef<HTMLButtonElement>(null);
  const miniKey = useRef<HTMLButtonElement>(null);
  const refocus = useRef<'search' | 'collapse' | 'mini' | null>(null);
  // 工具条卸载时关闭搜索。搜索开着期间，侧栏不会因没有歌词而自动居中
  useLayoutEffect(() => () => setLyricsSearchOpen(store, false), [store]);
  const collapsed = collapsedPref && !searching;
  const mode = searching ? 'searching' : collapsed ? 'collapsed' : 'open';
  // 当前歌词不支持面板的操作、排布换档或工具条收起时，面板关闭
  const reachable: Record<PanelName, boolean> = {
    font: form === 'medium' && subjects.font,
    timing: form === 'medium' && subjects.timing,
    more: form === 'narrow',
  };
  const openPanel = mode === 'open' && panel !== null && reachable[panel] ? panel : null;
  // 焦点所在的控件变为 inert 时，把焦点移到接替它的控件
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
  // 宽档使用整高的图标按钮，名称由悬浮提示显示
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
  // 窄档的条上只保留译文开关，音译开关与对齐收进「更多」面板
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
            label={t('lyrics.zoom')}
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
        // 搜索展开时 Esc 先收起搜索，并标记事件已处理（preventDefault），沉浸视图因此不会同时退出
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
