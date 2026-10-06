import { makeStyles, Title2 } from '@fluentui/react-components';
import {
  Globe20Regular,
  Info20Regular,
  Keyboard20Regular,
  MusicNote220Regular,
  PaintBrush20Regular,
  PlayCircle20Regular,
  Settings20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefCallback,
} from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { createSnapshotSlot } from '../nav/navHistory.ts';
import { useElementWidth } from '../kit/useElementWidth.ts';
import { usePageSnapshot } from '../nav/usePageSnapshot.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { AboutSection } from './AboutSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { GeneralSection } from './GeneralSection.tsx';
import { PlaybackSection } from './PlaybackSection.tsx';
import { SettingsGroup } from './SettingsGroup.tsx';
import { SettingsNav } from './SettingsNav.tsx';
import styles from './SettingsPage.module.css';
import { ShortcutsSection } from './ShortcutsSection.tsx';
import { useFocusReturn } from './useFocusReturn.ts';
import {
  CARD_FIELD_MIN_WIDTH,
  PAGE_NAV_MIN_WIDTH,
  SettingsLayoutContext,
} from './useSettingsLayout.ts';
import { useSettingsNav } from './useSettingsNav.ts';
import { OnlineSettingsContext, OnlineSettingsNavigationContext } from './onlineSettingsContext.ts';
import { LyricsSettingsContext, LyricsSettingsNavigationContext } from './lyricsSettingsContext.ts';

function OnlineSection() {
  return useContext(OnlineSettingsContext);
}

function LyricsSection() {
  return useContext(LyricsSettingsContext);
}

interface GroupSpec {
  readonly id: string;
  readonly label: MessageKey;
  readonly icon: ReactElement;
  readonly content: ReactElement;
}

/** 各组在页面上的先后，目录照这个顺序列。加一组设置就在这里加一行。 */
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
    id: 'lyrics',
    label: 'lyrics.region',
    icon: <MusicNote220Regular />,
    content: <LyricsSection />,
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

const ORDER: readonly string[] = GROUPS.map((group) => group.id);

/** 回到这条历史记录时交还的滚动位置；亮哪一组由滚动位置算出，不另记。 */
const SCROLL_SLOT = createSnapshotSlot<{ readonly top: number }>();

const useStyles = makeStyles({
  title: { margin: 0, whiteSpace: 'nowrap' },
});

/**
 * 量一个元素的宽：挂上那一刻先量一次，画出来的第一帧就是对的排法，之后跟着它变。
 * 元素没有内边距，量到的就是能排版的宽。
 */
function useWidth<E extends HTMLElement>(): [number | null, RefCallback<E>] {
  const [width, setWidth] = useState<number | null>(null);
  const observe = useElementWidth<E>(setWidth);
  const ref = useCallback<RefCallback<E>>(
    (element) => {
      if (!element) return;
      setWidth(element.clientWidth);
      return observe(element);
    },
    [observe],
  );
  return [width, ref];
}

/**
 * 设置页：页标题不动，下面左边是分类目录、右边是一列自己滚动的设置卡；页面窄时目录收成标题下面的一行。
 * 排法只看设置页自己分到的宽度，不看窗口。改动即时生效并保存，页面上没有确定键。
 */
export function SettingsPage() {
  const t = useAtomValueRawSync(translateAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const classes = useStyles();
  const [pageWidth, page] = useWidth<HTMLElement>();
  const [columnWidth, column] = useWidth<HTMLDivElement>();
  const strip = pageWidth !== null && pageWidth < PAGE_NAV_MIN_WIDTH;
  const compact = columnWidth !== null && columnWidth < CARD_FIELD_MIN_WIDTH;
  const layout = useMemo(() => ({ compact }), [compact]);
  const nav = useSettingsNav(ORDER, reduced);
  // 目录与卡列都在这一层里，页面上能接焦点的都在它下面。
  const body = useRef<HTMLDivElement>(null);
  useFocusReturn(body);

  usePageSnapshot(
    SCROLL_SLOT,
    {
      capture: () => ({ top: nav.scroller.current?.scrollTop ?? 0 }),
      restore: ({ top }) => {
        if (nav.scroller.current) nav.scroller.current.scrollTop = top;
      },
    },
    true,
  );

  const items = GROUPS.map((group) => ({ id: group.id, label: t(group.label), icon: group.icon }));
  return (
    <section
      ref={page}
      className={styles.root}
      aria-label={t('place.settings')}
      data-page="settings"
    >
      <header className={styles.header}>
        <Title2 as="h1" className={classes.title}>
          {t('place.settings')}
        </Title2>
      </header>
      <div ref={body} className={strip ? `${styles.body} ${styles.narrow}` : styles.body}>
        <div className={styles.nav}>
          <SettingsNav items={items} current={nav.current} strip={strip} onSelect={nav.select} />
        </div>
        <div ref={nav.attach} className={styles.scroller} data-settings-scroller>
          <OnlineSettingsNavigationContext value={() => nav.select('online')}>
            <LyricsSettingsNavigationContext value={() => nav.select('lyrics')}>
              <SettingsLayoutContext value={layout}>
                <div ref={column} className={styles.column}>
                  {GROUPS.map((group) => (
                    <SettingsGroup key={group.id} group={group.id} title={t(group.label)}>
                      {group.content}
                    </SettingsGroup>
                  ))}
                </div>
              </SettingsLayoutContext>
            </LyricsSettingsNavigationContext>
          </OnlineSettingsNavigationContext>
        </div>
      </div>
    </section>
  );
}
