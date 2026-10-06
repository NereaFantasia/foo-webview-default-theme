import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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

function InformationToolbar({
  integration,
  close,
}: {
  readonly integration: TrackInfoIntegration;
  readonly close: () => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  return (
    <TrackInfoToolbar
      service={integration.service}
      target={integration.target}
      t={t}
      locale={locale}
      onClose={close}
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
  const target = useMemo(
    () => createTrackInfoTarget(store, rightCard.deps.current),
    [store, rightCard],
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
                toolbar: (
                  <InformationToolbar integration={integration} close={rightCard.card.close} />
                ),
              }
            : null
        }
      >
        {children}
      </RightCardInformationContext>
    </TablePreviewContext>
  );
}
