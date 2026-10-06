import { Spinner } from '@fluentui/react-components';
import {
  ChevronDown16Regular,
  ChevronRight16Regular,
  Record48Regular,
} from '@fluentui/react-icons';
import type { MouseEvent } from 'react';
import type { Translate } from '../../i18n/translate.ts';
import type { PluralPick } from '../../i18n/plural.ts';
import type { TableGroupState } from '../../table/TrackTable.tsx';
import type { TableGroupItem } from '../../table/tableItems.ts';
import type { AlbumCoversService } from '../albumCovers.ts';
import styles from './AlbumListGroup.module.css';
import type { AlbumListGroup as GroupData, ListAlbum, ListSection } from './albumListModel.ts';
import { albumArtistOf, albumYearOf, type Album } from '../../host/libraryContract.ts';
import { useCoverLoad } from '../../covers/useCoverLoad.ts';

/** 分组头上的动作，整张表共用一份。 */
export interface ListGroupHandlers {
  /** 进这张专辑的详情页：单击封面或专辑名。 */
  open(album: Album): void;
  /** 开合键上的单击；Ctrl 同一节的专辑都跟着。 */
  toggleAlbum(entry: ListAlbum, siblings: boolean, state: TableGroupState): void;
}

export interface AlbumListGroupProps {
  readonly item: TableGroupItem<GroupData>;
  readonly state: TableGroupState;
  /** 封面列此刻的宽，CSS 像素；0 是不画封面。 */
  readonly coverWidth: number;
  readonly covers: AlbumCoversService;
  readonly handlers: ListGroupHandlers;
  /** 正在为进这张的详情页取曲目、等得有一阵了：专辑名后出小转圈。 */
  readonly opening?: boolean;
  readonly t: Translate;
  readonly plural: PluralPick;
  readonly animateSection?: boolean;
}

function counts(t: Translate, plural: PluralPick, albums: number, tracks: number): string {
  return [
    t(plural(albums, 'album.countOne', 'album.count'), { count: albums }),
    t(plural(tracks, 'album.menuTracksOne', 'album.menuTracks'), { count: tracks }),
  ].join(' · ');
}

interface SectionHeadProps {
  readonly section: ListSection;
  readonly collapsed: boolean;
  readonly t: Translate;
  readonly plural: PluralPick;
  readonly animated: boolean;
}

function SectionHead({ section, collapsed, t, plural, animated }: SectionHeadProps) {
  const tracks = section.span.end - section.span.start;
  return (
    <div className={`${styles.head} ${styles.section}`} data-list-section={section.key ?? ''}>
      <span
        className={styles.chevron}
        aria-hidden
        data-expanded={animated ? !collapsed : undefined}
      >
        {animated || collapsed ? <ChevronRight16Regular /> : <ChevronDown16Regular />}
      </span>
      <span className={styles.name}>{section.key ?? t('album.unknownSection')}</span>
      <span className={styles.count}>{counts(t, plural, section.albums.length, tracks)}</span>
    </div>
  );
}

interface ListCoverProps {
  readonly album: Album;
  readonly size: number;
  readonly covers: AlbumCoversService;
  readonly onOpen: () => void;
  readonly label: string;
}

/** 封面：单击进详情页。拿封面服务的名额才挂图，与封面墙的图块同一套。 */
function ListCover({ album, size, covers, onOpen, label }: ListCoverProps) {
  const cover = covers.coverOf(album, size);
  const ready = cover?.status === 'ready';
  const image = useCoverLoad(ready ? cover.url : '', (ready && cover.previous) || '', {
    acquire: () => covers.acquire(album),
    settle: (outcome) => covers.settle(album, outcome),
    wait: (retry) => covers.wait(retry),
  });
  return (
    <button
      type="button"
      tabIndex={-1}
      className={styles.cover}
      style={{ width: size, height: size }}
      aria-label={label}
      data-list-cover
      data-table-group-body
      onClick={onOpen}
    >
      <span className={styles.art}>
        {image.src ? (
          <img
            className={styles.image}
            src={image.src}
            alt=""
            draggable={false}
            onLoad={image.onLoad}
            onError={image.onError}
          />
        ) : (
          <Record48Regular className={styles.placeholder} />
        )}
      </span>
    </button>
  );
}

/**
 * 列表形态的分组头：节头画节名与张数、首数；专辑分组头画开合键、专辑名、专辑艺术家、首数与年份，展开时在它
 * 下面挂封面。里面的按钮都不在 Tab 次序上，键盘从表格那一层走。
 */
export function AlbumListGroup(props: AlbumListGroupProps) {
  const { item, state, t, plural, handlers } = props;
  const { data } = item;
  if (data.kind === 'section') {
    return (
      <SectionHead
        section={data.section}
        collapsed={item.collapsed}
        t={t}
        plural={plural}
        animated={props.animateSection ?? false}
      />
    );
  }
  const { entry } = data;
  const { album } = entry;
  const tracks = entry.span.end - entry.span.start;
  const toggle = (event: MouseEvent) =>
    handlers.toggleAlbum(entry, event.ctrlKey || event.metaKey, state);
  return (
    <>
      <div className={styles.head} data-list-album={album.name}>
        <button
          type="button"
          tabIndex={-1}
          className={styles.chevron}
          data-expanded={!item.collapsed}
          aria-label={t(item.collapsed ? 'albumList.expandAlbum' : 'albumList.collapseAlbum')}
          onClick={toggle}
        >
          <ChevronRight16Regular />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={styles.link}
          title={album.name}
          data-list-album-name
          onClick={() => handlers.open(album)}
        >
          {album.name}
        </button>
        {props.opening && <Spinner size="extra-tiny" data-list-opening />}
        <span className={styles.artist}>{albumArtistOf(album)}</span>
        <span className={styles.spacer} />
        <span className={styles.count}>
          {t(plural(tracks, 'album.menuTracksOne', 'album.menuTracks'), { count: tracks })}
        </span>
        <span className={styles.count}>{albumYearOf(album)}</span>
      </div>
      {!item.collapsed && props.coverWidth > 0 && (
        <ListCover
          album={album}
          size={props.coverWidth}
          covers={props.covers}
          label={t('album.openDetail')}
          onOpen={() => handlers.open(album)}
        />
      )}
    </>
  );
}
