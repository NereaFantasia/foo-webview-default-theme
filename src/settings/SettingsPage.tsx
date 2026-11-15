import {
  Globe20Regular,
  Headphones20Regular,
  Info20Regular,
  Keyboard20Regular,
  MusicNote220Regular,
  PaintBrush20Regular,
  PlayCircle20Regular,
  Settings20Regular,
  FullScreenMaximize20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefCallback,
} from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { createSnapshotSlot } from '../nav/navHistory.ts';
import { useElementWidth } from '../kit/useElementWidth.ts';
import { useService } from '../kit/useService.ts';
import { usePageSnapshot } from '../nav/usePageSnapshot.ts';
import { pageTransition } from '../motion/pageTransition.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { AboutSection } from './AboutSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { ExpanderRegistryContext, createExpanderRegistry } from './expanderMemory.ts';
import { GeneralSection } from './GeneralSection.tsx';
import { PlaybackSection } from './PlaybackSection.tsx';
import { OnlineMusicSection } from './OnlineMusicSection.tsx';
import { SettingsGroup, groupTitleId } from './SettingsGroup.tsx';
import { SettingsNav } from './SettingsNav.tsx';
import styles from './SettingsPage.module.css';
import { settingsNavKey, type SettingsSection } from './settingsNav.ts';
import { ShortcutsSection } from './ShortcutsSection.tsx';
import { useFocusReturn } from './useFocusReturn.ts';
import {
  CARD_FIELD_MIN_WIDTH,
  PAGE_NAV_MIN_WIDTH,
  SettingsLayoutContext,
} from './useSettingsLayout.ts';
import { OnlineSettingsContext } from './onlineSettingsContext.ts';
import { LyricsSettingsContext } from './lyricsSettingsContext.ts';
import { ImmersiveSettingsContext } from './immersiveSettingsContext.ts';

function ImmersiveSection() {
  return useContext(ImmersiveSettingsContext);
}

function OnlineSection() {
  return useContext(OnlineSettingsContext);
}

function LyricsSection() {
  return useContext(LyricsSettingsContext);
}

interface GroupSpec {
  readonly id: SettingsSection;
  readonly label: MessageKey;
  readonly icon: ReactElement;
  readonly content: ReactElement;
}

/** 各区在目录里的先后（与 `SETTINGS_SECTIONS` 一致）。加一区设置就在这里加一行 */
const GROUPS: readonly GroupSpec[] = [
  {
    id: 'general',
    label: 'settings.groupGeneral',
    icon: <Settings20Regular />,
    content: <GeneralSection />,
  },
  {
    id: 'appearance',
    label: 'settings.groupAppearance',
    icon: <PaintBrush20Regular />,
    content: <AppearanceSection />,
  },
  {
    id: 'playback',
    label: 'settings.groupPlayback',
    icon: <PlayCircle20Regular />,
    content: <PlaybackSection />,
  },
  {
    id: 'immersive',
    label: 'settings.groupImmersive',
    icon: <FullScreenMaximize20Regular />,
    content: <ImmersiveSection />,
  },
  {
    id: 'lyrics',
    label: 'lyrics.region',
    icon: <MusicNote220Regular />,
    content: <LyricsSection />,
  },
  {
    id: 'music',
    label: 'place.online',
    icon: <Headphones20Regular />,
    content: <OnlineMusicSection />,
  },
  {
    id: 'online',
    label: 'biography.groupOnline',
    icon: <Globe20Regular />,
    content: <OnlineSection />,
  },
  {
    id: 'shortcuts',
    label: 'settings.groupShortcuts',
    icon: <Keyboard20Regular />,
    content: <ShortcutsSection />,
  },
  { id: 'about', label: 'settings.groupAbout', icon: <Info20Regular />, content: <AboutSection /> },
];

/**
 * 回到这条历史记录时交还的分区、滚动位置与各张展开卡的开合
 * 开合只随历史记录走，新进设置页仍是各卡自己的缺省
 */
const SCROLL_SLOT = createSnapshotSlot<{
  readonly section: SettingsSection;
  readonly top: number;
  readonly open: Readonly<Record<string, boolean>>;
}>();

/**
 * 量一个元素的宽：挂上那一刻先量一次，画出来的第一帧就是对的排法，之后跟着它变
 * 元素没有内边距，量到的就是能排版的宽
 */
function useWidth<E extends HTMLElement>(): [number | null, RefCallback<E>] {
  const [width, setWidth] = useState<number | null>(null);
  const measured = useRef<E | null>(null);
  const publish = useCallback((next: number) => {
    if (next > 0) setWidth(next);
  }, []);
  const observe = useElementWidth<E>(publish);
  const ref = useCallback<RefCallback<E>>(
    (element) => {
      measured.current = element;
      if (!element) return;
      publish(element.clientWidth);
      return observe(element);
    },
    [observe, publish],
  );
  // 目录切成分区名会改变卡列宽度，绘制前补量；隐藏页面的零宽不作为布局依据
  useLayoutEffect(() => {
    if (measured.current) publish(measured.current.clientWidth);
  });
  return [width, ref];
}

/**
 * 设置页：左边是分区目录，右边是当前分区的设置卡，一列自己滚动；分区名是卡列顶上的大标题。
 * 页面窄时目录收成页顶的分区名，点开选分区。排法只看设置页自己分到的宽度，不看窗口。
 * 改动即时生效并保存，页面上没有确定键
 */
export function SettingsPage() {
  const t = useAtomValueRawSync(translateAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const nav = useService(settingsNavKey);
  const section = useAtomValueRawSync(nav.section);
  const landing = useAtomValueRawSync(nav.landing);
  const [pageWidth, page] = useWidth<HTMLElement>();
  const [columnWidth, column] = useWidth<HTMLDivElement>();
  const narrow = pageWidth !== null && pageWidth < PAGE_NAV_MIN_WIDTH;
  const compact = columnWidth !== null && columnWidth < CARD_FIELD_MIN_WIDTH;
  const layout = useMemo(() => ({ compact }), [compact]);
  // 目录与卡列都在这一层里，页面上能接焦点的都在它下面
  const body = useRef<HTMLDivElement>(null);
  useFocusReturn(body);

  const scroller = useRef<HTMLDivElement>(null);
  const motion = useRef<HTMLDivElement | null>(null);
  const columnRef = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      motion.current = element;
      return column(element);
    },
    [column],
  );
  const [expanders] = useState(createExpanderRegistry);
  // 换分区回到顶。写在还原滚动之前：还原的分区与位置同时到，位置要盖过这一次回顶
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [section]);
  // 换分区时新内容上移并淡入：与切侧边栏项同一种过渡，旧内容当场换掉；首次挂上由页面自己的进场负责
  const shown = useRef(section);
  useLayoutEffect(() => {
    if (shown.current === section) return;
    shown.current = section;
    const element = motion.current;
    if (!element) return;
    for (const running of element.getAnimations()) running.cancel();
    for (const item of pageTransition('refresh', 'forward', reduced).enter) {
      element.animate(item.keyframes, item.options);
    }
  }, [section, reduced]);
  // 展开卡开合到位之后再落滚动位置：折叠着的卡列矮，先落会被夹短。每次还原换一个新对象，同一个 top 也会重落
  const [scrollTo, setScrollTo] = useState<{ readonly top: number } | null>(null);
  useLayoutEffect(() => {
    if (scrollTo && scroller.current) scroller.current.scrollTop = scrollTo.top;
  }, [scrollTo]);

  // 从别处进来并指定了分区：焦点放到分区标题上，读屏从这里读起
  useEffect(() => {
    if (!landing) return;
    document.getElementById(groupTitleId(section))?.focus({ preventScroll: true });
    nav.landed();
  }, [landing, section, nav]);

  usePageSnapshot(
    SCROLL_SLOT,
    {
      capture: () => ({
        section,
        top: scroller.current?.scrollTop ?? 0,
        open: expanders.capture(),
      }),
      restore: ({ section: saved, top, open }) => {
        expanders.restore(open);
        nav.select(saved);
        setScrollTo({ top });
      },
    },
    true,
  );

  const items = GROUPS.map((group) => ({ id: group.id, label: t(group.label), icon: group.icon }));
  const active = GROUPS.find((group) => group.id === section) ?? GROUPS[0];
  const select = (id: string) => {
    const next = GROUPS.find((group) => group.id === id);
    if (next) nav.select(next.id);
  };
  return (
    <section
      ref={page}
      className={styles.root}
      aria-label={t('place.settings')}
      data-page="settings"
    >
      <h1 className={styles.hidden}>{t('place.settings')}</h1>
      <div ref={body} className={narrow ? `${styles.body} ${styles.narrow}` : styles.body}>
        <div className={styles.nav}>
          <SettingsNav items={items} current={section} narrow={narrow} onSelect={select} />
        </div>
        <div ref={scroller} className={styles.scroller} data-settings-scroller>
          <SettingsLayoutContext value={layout}>
            <ExpanderRegistryContext value={expanders}>
              <div ref={columnRef} className={styles.column}>
                {active && (
                  <SettingsGroup
                    key={active.id}
                    group={active.id}
                    title={t(active.label)}
                    titleHidden={narrow}
                  >
                    {active.content}
                  </SettingsGroup>
                )}
              </div>
            </ExpanderRegistryContext>
          </SettingsLayoutContext>
        </div>
      </div>
    </section>
  );
}
