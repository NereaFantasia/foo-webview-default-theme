import { Button, MessageBar, MessageBarActions, MessageBarBody } from '@fluentui/react-components';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { songsActionsNoticeAtom } from './songsActions.ts';
import styles from './SongsPage.module.css';
import type { SongsPageModel } from './useSongsPage.ts';
import { useService } from '../../kit/useService.ts';
import { trackActionsKey, trackActionsNoticeAtom } from '../../track/trackActions.ts';
import { songsKey } from './songsServices.ts';
import { albumListKey } from '../album-list/albumList.ts';
import { objectOpenerKey } from '../../nav/objectOpener.ts';

interface NoticeProps {
  readonly kind: string;
  readonly text: MessageKey;
  readonly action: { readonly label: MessageKey; readonly run: () => void };
}

function Notice({ kind, text, action }: NoticeProps) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  return (
    <MessageBar className={styles.notice} intent="error" data-songs-notice={kind}>
      <MessageBarBody>{t(text)}</MessageBarBody>
      <MessageBarActions>
        <Button className={viewControls.field} size="small" onClick={action.run}>
          {t(action.label)}
        </Button>
      </MessageBarActions>
    </MessageBar>
  );
}

/**
 * 表格上方的横幅：整库曲目、歌曲页的顺序或显示中的播放统计读取失败（带重试，手上的旧结果照旧显示），
 * 起播与成批命令没办成（可关）
 */
export function SongsNotices({ model }: { readonly model: SongsPageModel }) {
  const songs = useService(songsKey);
  const albumList = useService(albumListKey);
  const trackActions = useService(trackActionsKey);
  const objects = useService(objectOpenerKey);
  const notice = useAtomValueRawSync(songsActionsNoticeAtom);
  const menuNotice = useAtomValueRawSync(trackActionsNoticeAtom);
  const detailNotice = useAtomValueRawSync(objects.notice);
  return (
    <>
      {model.library.status === 'failed' && (
        <Notice
          kind="library"
          text="songs.readFailed"
          action={{ label: 'album.retry', run: () => void albumList.tracks.retry() }}
        />
      )}
      {model.rows.status === 'failed' && (
        <Notice
          kind="rows"
          text="songs.readFailed"
          action={{ label: 'album.retry', run: () => void songs.rows.retry() }}
        />
      )}
      {model.stats.failed && (
        <Notice
          kind="stats"
          text={model.stats.failed}
          action={{ label: 'album.retry', run: model.stats.retry }}
        />
      )}
      {notice && (
        <Notice
          kind="command"
          text={notice}
          action={{ label: 'album.dismiss', run: () => songs.actions.dismissNotice() }}
        />
      )}
      {menuNotice && (
        <Notice
          kind="menu"
          text={menuNotice}
          action={{ label: 'album.dismiss', run: trackActions.dismissNotice }}
        />
      )}
      {detailNotice && (
        <Notice
          kind="detail"
          text={detailNotice}
          action={{ label: 'album.dismiss', run: objects.dismissNotice }}
        />
      )}
    </>
  );
}
