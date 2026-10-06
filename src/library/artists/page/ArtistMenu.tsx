import { fb } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import type { LibraryTrack } from 'foo-webview-sdk';
import { translateAtom } from '../../../i18n/locale.ts';
import { ContextMenu } from '../../../kit/context-menu/ContextMenu.tsx';
import type {
  ContextMenuEntry,
  ContextMenuCommand,
} from '../../../kit/context-menu/contextMenuItems.ts';
import { readSendTargets, type SendTarget } from '../../../track/trackListActions.ts';
import { useArtists } from '../artistsContext.ts';
import { artistQuery } from '../artistActions.ts';
import { isCompilation } from '../artistNames.ts';

export interface ArtistMenuProps {
  readonly names: readonly string[];
  readonly at: { readonly x: number; readonly y: number };
  onClose(): void;
  onAbout(): void;
  onRename(names: readonly string[], target: string): void;
}
export function ArtistMenu(props: ArtistMenuProps) {
  const services = useArtists();
  const t = useAtomValueRawSync(translateAtom);
  const catalog = useAtomValueRawSync(services.catalog.state);
  const all = useAtomValueRawSync(services.catalog.all);
  const marked = useAtomValueRawSync(services.tidy.compilations);
  const busy = useAtomValueRawSync(services.actions.busy);
  const biography = useAtomValueRawSync(services.biography.service.state);
  const [targets, setTargets] = useState<readonly SendTarget[]>([]);
  const [tracks, setTracks] = useState<readonly LibraryTrack[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void readSendTargets(fb).then((next) => {
      if (active) setTargets(next);
    });
    void services.actions.tracksOf(props.names).then((next) => {
      if (active) {
        setTracks(next);
        setFailed(next === null);
      }
    });
    return () => {
      active = false;
    };
  }, [props.names, services]);
  const exactAlbumField =
    catalog.basis !== 'albumArtist' ||
    (tracks !== null &&
      tracks.every(
        (track) => (track.albumArtists.length ? track.albumArtists : track.artists).length <= 1,
      ));
  const query = exactAlbumField
    ? artistQuery(
        props.names,
        catalog.basis,
        all.map((row) => row.name),
      )
    : null;
  const first = props.names[0] ?? '';
  const name = props.names.map((name) => name || t('artists.unknown')).join(', ');
  const available = !!tracks?.length && !busy;
  const queueDisabled = !available || (tracks?.length ?? 0) > 256;
  const command = (
    id: string,
    label: string,
    onSelect: () => void,
    disabled = false,
    reason?: string,
  ): ContextMenuCommand => ({ kind: 'command', id, label, onSelect, disabled, reason });
  const issue = catalog.issues.get(first)?.find((issue) => issue.kind === 'duplicate');
  const items: ContextMenuEntry[] = [
    ...(!tracks
      ? [
          {
            kind: 'status' as const,
            id: 'loading',
            label: t(failed ? 'artists.failed' : 'artists.loading'),
          },
        ]
      : []),
    command(
      'play',
      t('artists.play'),
      () => {
        void services.actions.play(props.names, false, tracks ?? undefined);
      },
      !available,
    ),
    command(
      'shuffle',
      t('artists.shuffle'),
      () => {
        void services.actions.play(props.names, true, tracks ?? undefined);
      },
      !available,
    ),
    command(
      'next',
      t('artists.next'),
      () => {
        void services.actions.queue(props.names, true);
      },
      queueDisabled,
      queueDisabled ? t('artists.queueLimit') : undefined,
    ),
    command(
      'queue',
      t('artists.queue'),
      () => {
        void services.actions.queue(props.names, false);
      },
      queueDisabled,
      queueDisabled ? t('artists.queueLimit') : undefined,
    ),
    {
      kind: 'submenu',
      id: 'send',
      label: t('artists.send'),
      disabled: !available,
      items: [
        ...targets.map((target) =>
          command(
            target.guid,
            target.name,
            () => {
              void services.actions.send(props.names, target);
            },
            target.locked,
          ),
        ),
        command('new', t('artists.newPlaylist'), () => {
          void services.actions.send(props.names);
        }),
      ],
    },
    command(
      'autoplaylist',
      t('artists.autoplaylist'),
      () => {
        if (query) void services.actions.autoplaylist(props.names, query);
      },
      query === null,
      query === null ? t('artists.queryUnsupported') : undefined,
    ),
    command(
      'songs',
      t('artists.openSongs'),
      () => {
        if (query) services.actions.openSongs(query);
      },
      query === null,
      query === null ? t('artists.queryUnsupported') : undefined,
    ),
    { kind: 'separator', id: 'identity' },
  ];
  if (props.names.length === 1 && biography.document)
    items.push(command('about', t('artists.about'), props.onAbout));
  if (props.names.length === 1 && first)
    items.push(
      command(
        'compilation',
        t(isCompilation(first, marked) ? 'artists.unmarkCompilation' : 'artists.markCompilation'),
        () => services.tidy.mark(first, !isCompilation(first, marked)),
        isCompilation(first),
      ),
    );
  if (props.names.every(Boolean))
    items.push(
      command(
        'rename',
        t(props.names.length > 1 ? 'artists.merge' : 'artists.rename'),
        () => props.onRename(props.names, issue?.kind === 'duplicate' ? issue.target : first),
        !available,
      ),
      command(
        'properties',
        t('artists.properties'),
        () => {
          if (tracks) void services.writes.properties(tracks);
        },
        !available,
      ),
    );
  if (props.names.some((name) => catalog.issues.has(name)))
    items.push(command('ignore', t('artists.ignore'), () => services.tidy.ignore(props.names)));
  items.push(
    command('copy', t('artists.copy'), () => {
      void services.actions.copy(props.names);
    }),
  );
  return (
    <ContextMenu
      at={props.at}
      targetKey={JSON.stringify(props.names)}
      title={name}
      items={items}
      backLabel={t('artists.title')}
      isCurrent={() => props.names.every((name) => all.some((row) => row.name === name))}
      onClose={props.onClose}
    />
  );
}
