import { useAtomValueRawSync } from 'jotai/react';
import { useRef } from 'react';
import { CentralView } from './CentralView.tsx';
import { NavRow } from './NavRow.tsx';
import { Sidebar } from './sidebar/Sidebar.tsx';
import { SIDEBAR_KEY_ATTR } from '../nav/sidebar/SidebarKey.tsx';
import { SidebarOverlay } from './sidebar/SidebarOverlay.tsx';
import { sidebarPrefsAtom } from '../nav/sidebar/sidebarPrefs.ts';
import { SidebarRail } from './sidebar/SidebarRail.tsx';
import { RAIL_WIDTH } from '../nav/sidebar/sidebarSnap.ts';
import { SidebarSplitter } from './sidebar/SidebarSplitter.tsx';
import { sidebarFormOf, sidebarViewAtom } from '../nav/sidebar/sidebarView.ts';
import { useSidebarMotion } from './sidebar/useSidebarMotion.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { hasCurrentTrackAtom } from '../playback/playerAtoms.ts';
import { PlayerBar } from './player/PlayerBar.tsx';
import { playerBarStyleAtom, playerShellOf } from '../theme/playerBarStyle.ts';
import { PlayerCapsule } from './player/PlayerCapsule.tsx';
import styles from './MainWindow.module.css';
import { RightCardDock } from './right-card/RightCardDock.tsx';
import { TitleBar } from './TitleBar.tsx';
import { useService } from '../kit/useService.ts';
import { rightCardKey } from './right-card/rightCardServices.ts';

/**
 * 侧边栏卸掉时（藏起来、窗口跨档）焦点在里面，就交给侧边栏键（导航行或标题栏里），不让它掉到 body 上。
 * React 在把节点移出文档之前调这个清理，那时焦点还在节点里；侧边栏键不随跨档重挂，这时就在文档里。
 */
function keepFocus(node: HTMLElement | null): (() => void) | undefined {
  if (!node) return undefined;
  return () => {
    if (node.contains(document.activeElement)) {
      document.querySelector<HTMLElement>(`[${SIDEBAR_KEY_ATTR}]`)?.focus();
    }
  };
}

/**
 * 主窗版式：顶上是标题栏，下面左边是侧边栏，右边是内容卡。标题栏与侧边栏直接放在窗口材质上，
 * 只有内容卡铺底、带圆角。
 *
 * 播放栏按用户选的形态（`playerBarStyle.ts`）放：底部通栏横在最下面一行；胶囊浮在卡片底部，卡片上的
 * `--player-inset` 给出它盖住的高度，页面的滚动区要按它在底部加内边距，最后一截才滚得出来。没有当前曲目
 * 时这两样都不出，`--player-inset` 回到 0。播放栏在标题栏时卡片顶部固定一条导航行，放后退、前进与侧边栏
 * 键；另两种形态这几个键在标题栏。
 *
 * 内容卡右边能开右侧卡（`right-card/`）：宽窗里停靠成第二张卡，窄窗里盖在内容卡上，导航行与胶囊照常露着。
 *
 * 侧边栏按窗口宽度分档（`sidebarView.ts`）：宽窗照用户存的形态，展开、图标态或藏起来，露着时与内容之间有
 * 分栏握柄；641–1007 恒为图标态、没有握柄；≤ 640 不显示。窄的两档里侧边栏键以浮层展开整张
 * 侧边栏。换形态时窗格裁剪或平移、内容位移（`useSidebarMotion`），布局在第 0 帧就到终值。
 */
export function MainWindow() {
  const { tier } = useAtomValueRawSync(sidebarViewAtom);
  const prefs = useAtomValueRawSync(sidebarPrefsAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const shell = playerShellOf(useAtomValueRawSync(playerBarStyleAtom), tier === 'wide');
  const hasTrack = useAtomValueRawSync(hasCurrentTrackAtom);
  const capsule = shell.capsule && hasTrack;
  const rightCard = useService(rightCardKey);
  const body = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLElement>(null);
  const { width } = prefs;
  const form = sidebarFormOf(tier, prefs);
  const shown = useSidebarMotion({ pane, content, form, tier, width, reduced });
  let column = 0;
  if (form !== 'none') column = form === 'expanded' ? width : RAIL_WIDTH;

  return (
    <div className={styles.root}>
      <TitleBar />
      <div
        ref={body}
        className={styles.body}
        style={{ gridTemplateColumns: `${column}px minmax(0, 1fr)` }}
        data-sidebar={form}
      >
        {shown !== 'none' && (
          <aside ref={keepFocus} className={styles.sidebar}>
            <div
              ref={pane}
              className={styles.pane}
              style={{ width: shown === 'expanded' ? width : RAIL_WIDTH }}
            >
              {shown === 'expanded' ? <Sidebar /> : <SidebarRail />}
            </div>
          </aside>
        )}
        <main ref={content} className={styles.content}>
          {tier === 'wide' && form !== 'none' && <SidebarSplitter origin={body} />}
          <RightCardDock
            services={rightCard}
            navRow={shell.navRow}
            capsule={capsule}
            compact={tier === 'hidden'}
          >
            <div
              className={styles.card}
              data-capsule={capsule || undefined}
              data-with-nav-row={shell.navRow || undefined}
            >
              {shell.navRow && <NavRow />}
              <CentralView />
              {capsule && <PlayerCapsule />}
            </div>
          </RightCardDock>
        </main>
        {tier !== 'wide' && <SidebarOverlay />}
      </div>
      {shell.bottom && hasTrack && <PlayerBar />}
    </div>
  );
}
