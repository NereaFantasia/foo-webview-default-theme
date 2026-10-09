import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Track } from 'foo-webview-sdk';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import type { ContextMenuPoint } from '../kit/context-menu/contextMenuGeometry.ts';
import { TrackMenu } from '../library/TrackMenu.tsx';
import type { AppServices } from './services.ts';
import { RightCardInformationContext } from '../shell/right-card/rightCardContext.ts';
import { TrackInfoPanel } from '../shell/track-info/TrackInfoPanel.tsx';
import { TrackInfoToolbar } from '../shell/track-info/TrackInfoToolbar.tsx';
import { TrackInfoArtwork } from '../shell/track-info/TrackInfoArtwork.tsx';
import { createTrackInfoTarget } from '../shell/track-info/trackInfoTarget.ts';
import { infoTitle } from '../shell/track-info/trackInfoModel.ts';
import { TablePreviewContext } from '../table/tableContext.ts';
import type { TableTrack } from '../table/tableItems.ts';
import {
  infoTrackFromRow,
  startTrackInfoIntegration,
  type TrackInfoIntegration,
} from './trackInfoIntegration.ts';
import { useService } from '../kit/useService.ts';
import { albumListKey } from '../library/album-list/albumList.ts';

function Information({ integration }: { readonly integration: TrackInfoIntegration }) {
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const store = useStore();
  const albumList = useService(albumListKey);
  useAtomValueRawSync(integration.target.track);
  const [menu, setMenu] = useState<{ handle: string; at: ContextMenuPoint } | null>(null);
  const openMenu = (track: Track, at: ContextMenuPoint) => {
    const { rating } = store.get(integration.service.state);
    void albumList.menu.prepare([
      {
        ...track,
        index: 0,
        title: infoTitle(track),
        rating: rating.status === 'ready' ? rating.value.rating : track.rating,
      },
    ]);
    setMenu({ handle: track.handle, at });
  };
  return (
    <>
      <TrackInfoPanel
        service={integration.service}
        target={integration.target}
        t={t}
        locale={locale}
        renderCover={(track, expanded) => <TrackInfoArtwork track={track} expanded={expanded} />}
        onTrackMenu={openMenu}
      />
      {menu && (
        <TrackMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          isCurrent={() => store.get(integration.target.track)?.handle === menu.handle}
        />
      )}
    </>
  );
}

function InformationToolbar({ integration }: { readonly integration: TrackInfoIntegration }) {
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  return (
    <TrackInfoToolbar
      service={integration.service}
      target={integration.target}
      t={t}
      locale={locale}
    />
  );
}

export function TrackInfoRoot({
  services,
  children,
}: {
  readonly services: AppServices;
  readonly children: ReactNode;
}) {
  const { store, rightCard } = services;
  const replaying = useRef(false);
  const remembered = useMemo(() => new Map<string, Track>(), []);
  const remember = useCallback(
    (track: Track) => {
      const key = `preview:${track.handle}`;
      remembered.delete(key);
      remembered.set(key, track);
      if (remembered.size > 100) {
        const oldest = remembered.keys().next().value;
        if (oldest !== undefined) remembered.delete(oldest);
      }
      return key;
    },
    [remembered],
  );
  const target = useMemo(
    () =>
      createTrackInfoTarget(store, rightCard.deps.current, (source, track) => {
        const view = store.get(rightCard.card.view);
        if (replaying.current || view.form === 'none' || view.prefs.page !== 'info') return;
        const subject = source === 'preview' && track ? remember(track) : 'playing';
        rightCard.card.history.navigate({ id: 'info', subject });
      }),
    [store, rightCard, remember],
  );
  useEffect(
    () =>
      rightCard.card.history.registerSubject('info', {
        current: () => {
          const track = store.get(target.preview);
          return store.get(target.source) === 'preview' && track ? remember(track) : 'playing';
        },
        exists: (subject) => subject === 'playing' || remembered.has(subject),
        enter: (subject) => {
          replaying.current = true;
          try {
            const track = remembered.get(subject);
            if (subject === 'playing') target.follow('playing');
            else if (track) target.select(track);
          } finally {
            replaying.current = false;
          }
        },
      }),
    [rightCard, store, target, remember, remembered],
  );
  const [integration, setIntegration] = useState<TrackInfoIntegration | null>(null);
  const select = useCallback((row: TableTrack) => target.select(infoTrackFromRow(row)), [target]);
  useEffect(() => {
    const next = startTrackInfoIntegration({ store, rightCard }, target);
    setIntegration(next);
    return () => next.dispose();
  }, [store, rightCard, target]);
  return (
    <TablePreviewContext value={select}>
      <RightCardInformationContext
        value={
          integration
            ? {
                content: <Information integration={integration} />,
                toolbar: <InformationToolbar integration={integration} />,
              }
            : null
        }
      >
        {children}
      </RightCardInformationContext>
    </TablePreviewContext>
  );
}
