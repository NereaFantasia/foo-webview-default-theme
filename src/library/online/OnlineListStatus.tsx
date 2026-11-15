import { Button, MessageBar, MessageBarActions, MessageBarBody } from '@fluentui/react-components';
import { ErrorCircle48Regular, Search48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { MusicClientFailureCode } from '../../playback/musicClient.ts';
import { NcmSetupPanel, OnlineMessage, OnlineUnavailable } from '../search/online/OnlineEmpty.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { failureDetail } from './onlineFailure.ts';
import styles from './OnlineListStatus.module.css';

/** 在线列表页页头下面可以关掉的警告条：入队失败、对象菜单的动作失败之类，写 `notice` 那条文案 */
export function OnlineNotice({
  notice,
  onDismiss,
}: {
  readonly notice: MessageKey;
  onDismiss(): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  return (
    <MessageBar className={styles.notice} intent="warning" data-online-list-notice>
      <MessageBarBody>{t(notice)}</MessageBarBody>
      <MessageBarActions>
        <Button className={viewControls.field} size="small" onClick={onDismiss}>
          {t('album.dismiss')}
        </Button>
      </MessageBarActions>
    </MessageBar>
  );
}

/**
 * 在线内容获取失败时的界面展示：未安装网易云组件展示安装面板，服务不可用展示重连面板
 * 资源不存在且指定了 `missing` 时展示空状态提示，不提供重试；其余错误展示 `title`、错误原因与重试按钮
 */
export function OnlineFailureView({
  failure,
  retry,
  title,
  missing,
}: {
  readonly failure: MusicClientFailureCode | null;
  retry(): void;
  readonly title: string;
  readonly missing?: string;
}) {
  const t = useAtomValueRawSync(translateAtom);
  if (failure === 'not-installed') return <NcmSetupPanel onReady={retry} />;
  if (failure === 'backend-unavailable') return <OnlineUnavailable onRetry={retry} />;
  if (failure === 'not-found' && missing !== undefined)
    return <OnlineMessage icon={<Search48Regular />} title={missing} />;
  return (
    <OnlineMessage
      icon={<ErrorCircle48Regular />}
      title={title}
      detail={failure ? failureDetail(failure, t) : undefined}
      action={{ label: t('album.retry'), run: retry }}
    />
  );
}
