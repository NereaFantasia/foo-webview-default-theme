import { Button, MessageBar, MessageBarActions, MessageBarBody } from '@fluentui/react-components';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import styles from './PlaylistPage.module.css';
import type { PlaylistPageModel } from './usePlaylistPage.ts';
import { useService } from '../kit/useService.ts';
import { autoplaylistEditKey } from './autoplaylistEdit.ts';
import { hasSplitGroups } from './groups/groupLayout.ts';
import { playlistRowsKey } from './playlistRows.ts';
import { playlistPageKey } from './playlistPageServices.ts';

interface NoticeProps {
  readonly intent: 'error' | 'warning' | 'info';
  readonly kind: string;
  readonly text: MessageKey;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly action?: { readonly label: MessageKey; readonly run: () => void };
}

function Notice({ intent, kind, text, params, action }: NoticeProps) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  return (
    <MessageBar className={styles.notice} intent={intent} data-playlist-notice={kind}>
      <MessageBarBody>{t(text, params)}</MessageBarBody>
      {action && (
        <MessageBarActions>
          <Button className={viewControls.field} size="small" onClick={action.run}>
            {t(action.label)}
          </Button>
        </MessageBarActions>
      )}
    </MessageBar>
  );
}

export interface PlaylistPageNoticesProps {
  readonly guid: string;
  readonly model: PlaylistPageModel;
  readonly selectionPlay: { readonly failed: boolean; readonly dismiss: () => void };
}

/**
 * 播放列表页表格上方的横幅：列表删了、连不上宿主、取行失败（带重试）、分组退回扁平、选中可能与宿主不一致、
 * 命令没办成、定位没找到，以及命中太多只显示了前一截。可收起的都带「关闭」，下一次成功时不自动收起的由
 * 各服务的失败标记管
 *
 * 锁定的列表宿主不让重排，同一组的曲目拆成几段时给一条横幅，跟着列表此刻的样子走、不记关闭：
 * 换了不分组、换了依据或在宿主里改了排序，条件不成立它就没了。自动播放列表带编辑入口，排序在它自己的设置里
 */
export function PlaylistPageNotices({ guid, model, selectionPlay }: PlaylistPageNoticesProps) {
  const playlistRows = useService(playlistRowsKey);
  const autoplaylistEdit = useService(autoplaylistEditKey);
  const page = useService(playlistPageKey);
  const selectionFailed = useAtomValueRawSync(page.selection.failedAtom);
  const tracksFailed = useAtomValueRawSync(page.tracks.failedAtom);
  const menuFailed = useAtomValueRawSync(page.menu.failedAtom);
  const locateFailed = useAtomValueRawSync(page.locate.failedAtom);
  const { rows, groups, filter, entry } = model;
  const split = useMemo(() => hasSplitGroups(groups.runs), [groups.runs]);
  const dismiss = (run: () => void) => ({ label: 'album.dismiss' as const, run });
  if (rows.status === 'gone')
    return <Notice intent="warning" kind="gone" text="playlistPage.gone" />;
  if (rows.status === 'disconnected') {
    return <Notice intent="warning" kind="disconnected" text="host.unavailable" />;
  }
  return (
    <>
      {rows.readFailed && (
        <Notice
          intent="error"
          kind="read"
          text="playlistPage.readFailed"
          action={{ label: 'album.retry', run: () => playlistRows.retry(guid) }}
        />
      )}
      {groups.failure && (
        <Notice
          intent="warning"
          kind="groups"
          text={
            groups.failure === 'tooMany'
              ? 'playlistPage.groupsTooMany'
              : 'playlistPage.groupsUnavailable'
          }
          action={dismiss(() => page.groups.dismissFailure(guid))}
        />
      )}
      {entry?.isLocked && split && !filter.active && (
        <Notice
          intent="warning"
          kind="groupsLocked"
          text={
            entry.isAutoplaylist ? 'playlistPage.groupsLockedAuto' : 'playlistPage.groupsLocked'
          }
          action={
            entry.isAutoplaylist
              ? {
                  label: 'playlistPage.editAutoplaylist',
                  run: () => autoplaylistEdit.open(guid),
                }
              : undefined
          }
        />
      )}
      {selectionFailed && (
        <Notice
          intent="warning"
          kind="selection"
          text="playlistPage.selectionFailed"
          action={dismiss(() => page.selection.dismissFailure())}
        />
      )}
      {(tracksFailed || menuFailed || selectionPlay.failed) && (
        <Notice
          intent="warning"
          kind="command"
          text="playlistPage.commandFailed"
          action={dismiss(() => {
            page.tracks.dismissFailure();
            page.menu.dismissFailure();
            selectionPlay.dismiss();
          })}
        />
      )}
      {locateFailed && (
        <Notice
          intent="warning"
          kind="locate"
          text="playlistPage.locateFailed"
          action={dismiss(() => page.locate.dismissFailure())}
        />
      )}
      {filter.active && filter.truncated && (
        <Notice
          intent="info"
          kind="truncated"
          text="playlistPage.truncated"
          params={{ count: filter.hits.length }}
        />
      )}
    </>
  );
}
