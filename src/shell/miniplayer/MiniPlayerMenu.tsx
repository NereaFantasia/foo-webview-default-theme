import { Button, makeStyles } from '@fluentui/react-components';
import {
  ArrowLeft16Regular,
  ArrowUpRight16Regular,
  CheckboxChecked16Filled,
  CheckboxUnchecked16Regular,
  Checkmark16Regular,
  ChevronRight16Regular,
  Record16Regular,
  SpeakerBox16Regular,
  Stop16Regular,
  Timer16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { miniWindowAtom, miniWindowKey } from '../../host/miniWindow.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { stepEnter } from '../../motion/stepTransition.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { currentTrackAtom, playbackOrderAtom } from '../../playback/playback.ts';
import { playbackKey } from '../../playback/playbackContract.ts';
import { ORDER_IDS, ORDER_LABEL_KEYS } from '../../playback/playbackOrder.ts';
import { roleVar } from '../../theme/roles.ts';
import { albumNavigationKey } from '../../track/albumNavigation.ts';
import { ratingsKey } from '../../track/trackRatings.ts';
import { nowPlayingMenuAtom, nowPlayingMenuKey } from '../player/context-menu/nowPlayingMenu.ts';
import { ORDER_KEY_ICONS } from '../player/playerIcons.ts';
import { OutputDeviceList } from '../player/volume/OutputDeviceList.tsx';
import { outputDevicesAtom } from '../player/volume/outputDevices.ts';
import styles from './MiniPlayerMenu.module.css';

const useStyles = makeStyles({
  back: {
    minWidth: '28px',
    width: '28px',
    height: '28px',
    padding: '0',
    color: roleVar('text-secondary'),
  },
});

type Page = 'main' | 'order' | 'devices';

const ROW = '[data-mini-row]';

/** 上下键、Home、End 在可用的行之间挪焦点；到头停住。 */
function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(ROW)].filter(
    (row) => !row.disabled,
  );
  const at = rows.findIndex((row) => row === document.activeElement);
  let next = -1;
  if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, at + 1);
  else if (event.key === 'ArrowUp') next = Math.max(0, at - 1);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = rows.length - 1;
  if (next < 0 || at < 0) return;
  event.preventDefault();
  rows[next]?.focus();
}

function Row({
  icon,
  label,
  value,
  trailing,
  name,
  disabled,
  pressed,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value?: string;
  readonly trailing?: ReactNode;
  readonly name?: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.row}
      data-mini-row={name ?? ''}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>{label}</span>
      {value && (
        <span className={styles.value} title={value}>
          {value}
        </span>
      )}
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </button>
  );
}

/**
 * 迷你播放器的更多菜单，排在窗口里而不是弹出层：播放顺序与输出设备在原位换成各自的列表，顶上的返回键回到
 * 上一页，在第一页上返回即关闭；Esc 同返回。选完一项即关闭，焦点由外面送回更多键。转到专辑先离开迷你模式，
 * 回到完整界面后再打开专辑。整个菜单的展开与收起由外面播，这里只管换页。
 */
export function MiniPlayerMenu({ onClose }: { readonly onClose: () => void }) {
  const t = useAtomValueRawSync(translateAtom);
  const mini = useService(miniWindowKey);
  const playback = useService(playbackKey);
  const menu = useService(nowPlayingMenuKey);
  const ratings = useService(ratingsKey);
  const albumNavigation = useService(albumNavigationKey);
  const store = useStore();
  const track = useAtomValueRawSync(currentTrackAtom);
  const order = useAtomValueRawSync(playbackOrderAtom);
  const { current } = useAtomValueRawSync(outputDevicesAtom);
  const { stopAfter, album } = useAtomValueRawSync(nowPlayingMenuAtom);
  const [page, setPage] = useState<{ readonly at: Page; readonly from?: Page }>({ at: 'main' });
  const classes = useStyles();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (track) void menu.prepare(track, ratings.stamp());
    return () => menu.close();
  }, [track, menu, ratings]);
  // 换页后焦点落在这一页的当前项上：顺序页是当前顺序，设备页是当前设备，回到第一页时是刚才进去的那一行。
  // 新一页按换步入场：进二级页从右、回第一页从左；刚打开菜单的那一页由外面的展开动画负责。
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const first = `${ROW}:not(:disabled)`;
    const selector =
      page.at === 'order'
        ? `${ROW}[aria-pressed="true"]`
        : page.at === 'devices'
          ? '[data-output-device][tabindex="0"]'
          : page.from
            ? `${ROW}[data-mini-row="${page.from}"]`
            : first;
    (
      element.querySelector<HTMLElement>(selector) ?? element.querySelector<HTMLElement>(first)
    )?.focus({ preventScroll: true });
    if (page.at === 'main' && !page.from) return;
    const direction = page.at === 'main' ? 'back' : 'forward';
    for (const leg of stepEnter(direction, store.get(reducedMotionAtom)))
      element.animate(leg.keyframes, leg.options);
  }, [page, store]);
  const goBack = () => (page.at === 'main' ? onClose() : setPage({ at: 'main', from: page.at }));
  useCommand({
    id: 'mini.menu.back',
    layer: 'overlay',
    keys: [{ key: 'Escape' }],
    run: goBack,
  });
  const title =
    page.at === 'order'
      ? t('player.orderMenu')
      : page.at === 'devices'
        ? t('player.outputDevice')
        : t('menu.more');
  const OrderIcon = order ? ORDER_KEY_ICONS[order] : ORDER_KEY_ICONS.default;
  return (
    <section className={styles.root} aria-label={title} data-mini-menu={page.at}>
      <div className={styles.header}>
        <Button
          appearance="subtle"
          className={classes.back}
          icon={<ArrowLeft16Regular />}
          aria-label={t('mini.back')}
          onClick={goBack}
        />
        <span>{title}</span>
      </div>
      <div ref={list} className={styles.list} onKeyDown={moveFocus}>
        {page.at === 'devices' ? (
          <OutputDeviceList onPicked={onClose} />
        ) : page.at === 'order' ? (
          ORDER_IDS.map((id) => {
            const Icon = ORDER_KEY_ICONS[id];
            return (
              <Row
                key={id}
                icon={<Icon />}
                label={t(ORDER_LABEL_KEYS[id])}
                trailing={order === id && <Checkmark16Regular />}
                pressed={order === id}
                onClick={() => {
                  void playback.setOrder(id);
                  onClose();
                }}
              />
            );
          })
        ) : (
          <>
            <Row
              name="order"
              icon={<OrderIcon />}
              label={t('player.orderMenu')}
              value={order ? t(ORDER_LABEL_KEYS[order]) : undefined}
              trailing={<ChevronRight16Regular />}
              onClick={() => setPage({ at: 'order' })}
            />
            <Row
              icon={<Timer16Regular />}
              label={t('context.stopAfter')}
              trailing={stopAfter ? <CheckboxChecked16Filled /> : <CheckboxUnchecked16Regular />}
              disabled={stopAfter === null}
              pressed={stopAfter === true}
              onClick={() => void menu.setStopAfter(stopAfter !== true)}
            />
            <Row
              icon={<Stop16Regular />}
              label={t('context.stop')}
              disabled={!track}
              onClick={() => {
                void playback.stop();
                onClose();
              }}
            />
            <Row
              icon={<Record16Regular />}
              label={t('mini.goToAlbum')}
              trailing={<ArrowUpRight16Regular />}
              disabled={!album}
              onClick={() => {
                void mini.leave().then(() => {
                  if (!store.get(miniWindowAtom).active && album) albumNavigation.open(album);
                });
              }}
            />
            <Row
              name="devices"
              icon={<SpeakerBox16Regular />}
              label={t('player.outputDevice')}
              value={current?.name}
              trailing={<ChevronRight16Regular />}
              onClick={() => setPage({ at: 'devices' })}
            />
          </>
        )}
      </div>
    </section>
  );
}
