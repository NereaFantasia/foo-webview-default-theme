import { Button } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { albumKeyOf, type Album } from '../../host/libraryContract.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { historyKey } from '../../nav/navHistory.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { HomeAlbumCard } from './HomeAlbumCard.tsx';
import { useHomeServices } from './homeContext.ts';
import { HomeRail, TILE_SHAPE, TILE_VARS } from './HomeRail.tsx';
import { HomeRow } from './HomeRow.tsx';
import { SkeletonRail, TileSkeleton } from './HomeSkeleton.tsx';

/** 最近添加的专辑。读不到时留一条可重试的提示；没有可靠的添加时间或还没有专辑时整行不出 */
export function HomeAdded({
  rowWidth,
  onMenu,
  menuOwner,
}: {
  readonly rowWidth: number;
  readonly onMenu: (album: Album, at: TablePoint, owner: string) => void;
  readonly menuOwner: string | undefined;
}) {
  const viewControls = useViewControlStyles();
  const home = useHomeServices();
  const history = useService(historyKey);
  const t = useAtomValueRawSync(translateAtom);
  const recent = useAtomValueRawSync(home.recent.state);
  const added = useAtomValueRawSync(home.recent.albums);
  const failed = recent.status === 'failed' || recent.status === 'unavailable';
  const loading = (recent.status === 'idle' || recent.status === 'loading') && !added.length;
  if (!failed && !loading && !added.length) return null;
  return (
    <HomeRow
      section="added"
      title={t('home.added')}
      onOpen={() => history.navigate({ id: 'recent' })}
      loading={loading}
    >
      {failed && (
        <p role="alert">
          {t('home.addedFailed')}{' '}
          <Button className={viewControls.field} onClick={() => void home.recent.refresh()}>
            {t('album.retry')}
          </Button>
        </p>
      )}
      {loading ? (
        <SkeletonRail
          id="added"
          label={t('home.added')}
          rowWidth={rowWidth}
          shape={TILE_SHAPE}
          items={TILE_SHAPE.per + 1}
        >
          <TileSkeleton />
        </SkeletonRail>
      ) : (
        <HomeRail
          id="added"
          label={t('home.added')}
          rowWidth={rowWidth}
          shape={TILE_SHAPE}
          items={added}
          keyOf={albumKeyOf}
          render={(album) => (
            <div style={TILE_VARS}>
              <HomeAlbumCard album={album} onMenu={onMenu} menuOwner={menuOwner} />
            </div>
          )}
        />
      )}
    </HomeRow>
  );
}
