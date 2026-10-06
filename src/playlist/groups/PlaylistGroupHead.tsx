import { ChevronRight16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import type { PluralPick } from '../../i18n/plural.ts';
import type { Translate } from '../../i18n/translate.ts';
import type { TableGroupState } from '../../table/TrackTable.tsx';
import type { TableGroupItem } from '../../table/tableItems.ts';
import type { GroupCover, PlaylistCoversService } from './playlistCovers.ts';
import styles from './PlaylistGroupHead.module.css';
import type { PlaylistGroupHead as HeadData } from '../playlistView.ts';

export interface PlaylistGroupHeadProps {
  readonly guid: string;
  readonly item: TableGroupItem<HeadData>;
  readonly state: TableGroupState;
  /** 按专辑分的两档：一级组头写专辑名、专辑艺术家与年份，其余档只写组键。 */
  readonly albumMode: boolean;
  /** 封面列此刻的宽，CSS 像素；0 是封面列关着，一张都不取。 */
  readonly coverWidth: number;
  readonly covers: Pick<PlaylistCoversService, 'coverOf' | 'versionAtom'>;
  readonly t: Translate;
  readonly plural: PluralPick;
}

/** 年份取日期标签的前四位，不是年份就不写：宿主原样给出标签里的日期串。 */
function yearOf(date: string | undefined): string {
  return date && /^\d{4}/.test(date) ? date.slice(0, 4) : '';
}

/** 一组的封面块：挂在组头下面、压在组里前几行的左边。组跨了几个目录就竖着排几张；都读不出来画底色。 */
function GroupCoverBlock({ cover, size }: { cover: GroupCover | undefined; size: number }) {
  const urls = cover?.urls ?? [];
  // 换了一批封面就清掉读不出的记录，旧地址的失败不记到新图头上。
  const [broken, setBroken] = useState<{ of: readonly string[]; urls: ReadonlySet<string> }>({
    of: urls,
    urls: new Set(),
  });
  const failed = broken.of === urls ? broken.urls : new Set<string>();
  return (
    <div
      className={styles.cover}
      style={{ width: size, height: size }}
      aria-hidden
      data-table-group-body
    >
      <div className={styles.art}>
        {urls.map((url, at) =>
          failed.has(url) ? null : (
            <img
              // 两个目录可能取到同一个地址，按位置做键才不撞。
              key={at}
              className={styles.image}
              src={url}
              alt=""
              draggable={false}
              onError={() => setBroken({ of: urls, urls: new Set(failed).add(url) })}
            />
          ),
        )}
      </div>
    </div>
  );
}

/**
 * 播放列表页的分组头：一级组头一整行，开合键、组名、（专辑档）专辑艺术家、横线、首数与年份，展开时下面挂
 * 封面；二级组头（碟号）让开封面列，只写组键与首数。组名读组内第一行，那一页没到时先写组键；空组键写成
 * 「未知」。游程在重取时画空的组头。里面的按钮不在 Tab 次序上，键盘从表格那一层走。
 */
export function PlaylistGroupHead(props: PlaylistGroupHeadProps) {
  const { item, state, t, plural } = props;
  const { data } = item;
  useAtomValueRawSync(props.covers.versionAtom);
  if (data.pending) return <div className={styles.head} data-group-pending />;
  const album = props.albumMode && data.level === 1;
  const label = (album ? data.row?.album || data.key : data.key) || t('playlistPage.unknownGroup');
  const artist = album ? (data.row?.albumArtist ?? '') : '';
  const year = album ? yearOf(data.row?.date) : '';
  const count = t(plural(data.count, 'album.menuTracksOne', 'album.menuTracks'), {
    count: data.count,
  });
  const showCover = data.level === 1 && !item.collapsed && props.coverWidth > 0;
  return (
    <>
      <div
        className={styles.head}
        data-level={data.level}
        data-playlist-group={data.key}
        title={label}
      >
        {data.level === 1 && (
          <button
            type="button"
            tabIndex={-1}
            className={styles.chevron}
            data-expanded={!item.collapsed}
            aria-label={t(item.collapsed ? 'albumList.expandAlbum' : 'albumList.collapseAlbum')}
            onClick={() => state.toggle()}
          >
            <ChevronRight16Regular />
          </button>
        )}
        <span className={styles.label}>{label}</span>
        {artist && <span className={styles.artist}>{artist}</span>}
        <span className={styles.rule} aria-hidden />
        <span className={styles.count}>{count}</span>
        {year && <span className={styles.count}>{year}</span>}
      </div>
      {showCover && (
        <GroupCoverBlock
          cover={props.covers.coverOf(props.guid, data.runIndex, props.coverWidth)}
          size={props.coverWidth}
        />
      )}
    </>
  );
}
