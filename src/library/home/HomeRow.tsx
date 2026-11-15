import {
  Button,
  makeStyles,
  mergeClasses,
  MenuButton,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tooltip,
} from '@fluentui/react-components';
import {
  ChevronLeft24Regular,
  ChevronRight16Regular,
  ChevronRight24Regular,
  Cloud16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import type { MusicDiscoverArea } from '../../server/musicDiscover.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { RailPagerContext, type RailPager } from './HomeRail.tsx';
import styles from './HomeRow.module.css';

// 胶囊里的键 40 × 30，悬停底也是胶囊，四周离胶囊内侧都是 2，与导航行的胶囊同一套尺寸；图标比导航键略大
const usePagerStyles = makeStyles({
  key: {
    minWidth: '40px',
    width: '40px',
    height: '30px',
    padding: '0',
    '& svg': { width: '22px', height: '22px' },
  },
});

/** 滚轮攒够这么多像素才翻一组：触控板的一次轻扫是许多个小增量 */
const WHEEL_STEP = 40;
/** 翻过一组后，在这段时长（毫秒）内不再响应滚轮：滚轮的一格只翻一组，让平滑滚动有时间走完 */
const WHEEL_REST_MS = 350;

/**
 * 在翻页胶囊上滚动滚轮翻页：向下或向右翻下一组，向上或向左翻上一组。
 * 指针确实移到胶囊上之后才接管滚轮。整页滚动时胶囊从静止的指针下面经过不算，不会把页面的滚动截走
 */
function useWheelPaging(pager: RailPager) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(pager);
  useLayoutEffect(() => {
    latest.current = pager;
  });
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let armed = false;
    let total = 0;
    let rest = 0;
    // 内容滚动后浏览器补发的指针事件没有位移，只有真正移动才算移进胶囊
    const arm = (event: PointerEvent) => {
      if (event.movementX || event.movementY) armed = true;
    };
    const disarm = () => {
      armed = false;
      total = 0;
    };
    const wheel = (event: WheelEvent) => {
      if (!armed || event.ctrlKey) return;
      event.preventDefault();
      if (event.timeStamp < rest) return;
      const along = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      // 增量以行或页为单位时（多是鼠标滚轮），一格就足够翻一组
      total += event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? along : along * WHEEL_STEP;
      if (Math.abs(total) < WHEEL_STEP) return;
      const direction = total > 0 ? 1 : -1;
      total = 0;
      rest = event.timeStamp + WHEEL_REST_MS;
      const { start, end, page } = latest.current;
      if (direction > 0 ? !end : !start) page(direction);
    };
    element.addEventListener('pointermove', arm);
    element.addEventListener('pointerleave', disarm);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('pointermove', arm);
      element.removeEventListener('pointerleave', disarm);
      element.removeEventListener('wheel', wheel);
    };
  }, []);
  return box;
}

/**
 * 标题行右端的翻页胶囊：两键之间有一道半透明竖线，可在其上滚动滚轮翻页。
 * 整个胶囊只有一条悬停提示，写明第几页、共几页，两个键各自只有无障碍名称。
 * 到头的一侧置灰但仍可聚焦，键盘连按到底时焦点不会丢失
 */
function RowPager({ pager }: { readonly pager: RailPager }) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const classes = usePagerStyles();
  const box = useWheelPaging(pager);
  const key = mergeClasses(controls.icon, classes.key);
  return (
    <Tooltip
      content={t('home.pageOf', { page: pager.index, total: pager.total })}
      relationship="description"
    >
      <div ref={box} className={styles.pager}>
        <Button
          appearance="subtle"
          shape="circular"
          className={key}
          icon={<ChevronLeft24Regular />}
          aria-label={t('home.previousPage')}
          disabledFocusable={pager.start}
          onClick={() => pager.page(-1)}
        />
        <span className={styles.divider} aria-hidden />
        <Button
          appearance="subtle"
          shape="circular"
          className={key}
          icon={<ChevronRight24Regular />}
          aria-label={t('home.nextPage')}
          disabledFocusable={pager.end}
          onClick={() => pager.page(1)}
        />
      </div>
    </Tooltip>
  );
}

/**
 * 首页的一行。给定 `onOpen` 时标题可点击，进入这一行对应的页面。`source` 是在线内容的来源，在标题后显示一次。
 * `extra` 紧跟在标题后（如地区），`tail` 是标题行右端属于这一行自己的操作。行里的横排行放不下一屏时，标题行最右端出现翻页组
 */
export function HomeRow({
  section,
  title,
  onOpen,
  source,
  extra,
  tail,
  hideTitle = false,
  loading = false,
  children,
}: {
  /** 页面快照按它认回焦点所在的行，同一页里唯一 */
  readonly section: string;
  readonly title: string;
  readonly onOpen?: () => void;
  readonly source?: string;
  readonly extra?: ReactNode;
  readonly tail?: ReactNode;
  /** 不显示标题行，标题只作为这一行的无障碍名称（横幅） */
  readonly hideTitle?: boolean;
  /** 里面放的是骨架：读屏据此知道这一行正在载入。占位的横排行没有可翻的内容，不显示翻页组 */
  readonly loading?: boolean;
  readonly children: ReactNode;
}) {
  const [pager, setPager] = useState<RailPager | null>(null);
  return (
    <section
      aria-label={title}
      aria-busy={loading || undefined}
      data-home-section={section}
      className={styles.row}
    >
      {!hideTitle && (
        <header className={styles.head}>
          <h2>
            {onOpen ? (
              <button type="button" className={styles.title} onClick={onOpen}>
                {title}
                <ChevronRight16Regular aria-hidden />
              </button>
            ) : (
              title
            )}
          </h2>
          {source && (
            <span className={styles.source}>
              <Cloud16Regular aria-hidden />
              {source}
            </span>
          )}
          {extra}
          {tail && <div className={styles.tail}>{tail}</div>}
          {pager && !loading && <RowPager pager={pager} />}
        </header>
      )}
      <RailPagerContext value={hideTitle ? null : setPager}>{children}</RailPagerContext>
    </section>
  );
}

export const AREA_LABELS: Readonly<Record<MusicDiscoverArea, MessageKey>> = {
  all: 'home.area.all',
  zh: 'home.area.zh',
  ea: 'home.area.ea',
  jp: 'home.area.jp',
  kr: 'home.area.kr',
};

/** 标题后的地区选择：一个显示当前地区的小下拉键，打开后是单选菜单 */
export function HomeAreaMenu({
  label,
  areas,
  value,
  onChange,
}: {
  /** 菜单的无障碍名称，如「新歌速递的地区」。按键的名称另带上当前地区 */
  readonly label: string;
  readonly areas: readonly MusicDiscoverArea[];
  readonly value: MusicDiscoverArea;
  onChange(area: MusicDiscoverArea): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      checkedValues={{ area: [value] }}
      onCheckedValueChange={(_, data) => {
        const area = areas.find((item) => item === data.checkedItems[0]);
        if (area) onChange(area);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuButton
          size="small"
          appearance="subtle"
          className={controls.icon}
          aria-label={t('home.areaCurrent', { label, area: t(AREA_LABELS[value]) })}
        >
          {t(AREA_LABELS[value])}
        </MenuButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={label}>
          {areas.map((area) => (
            <MenuItemRadio key={area} name="area" value={area}>
              {t(AREA_LABELS[area])}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
