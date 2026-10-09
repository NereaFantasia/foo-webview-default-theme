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
import {
  Add20Regular,
  Delete20Regular,
  Edit20Regular,
  Library20Regular,
  MoreHorizontal20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { ContextMenu } from '../../kit/context-menu/ContextMenu.tsx';
import type { TablePoint } from '../../table/tableItems.ts';
import type { HomeChannel } from './homeChannels.ts';
import { useHomeServices } from './homeContext.ts';
import { HomeChannelDialog } from './HomeChannelDialog.tsx';
import { HOME_CHANNEL_TEMPLATES, type HomeChannelDraft } from './homeChannelTemplates.ts';
import styles from './HomeChannels.module.css';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

export function HomeChannels() {
  const viewControls = useViewControlStyles();
  const home = useHomeServices();
  const t = useAtomValueRawSync(translateAtom);
  const channels = useAtomValueRawSync(home.channels.state);
  const busy = useAtomValueRawSync(home.busy);
  const feed = useAtomValueRawSync(home.feed.state);
  const [draft, setDraft] = useState<HomeChannelDraft | undefined>();
  const [editing, edit] = useState<HomeChannel | null | undefined>(undefined);
  const [deleting, remove] = useState<HomeChannel | null>(null);
  const [menu, setMenu] = useState<{ channel: HomeChannel; at: TablePoint } | null>(null);
  const target = menu?.channel;
  return (
    <section aria-label={t('home.channels')} data-home-section="channels">
      <header className={styles.header}>
        <h2>{t('home.channels')}</h2>
        <Button
          className={viewControls.field}
          icon={<Add20Regular />}
          disabled={channels.status !== 'ready' || channels.saving || channels.items.length >= 100}
          onClick={() => {
            setDraft(undefined);
            edit(null);
          }}
        >
          {t('home.newChannel')}
        </Button>
      </header>
      <div className={styles.templates} aria-label={t('home.templates')}>
        {HOME_CHANNEL_TEMPLATES.map((template) => (
          <Tooltip
            key={template.id}
            content={t(
              template.statistics && feed.available !== true
                ? 'query.needsPlaycount'
                : 'home.newChannel',
            )}
            relationship="description"
          >
            <Button
              className={viewControls.field}
              icon={<Add20Regular />}
              disabledFocusable={
                channels.status !== 'ready' ||
                channels.saving ||
                channels.items.length >= 100 ||
                (template.statistics && feed.available !== true)
              }
              onClick={() => {
                setDraft({ name: t(template.label), query: template.query, sort: 'random' });
                edit(null);
              }}
            >
              {t(template.label)}
            </Button>
          </Tooltip>
        ))}
      </div>
      {channels.status === 'failed' && (
        <p role="alert">
          {t('home.channelsFailed')}{' '}
          <Button className={viewControls.field} onClick={() => void home.channels.retry()}>
            {t('album.retry')}
          </Button>
        </p>
      )}
      {channels.status === 'loading' && <p role="status">{t('album.loading')}</p>}
      {channels.status === 'ready' && !channels.items.length && <p>{t('home.noChannels')}</p>}
      <div className={styles.list}>
        {channels.items.map((channel) => (
          <div key={channel.id} className={styles.row} data-home-item={channel.id}>
            <Library20Regular aria-hidden />
            <div className={styles.metadata}>
              <button
                type="button"
                className={styles.name}
                onClick={() => home.openChannel(channel)}
                title={channel.name}
              >
                {channel.name}
              </button>
              <span className={styles.query} title={channel.query}>
                {channel.query}
              </span>
            </div>
            <Tooltip content={t('menu.more')} relationship="label">
              <Button
                appearance="subtle"
                className={viewControls.icon}
                icon={<MoreHorizontal20Regular />}
                aria-label={t('menu.more')}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ channel, at: { x: rect.left, y: rect.bottom } });
                }}
              />
            </Tooltip>
          </div>
        ))}
      </div>
      <ContextMenu
        at={menu?.at ?? null}
        title={target?.name ?? ''}
        targetKey={target?.id ?? ''}
        backLabel={t('context.back')}
        onClose={() => setMenu(null)}
        isCurrent={() => !!target && channels.items.includes(target)}
        items={
          target
            ? [
                {
                  kind: 'command',
                  id: 'edit',
                  label: t('home.editChannel'),
                  icon: <Edit20Regular />,
                  disabled: channels.saving,
                  onSelect: () => edit(target),
                },
                {
                  kind: 'command',
                  id: 'delete',
                  label: t('home.deleteChannel'),
                  icon: <Delete20Regular />,
                  disabled: channels.saving,
                  onSelect: () => remove(target),
                },
                {
                  kind: 'command',
                  id: 'autoplaylist',
                  label: t('home.autoplaylist'),
                  icon: <Library20Regular />,
                  disabled: busy,
                  onSelect: () => void home.createAutoplaylist(target),
                },
              ]
            : []
        }
      />
      {editing !== undefined && (
        <HomeChannelDialog channel={editing} draft={draft} onClose={() => edit(undefined)} />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(_, data) => {
          if (!data.open && !channels.saving) remove(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('home.deleteChannel')}</DialogTitle>
            <DialogContent>
              {t('home.deleteQuestion', { name: deleting?.name ?? '' })}
              {channels.saveFailed && <p role="alert">{t('home.savedFailed')}</p>}
            </DialogContent>
            <DialogActions>
              <Button disabled={channels.saving} onClick={() => remove(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                appearance="primary"
                disabled={channels.saving}
                onClick={() => {
                  if (deleting)
                    void home.channels.remove(deleting.id).then((ok) => {
                      if (ok) remove(null);
                    });
                }}
              >
                {t('home.deleteChannel')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}
