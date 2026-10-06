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
import { albumDetailNoticeAtom } from '../album-detail/albumDetailOpen.ts';
import { albumsAtom } from '../albums.ts';
import { artistCreditsAtom } from './artistCredits.ts';
import { browserPrefsAtom } from './browserPrefs.ts';
import { useService } from '../../kit/useService.ts';
import { trackActionsKey, trackActionsNoticeAtom } from '../../track/trackActions.ts';
import { albumsKey } from '../albumServices.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';

const useStyles = makeStyles({
  bar: { margin: `0 ${tokens.spacingHorizontalXXL} ${tokens.spacingVerticalS}` },
});

/**
 * 页头下的横幅：专辑清单读失败（手上的旧清单照旧显示）、艺术家档的署名表读失败，各带重试；
 * 进详情页没进成、起播与菜单命令的失败或「上一个还没做完」可以关掉。
 */
export function AlbumNotices() {
  const t = useAtomValueRawSync(translateAtom);
  const list = useAtomValueRawSync(albumsAtom);
  const credits = useAtomValueRawSync(artistCreditsAtom);
  const { dimension } = useAtomValueRawSync(browserPrefsAtom);
  const notice = useAtomValueRawSync(trackActionsNoticeAtom);
  const detailNotice = useAtomValueRawSync(albumDetailNoticeAtom);
  const albums = useService(albumsKey);
  const trackActions = useService(trackActionsKey);
  const albumDetail = useService(albumDetailKey);
  const classes = useStyles();
  const retry = (
    <MessageBarActions>
      <Button size="small" onClick={() => void albums.browse.retry()}>
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
                onClick={albumDetail.dismissNotice}
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
