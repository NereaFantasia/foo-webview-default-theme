import { Button, Tooltip, makeStyles, mergeClasses } from '@fluentui/react-components';
import {
  Add16Regular,
  ArrowShuffle20Regular,
  Library20Regular,
  List20Regular,
  Pin16Regular,
  PinOff16Regular,
  Play16Filled,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { albumKeyOf, type Album } from '../../host/libraryContract.ts';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import { albumsAtom } from '../albums.ts';
import { SongArt } from '../SongArt.tsx';
import { useHomeServices } from './homeContext.ts';
import { feedLoading } from './homeFeed.ts';
import { homeAgo } from './homeModel.ts';
import { HomePinDialog } from './HomePinDialog.tsx';
import { homePinKey, type HomePin } from './homePins.ts';
import { QuickSkeleton } from './HomeSkeleton.tsx';
import styles from './HomeQuick.module.css';

const PIN_LABELS = {
  album: 'place.albums',
  playlist: 'place.playlist',
  channel: 'place.channel',
} as const;

const useStyles = makeStyles({
  unpin: { minWidth: '28px', maxWidth: '28px', height: '28px' },
});

interface QuickEntry {
  readonly key: string;
  readonly name: string;
  readonly detail: string;
  /** 固定的入口；最近播放的专辑没有 */
  readonly pin?: HomePin;
  /** 入口是专辑且在专辑清单里时给出：画它的封面，可以直接播放 */
  readonly album: Album | null;
  /** 固定的对象已经不在了：打不开，只能取消固定 */
  readonly unavailable?: boolean;
  readonly open: () => void;
}

/**
 * 首页顶部的快捷入口：固定的在前，余下的位置放最近播放的专辑，最后两格是全库随机与管理固定入口
 * 格数随行宽取 8 格或 6 格；固定的放不下时最后一格改报总数，仍打开同一个对话框
 */
export function HomeQuick({
  rowWidth,
  now,
  onMenu,
}: {
  readonly rowWidth: number;
  /** 算「昨天听过」用的当前时刻，Unix 毫秒 */
  readonly now: number;
  readonly onMenu: (album: Album, at: { x: number; y: number }, owner: string) => void;
}) {
  const viewControls = useViewControlStyles();
  const classes = useStyles();
  const home = useHomeServices();
  const albumDetail = useService(albumDetailKey);
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const state = useAtomValueRawSync(home.pins.state);
  const choices = useAtomValueRawSync(home.pinChoices);
  const catalog = useAtomValueRawSync(albumsAtom);
  const feed = useAtomValueRawSync(home.feed.state);
  const busy = useAtomValueRawSync(home.busy);
  const [open, setOpen] = useState(false);
  const columns = rowWidth > 720 ? 4 : rowWidth > 480 ? 3 : 2;
  // 最后两格留给全库随机与管理固定入口
  const slots = (columns === 4 ? 8 : 6) - 2;
  const current = new Map(choices.map((pin) => [homePinKey(pin), pin]));
  const pinned = new Set(state.items.map(homePinKey));
  const entries: QuickEntry[] = state.items.slice(0, slots).map((saved) => {
    const key = homePinKey(saved);
    const pin = current.get(key);
    return {
      key,
      name: pin?.name ?? saved.name,
      detail: t(pin ? PIN_LABELS[pin.kind] : 'home.pinUnavailable'),
      pin: saved,
      album:
        (pin?.kind === 'album' &&
          catalog.albums.find((album) => albumKeyOf(album) === pin.subject)) ||
        null,
      unavailable: !pin,
      open: () => pin && home.openPin(pin),
    };
  });
  for (const { album, playedAt } of feed.statistics.recent) {
    if (entries.length >= slots) break;
    const key = homePinKey({ kind: 'album', subject: albumKeyOf(album) });
    if (pinned.has(key)) continue;
    entries.push({
      key,
      name: album.name,
      detail: t('home.playedAgo', { when: homeAgo(playedAt, now, locale) }),
      album,
      open: () => albumDetail.open(album),
    });
  }
  // 最近播放的专辑还在读：把余下的格子先占上，读到后原位换成真入口
  const pending = feedLoading(feed) ? Math.max(0, slots - entries.length) : 0;
  const menu = (album: Album, key: string) => (event: MouseEvent) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onMenu(album, { x: event.clientX || rect.left, y: event.clientY || rect.bottom }, key);
  };
  const glyph = (kind: HomePin['kind'] | undefined): ReactNode =>
    kind === 'channel' ? <Library20Regular /> : <List20Regular />;
  return (
    <section aria-label={t('home.quick')} data-home-section="quick">
      {state.readFailed && (
        <p role="alert">
          {t('home.pinsReadFailed')}{' '}
          <Button className={viewControls.field} onClick={home.pins.retry}>
            {t('album.retry')}
          </Button>
        </p>
      )}
      {state.saveFailed && <p role="alert">{t('home.pinsSaveFailed')}</p>}
      <div className={styles.grid} style={{ '--quick-columns': String(columns) } as CSSProperties}>
        {entries.map(({ key, name, detail, pin, album, unavailable, open: openEntry }) => (
          <div
            key={key}
            className={styles.cell}
            data-home-item={key}
            onContextMenu={album ? menu(album, key) : undefined}
          >
            <button
              type="button"
              className={styles.open}
              disabled={unavailable}
              title={name}
              onClick={openEntry}
            >
              {album || pin?.kind === 'album' ? (
                <SongArt album={album ?? undefined} size={56} />
              ) : (
                <span className={styles.glyph} aria-hidden>
                  {glyph(pin?.kind)}
                </span>
              )}
              <span className={styles.text}>
                <span className={styles.name}>{name}</span>
                <span className={styles.detail}>{detail}</span>
              </span>
            </button>
            <span className={styles.keys}>
              {pin && (
                <span className={styles.pin}>
                  <Pin16Regular className={styles.mark} aria-hidden />
                  <span className={styles.unpin}>
                    <Tooltip content={t('home.unpin')} relationship="label">
                      <Button
                        appearance="subtle"
                        className={mergeClasses(viewControls.icon, classes.unpin)}
                        icon={<PinOff16Regular />}
                        aria-label={t('home.unpinItem', { name })}
                        onClick={() => home.pins.toggle(pin)}
                      />
                    </Tooltip>
                  </span>
                </span>
              )}
              {album && (
                <span className={styles.play}>
                  <PrimaryPlayButton
                    shape="circular"
                    icon={<Play16Filled />}
                    aria-label={t('home.playItem', { name })}
                    disabled={busy}
                    onClick={() => void home.playAlbum(album)}
                  />
                </span>
              )}
            </span>
          </div>
        ))}
        {Array.from({ length: pending }, (_, index) => (
          <QuickSkeleton key={`skeleton:${index}`} />
        ))}
        <div className={styles.cell} data-home-item="shuffle">
          <button
            type="button"
            className={styles.open}
            disabled={busy || !catalog.enabled}
            onClick={() => void home.shuffle()}
          >
            <span className={styles.glyph} aria-hidden>
              <ArrowShuffle20Regular />
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{t('home.shuffle')}</span>
              <span className={styles.detail}>{t('home.shuffleDetail')}</span>
            </span>
          </button>
        </div>
        <button type="button" className={styles.manage} onClick={() => setOpen(true)}>
          {state.items.length > slots ? (
            <>
              <Pin16Regular aria-hidden />
              <span>{t('home.allPins', { count: state.items.length })}</span>
            </>
          ) : (
            <>
              <Add16Regular aria-hidden />
              <span>{t('home.addPin')}</span>
            </>
          )}
        </button>
      </div>
      <HomePinDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
