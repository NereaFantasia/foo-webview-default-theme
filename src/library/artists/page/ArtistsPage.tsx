import { Button, Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { createSnapshotSlot } from '../../../nav/navHistory.ts';
import { usePageSnapshot } from '../../../nav/usePageSnapshot.ts';
import type { PageProps } from '../../../nav/places.ts';
import { ArtistsContext, useArtists } from '../artistsContext.ts';
import { ArtistWall } from './ArtistWall.tsx';
import { ArtistHeader } from './ArtistHeader.tsx';
import { ArtistAbout } from './ArtistAbout.tsx';
import { ArtistHighlights } from './ArtistHighlights.tsx';
import { ArtistAlbums, ArtistAlbumsStatus } from './ArtistAlbums.tsx';
import { ArtistMenu } from './ArtistMenu.tsx';
import { ArtistRenameDialog } from './ArtistRenameDialog.tsx';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import styles from './ArtistsPage.module.css';
import { AddFoldersAction } from '../../AddFoldersAction.tsx';
import { ArtistColorTheme } from './ArtistColorTheme.tsx';
import { ArtistHeroImage } from './ArtistHeroImage.tsx';
import { DetailFrame } from '../../detail/DetailFrame.tsx';
import { newestFirst } from '../albumOrder.ts';

/** 墙与详情各是一条历史记录，各记各的：墙记筛选与滚动，详情只记滚动 */
interface ArtistsSnapshot {
  readonly text: string;
  readonly tidy: boolean;
  readonly top: number;
}
const SLOT = createSnapshotSlot<ArtistsSnapshot>();

interface ArtistMenuState {
  readonly names: readonly string[];
  readonly x: number;
  readonly y: number;
}

interface ArtistRenameState {
  readonly names: readonly string[];
  readonly target: string;
}

/**
 * 艺人地点：没有主体时是封面墙，有主体时是这位艺人的整页详情。墙还是详情按这一层自己的记录定，不读全局的
 * 当前艺人：过渡时新旧两层同时在画，读全局的话离场那层会跟着变成另一边
 */
function ArtistsContent({ place }: PageProps) {
  const services = useArtists();
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const catalog = useAtomValueRawSync(services.catalog.state);
  const all = useAtomValueRawSync(services.catalog.all);
  const subject = place.subject ?? null;
  const temporary = useAtomValueRawSync(services.places.temporary);
  const detail = useAtomValueRawSync(services.detail.state);
  const failed = useAtomValueRawSync(services.actions.failed);
  const [text, setText] = useState('');
  const [tidy, setTidy] = useState(false);
  const [menu, setMenu] = useState<ArtistMenuState | null>(null);
  const [rename, setRename] = useState<ArtistRenameState | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [liveVideo, setLiveVideo] = useState<HTMLVideoElement | null>(null);
  const restoring = useRef<ArtistsSnapshot | null>(null);
  usePageSnapshot(
    SLOT,
    {
      capture: () => restoring.current ?? { text, tidy, top: scroller?.scrollTop ?? 0 },
      restore: (saved) => {
        restoring.current = saved;
        setText(saved.text);
        setTidy(saved.tidy);
      },
    },
    true,
  );
  useLayoutEffect(() => {
    const saved = restoring.current;
    if (!saved || !scroller || !catalog.loaded || text !== saved.text || tidy !== saved.tidy)
      return;
    if (subject !== null && (detail.subject !== subject || detail.status !== 'ready')) return;
    scroller.scrollTop = saved.top;
    restoring.current = null;
  }, [catalog.loaded, detail, scroller, subject, text, tidy]);
  const selected = all.find((row) => row.name === subject);
  const contextMenu = menu && (
    <ArtistMenu
      names={menu.names}
      at={menu}
      onClose={() => setMenu(null)}
      onAbout={() => {
        const name = menu.names[0];
        if (subject === null && name !== undefined) services.places.open(name);
        else scroller?.querySelector('[data-artist-about]')?.scrollIntoView({ block: 'start' });
      }}
      onRename={(names, target) => setRename({ names, target })}
    />
  );
  const notices = (
    <>
      {(catalog.status === 'failed' || catalog.truncated || failed) && (
        <div className={styles.notice} role="alert">
          {t(
            failed
              ? 'artists.failedAction'
              : catalog.truncated
                ? 'artists.truncated'
                : 'artists.failed',
          )}
          <Button className={viewControls.field} onClick={services.retry}>
            {t('artists.retry')}
          </Button>
        </div>
      )}
      {temporary && (
        <div className={styles.notice} role="status">
          {t('artists.temporary')}
          <Button
            className={viewControls.field}
            size="small"
            onClick={services.places.resetTemporary}
          >
            {t('artists.reset')}
          </Button>
        </div>
      )}
    </>
  );
  const overlay = (
    <>
      {contextMenu}
      {rename && <ArtistRenameDialog {...rename} onClose={() => setRename(null)} />}
    </>
  );
  if (subject !== null && catalog.loaded && selected) {
    const own = detail.subject === subject ? (detail.detail?.own ?? []) : [];
    const theme = newestFirst(own, (group) => group.album)[0]?.album ?? null;
    return (
      <ArtistColorTheme album={theme} live={liveVideo}>
        {(glow, hero) => (
          <DetailFrame
            label={subject || t('artists.unknown')}
            page="artists"
            glow={glow}
            backdrop={hero ? <ArtistHeroImage {...hero} onVideo={setLiveVideo} /> : undefined}
            heroReady={!!hero?.url}
            intro={
              <>
                <ArtistHeader
                  key={`header:${subject}`}
                  narrow={narrow}
                  onMenu={(x, y) => setMenu({ names: [subject], x, y })}
                />
                {notices}
              </>
            }
            overlay={overlay}
            onScroller={setScroller}
            onNarrow={setNarrow}
          >
            <div className={styles.sections}>
              <ArtistAlbumsStatus />
              <ArtistAlbums key={`own:${subject}`} section="own" />
              <ArtistHighlights key={`highlights:${subject}`} />
              <ArtistAlbums key={`guest:${subject}`} section="guest" />
              <ArtistAbout />
            </div>
          </DetailFrame>
        )}
      </ArtistColorTheme>
    );
  }
  return (
    <section className={styles.root} data-page="artists" aria-label={t('artists.title')}>
      {notices}
      {!catalog.loaded && catalog.status !== 'failed' ? (
        <Spinner aria-label={t('artists.loading')} />
      ) : catalog.loaded && !all.length ? (
        <div className={styles.empty}>
          {t('artists.empty')}
          <AddFoldersAction />
        </div>
      ) : subject === null ? (
        <div className={styles.wall} ref={setScroller}>
          <ArtistWall
            text={text}
            tidy={tidy}
            scroller={scroller}
            onText={setText}
            onTidy={setTidy}
            onMenu={(name, x, y) => setMenu({ names: [name], x, y })}
          />
        </div>
      ) : (
        <div className={styles.empty}>{t('artists.gone')}</div>
      )}
      {overlay}
    </section>
  );
}

export function ArtistsPage({ place }: PageProps) {
  const services = useContext(ArtistsContext);
  return services ? <ArtistsContent place={place} /> : <Spinner />;
}

export const ARTISTS_PAGES = { artists: ArtistsPage };
