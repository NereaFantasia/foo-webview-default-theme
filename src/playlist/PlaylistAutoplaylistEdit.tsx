import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Tooltip,
} from '@fluentui/react-components';
import { Edit20Regular } from '@fluentui/react-icons';
import type { PlaylistInfo } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { AutoplaylistDialog } from '../track/autoplaylist/AutoplaylistDialog.tsx';
import {
  autoplaylistEditAtom,
  autoplaylistEditKey,
  type AutoplaylistRead,
} from './autoplaylistEdit.ts';
import { playlistActionsKey } from './playlistActions.ts';

/** 页头里的「编辑自动播放列表」键：只有自动播放列表才有，点了开对话框 */
export function AutoplaylistEditButton({ entry }: { readonly entry: PlaylistInfo | undefined }) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const edit = useService(autoplaylistEditKey);
  if (!entry?.isAutoplaylist) return null;
  return (
    <Tooltip content={t('playlistPage.editAutoplaylist')} relationship="label">
      <Button
        appearance="subtle"
        className={controls.icon}
        icon={<Edit20Regular />}
        onClick={() => edit.open(entry.guid)}
        data-playlist-edit-auto
      />
    </Tooltip>
  );
}

/**
 * 编辑对话框的挂载点，装配层挂一份：入口（页头的键、横幅上的键、侧边栏的右键菜单）只设「正在编辑哪张」，
 * 这里按它开合；侧边栏在任何页面都能右键、也可能被藏起来，所以不挂在某个页面或侧边栏里
 * 打开时现读列表的规则，读得到开编辑对话框，读不到只给「打开原生智能列表属性」；挂载不看列表此刻还是不是
 * 自动播放列表，保存途中它会暂时是普通列表
 */
export function AutoplaylistEditHost() {
  const guid = useAtomValueRawSync(autoplaylistEditAtom);
  return guid === null ? null : <EditFlow key={guid} guid={guid} />;
}

function EditFlow({ guid }: { readonly guid: string }) {
  const edit = useService(autoplaylistEditKey);
  const actions = useService(playlistActionsKey);
  const [read, setRead] = useState<AutoplaylistRead | null>(null);
  // 关掉后焦点回到打开它的那一处：入口都在点下的那一刻持有焦点（右键菜单先把焦点还给那一行再动手），
  // 对话框没有触发键，Fluent 不会交还
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  );
  useEffect(
    () => () => {
      if (opener?.isConnected) opener.focus();
    },
    [opener],
  );
  useEffect(() => {
    let live = true;
    void edit.read(guid).then((result) => live && setRead(result));
    return () => {
      live = false;
    };
  }, [edit, guid]);
  const native = () => {
    edit.close();
    void actions.editAutoplaylist(guid);
  };
  if (read === null) return null;
  if (read.status === 'readable') {
    return (
      <AutoplaylistDialog
        mode="edit"
        initial={{ name: '', ...read.rules }}
        playcountMissing={false}
        onSubmit={async (request) => {
          const saved = await edit.save(guid, request);
          return saved === 'saved' ? 'done' : saved === 'kept' ? 'failed' : 'lost';
        }}
        onNative={native}
        onClose={edit.close}
      />
    );
  }
  return <UnreadableDialog onNative={native} onClose={edit.close} />;
}

/** 读不到规则的列表（第三方提供者、旧式锁、旧版宿主）：不开自绘编辑，只给 foobar2000 自带的编辑器 */
function UnreadableDialog(props: { onNative(): void; onClose(): void }) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && props.onClose()}>
      <DialogSurface data-autoplaylist-unreadable>
        <DialogBody>
          <DialogTitle>{t('autoplaylist.editTitle')}</DialogTitle>
          <DialogContent>{t('autoplaylist.unreadable')}</DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={props.onNative} data-autoplaylist-native>
              {t('autoplaylist.native')}
            </Button>
            <Button appearance="secondary" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
