import { Button, makeStyles, mergeClasses, Portal, Tooltip } from '@fluentui/react-components';
import { Dismiss20Regular, PanelLeft16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { SidePanelHost } from '../../kit/SidePanel.tsx';
import { useService } from '../../kit/useService.ts';
import { SurfacePresence } from '../../motion/SurfacePresence.tsx';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { browserPanelKey, OUTSIDE_PANEL } from '../../nav/browserPanel.ts';
import type { CommandSpec } from '../../nav/commandRegistry.ts';
import { panelHistoryAtom } from '../../nav/navHistory.ts';
import { sidebarPrefsAtom, sidebarPrefsKey } from '../../nav/sidebar/sidebarPrefs.ts';
import { RAIL_WIDTH } from '../../nav/sidebar/sidebarSnap.ts';
import { sidebarViewAtom, type SidebarForm } from '../../nav/sidebar/sidebarView.ts';
import { CommandsContext } from '../../nav/useCommand.ts';
import { useLightDismiss } from '../../nav/useLightDismiss.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { CentralView } from '../CentralView.tsx';
import { NavButtons } from '../NavButtons.tsx';
import { Sidebar } from '../sidebar/Sidebar.tsx';
import { SidebarRail } from '../sidebar/SidebarRail.tsx';
import { SidebarSplitter } from '../sidebar/SidebarSplitter.tsx';
import { useSidebarMotion } from '../sidebar/useSidebarMotion.ts';
import styles from './BrowserPanel.module.css';

// 导航行的键与主窗标题栏的工具键同一规格：40 × 32 的圆角方形、图标 20。Fluent 缺省是 32 见方的圆键，
// 图标又被收成 16，放在 48 高的导航行里显得小
const useStyles = makeStyles({
  key: {
    minWidth: '40px',
    width: '40px',
    height: '32px',
    padding: '0',
    '& svg': { width: '20px', height: '20px' },
  },
});

/**
 * 点在这些元素上不算点了面板外部。入口键：否则按下时先收起面板，随后的单击又把面板打开。
 * 搜索下拉与应用的轻提示都经 Portal 挂在面板的组件树之外，点下拉里的建议、点提示上的「关闭」「重试」都不应收起面板
 */
const exemptCompanions = (target: Element) =>
  target.closest('[data-browse-key], [data-search-flyout], [data-app-toast]') !== null;

/**
 * 点击面板外部收起面板后，拦截随后的一次 click，使其不落到下层的场景元素上。
 * 例如边距里露出的歌词行，被点中会跳转播放进度。
 * 沉浸视图的控制层不拦截，点击其中的键与页签时，面板收起与按键本身的操作同时生效。
 * click 在 pointerup 之后派发，因此在 pointerup 之后的下一个任务移除拦截。
 * 指针被取消时同样要移除，否则会拦下之后无关的点击
 */
function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('[data-immersive-controls]'))
      return;
    event.stopPropagation();
    event.preventDefault();
  };
  const release = () => {
    window.removeEventListener('pointerup', release, true);
    window.removeEventListener('pointercancel', release, true);
    setTimeout(() => window.removeEventListener('click', swallow, true));
  };
  window.addEventListener('click', swallow, true);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
}

/**
 * 判断整个窗口里是否有打开的模态对话框。
 * 有些对话框由应用根部统一渲染（引导、自动播放列表编辑、更新说明、外链确认），不在面板的组件树里，点击其内部或外部的遮罩都会被当作点了面板外部。
 * 这类对话框打开期间，面板不因点击而收起，对话框自行处理的 Esc 也不会连带收起面板。
 * 面板自己的根元素不带 `aria-modal`，不会被算进去
 */
const hasModalDialog = () => document.querySelector('[aria-modal="true"]') !== null;

/**
 * 面板是主窗的第二个实例，却复用主窗的外壳件。其中按固定 id 登记命令的（侧栏播放列表的 F2、Alt+↑↓，分栏握柄的键盘调宽），
 * 会与主窗里被盖住的那一份互相顶替，面板收起后主窗那份就丢失了。
 * 因此面板里登记的命令统一加 `browser.` 前缀
 */
function PanelCommands({ children }: { readonly children: ReactNode }) {
  const commands = useContext(CommandsContext);
  const scoped = useMemo(
    () =>
      commands && {
        register: (spec: CommandSpec) => commands.register({ ...spec, id: `browser.${spec.id}` }),
        list: commands.list,
      },
    [commands],
  );
  return <CommandsContext value={scoped}>{children}</CommandsContext>;
}

/**
 * 面板内部：左边是侧边栏，右边是导航行加中央区域。
 *
 * 侧边栏的宽度与图标态沿用主窗同一份存档，并写回该存档。
 * 宽档（窗宽 ≥ 1008）里，拖动握柄或点导航行最左的键，都能在展开态与图标态之间切换。窗宽 641–1007 与主窗一样恒为图标态。
 * 存档里的「隐藏整栏」面板不予理会，否则面板里就没有导航
 */
function PanelBody() {
  const t = useAtomValueRawSync(translateAtom);
  const panel = useService(browserPanelKey);
  const sidebar = useService(sidebarPrefsKey);
  const { tier } = useAtomValueRawSync(sidebarViewAtom);
  const prefs = useAtomValueRawSync(sidebarPrefsAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const viewControls = useViewControlStyles();
  const classes = useStyles();
  const keyClass = mergeClasses(viewControls.icon, classes.key);
  const body = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const wide = tier === 'wide';
  const form: SidebarForm = wide && !prefs.rail ? 'expanded' : 'rail';
  const shown = useSidebarMotion({ pane, content, form, tier, width: prefs.width, reduced });
  const column = form === 'expanded' ? prefs.width : RAIL_WIDTH;
  // 页面窄到折成抽屉时，抽屉挂在这里，而不是主窗的内容区。退场时抽屉要滑过侧边栏那一列
  const hostStyle: CSSProperties & Record<`--${string}`, string> = {
    '--sidebar-column-width': `${column}px`,
  };
  return (
    <div
      ref={body}
      className={styles.body}
      style={{ gridTemplateColumns: `${column}px minmax(0, 1fr)` }}
    >
      <aside className={styles.sidebar}>
        <div
          ref={pane}
          className={styles.pane}
          data-sidebar-rail={shown === 'rail' || undefined}
          style={{ width: shown === 'expanded' ? prefs.width : RAIL_WIDTH }}
        >
          {shown === 'expanded' ? (
            <Sidebar omit={OUTSIDE_PANEL} />
          ) : (
            <SidebarRail omit={OUTSIDE_PANEL} />
          )}
        </div>
      </aside>
      <div ref={content} className={styles.main}>
        <div className={styles.nav}>
          {wide && (
            <Tooltip
              content={t(form === 'expanded' ? 'sidebar.collapse' : 'sidebar.expand')}
              relationship="label"
            >
              <Button
                appearance="subtle"
                shape="rounded"
                className={keyClass}
                icon={<PanelLeft16Regular />}
                aria-expanded={form === 'expanded'}
                data-browser-sidebar-key
                onClick={() => sidebar.toggleRail()}
              />
            </Tooltip>
          )}
          <NavButtons className={classes.key} round={false} />
          <span className={styles.grow} />
          <Tooltip content={t('immersive.browse.close')} relationship="label">
            <Button
              appearance="subtle"
              shape="rounded"
              className={keyClass}
              icon={<Dismiss20Regular />}
              data-browser-close
              onClick={() => panel.hide()}
            />
          </Tooltip>
        </div>
        <SidePanelHost compact={false} className={styles.cardHost} style={hostStyle}>
          <div className={styles.card}>
            <CentralView source={panelHistoryAtom} />
          </div>
        </SidePanelHost>
        {wide && (
          <div className={styles.splitterSlot}>
            <SidebarSplitter origin={body} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 沉浸视图里的浏览面板：居中的不透明迷你主窗，左边是侧边栏，右边是导航行加中央区域。
 *
 * 经 Portal 挂在主题根之下，与沉浸视图并列，因此不继承沉浸预设固定的深色。
 * 面板里的菜单、提示与对话框挂在面板之后，所以能盖在它上面。
 * 中央区域读取面板栈自己的状态。面板打开期间，页面与服务依据面板栈判断，所以在这里打开的页面与在主窗里一样工作。
 * 开关、起始页与离开时的落点由面板服务管理，这里只负责绘制、点击外部与 Esc 收起，以及打开时把焦点收进来。
 * 根元素带 `data-front-surface` 标记：面板里有搜索框时，搜索使用面板里的这一个，而不是被沉浸视图盖住的主窗里的那一个。
 * `solid` 为真时外框不使用亚克力。背景渲染器被帧率守门降级后，先放弃大面积的背景模糊
 */
export function BrowserPanel({ solid = false }: { readonly solid?: boolean }) {
  const t = useAtomValueRawSync(translateAtom);
  const panel = useService(browserPanelKey);
  const open = useAtomValueRawSync(panel.open);
  const root = useRef<HTMLDivElement>(null);
  const pressInside = useLightDismiss({
    id: 'browser.panel.dismiss',
    open,
    panel: root,
    // 面板里的搜索框与筛选框没有可处理的事时不认领 Esc，此时 Esc 应收起面板。否则光标在搜索框里时面板关不掉
    escapeFromInput: true,
    exempt: exemptCompanions,
    held: hasModalDialog,
    onDismiss: (escape) => {
      if (escape && hasModalDialog()) return;
      if (!escape) swallowNextClick();
      panel.hide();
    },
  });
  useEffect(() => {
    if (open) root.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <Portal>
      <SurfacePresence kind="dialog" visible={open} appear unmountOnExit>
        <div
          ref={root}
          className={styles.panel}
          role="dialog"
          aria-label={t('immersive.browse')}
          tabIndex={-1}
          data-browser-panel
          data-front-surface
          data-solid={solid || undefined}
          onPointerDownCapture={pressInside}
        >
          <PanelCommands>
            <PanelBody />
          </PanelCommands>
        </div>
      </SurfacePresence>
    </Portal>
  );
}
