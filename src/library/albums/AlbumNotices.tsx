import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Dismiss16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { albumsAtom } from '../albums.ts';
import { artistCreditsAtom } from './artistCredits.ts';
import { libraryTracksAtom } from '../libraryTracks.ts';
import { playStatsAtom } from '../playStats.ts';
import { isStatsField, needsAlbumTracks } from '../album-list/listSort.ts';
import { albumListKey, listStatsShownAtom } from '../album-list/albumList.ts';
import { browserPrefsAtom, wallSortAtom } from './browserPrefs.ts';
import { useService } from '../../kit/useService.ts';
import { trackActionsKey, trackActionsNoticeAtom } from '../../track/trackActions.ts';
import { albumsKey } from '../albumServices.ts';
import { objectOpenerKey } from '../../nav/objectOpener.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

const useStyles = makeStyles({
  bar: { margin: `0 ${tokens.spacingHorizontalXXL} ${tokens.spacingVerticalS}` },
});

/**
 * 页头下的横幅：专辑清单读失败（手上的旧清单照旧显示）、艺术家档的署名表读失败，各带重试；
 * 进详情页没进成、起播与菜单命令的失败或「上一个还没做完」可以关掉
 */
export function AlbumNotices() {
  const t = useAtomValueRawSync(translateAtom);
  const list = useAtomValueRawSync(albumsAtom);
  const credits = useAtomValueRawSync(artistCreditsAtom);
  const { dimension, form } = useAtomValueRawSync(browserPrefsAtom);
  const { sort } = useAtomValueRawSync(wallSortAtom);
  const tracks = useAtomValueRawSync(libraryTracksAtom);
  const albumList = useService(albumListKey);
  const listStatsShown = useAtomValueRawSync(listStatsShownAtom);
  const stats = useAtomValueRawSync(playStatsAtom);
  const statsShown = form === 'wall' ? isStatsField(sort.field) : listStatsShown;
  const notice = useAtomValueRawSync(trackActionsNoticeAtom);
  const objects = useService(objectOpenerKey);
  const detailNotice = useAtomValueRawSync(objects.notice);
  const albums = useService(albumsKey);
  const trackActions = useService(trackActionsKey);
  const classes = useStyles();
  const viewControls = useViewControlStyles();
  const retry = (
    <MessageBarActions>
      <Button
        className={viewControls.field}
        size="small"
        onClick={() => void albums.browse.retry()}
      >
        {t('album.retry')}
      </Button>
    </MessageBarActions>
  );
  return (
    <>
      {list.status === 'failed' && (
        <MessageBar className={classes.bar} intent="error" data-album-notice="read">
          <MessageBarBody>{t('album.readFailed')}</MessageBarBody>
          {retry}
        </MessageBar>
      )}
      {statsShown && (stats.probeFailed || stats.readFailed) && (
        <MessageBar className={classes.bar} intent="error" data-album-notice="stats">
          <MessageBarBody>
            {t(
              stats.probeFailed
                ? 'query.statsProbeFailed'
                : stats.generation === tracks.generation && stats.byHandle?.size
                  ? 'query.statsPartial'
                  : 'query.statsReadFailed',
            )}
          </MessageBarBody>
          <MessageBarActions>
            <Button
              className={viewControls.field}
              size="small"
              disabled={stats.loading}
              onClick={() => {
                if (stats.probeFailed) void albumList.stats.probe();
                else if (tracks.status === 'ready')
                  void albumList.stats.fetch([...tracks.byHandle.values()], tracks.generation);
                else void albumList.tracks.retry();
              }}
            >
              {t('album.retry')}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}
      {form === 'wall' && needsAlbumTracks(sort.field) && tracks.status === 'failed' && (
        <MessageBar className={classes.bar} intent="error">
          <MessageBarBody>{t('albumDetail.readFailed')}</MessageBarBody>
          <MessageBarActions>
            <Button
              className={viewControls.field}
              size="small"
              onClick={() => void albumList.tracks.retry()}
            >
              {t('album.retry')}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}
      {dimension === 'artist' && credits.status === 'failed' && (
        <MessageBar className={classes.bar} intent="error" data-album-notice="credits">
          <MessageBarBody>{t('album.creditsFailed')}</MessageBarBody>
          {retry}
        </MessageBar>
      )}
      {detailNotice && (
        <MessageBar className={classes.bar} intent="warning" data-album-notice="detail">
          <MessageBarBody>{t(detailNotice)}</MessageBarBody>
          <MessageBarActions
            containerAction={
              <Button
                appearance="transparent"
                size="small"
                icon={<Dismiss16Regular />}
                aria-label={t('album.dismiss')}
                onClick={objects.dismissNotice}
              />
            }
          />
        </MessageBar>
      )}
      {notice && (
        <MessageBar className={classes.bar} intent="warning" data-album-notice="action">
          <MessageBarBody>{t(notice)}</MessageBarBody>
          <MessageBarActions
            containerAction={
              <Button
                appearance="transparent"
                size="small"
                icon={<Dismiss16Regular />}
                aria-label={t('album.dismiss')}
                onClick={trackActions.dismissNotice}
              />
            }
          />
        </MessageBar>
      )}
    </>
  );
}
