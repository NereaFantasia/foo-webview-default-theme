import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Tab,
  TabList,
  ToggleButton,
  Tooltip,
} from '@fluentui/react-components';
import { Pin20Regular, PinOff20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { useHomeServices } from './homeContext.ts';
import { HOME_PIN_LIMIT, homePinKey, type HomePin } from './homePins.ts';
import styles from './HomePinDialog.module.css';

/** 固定入口的管理对话框：按种类查找专辑、播放列表与频道，逐项固定或取消固定 */
export function HomePinDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const viewControls = useViewControlStyles();
  const home = useHomeServices();
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(home.pins.state);
  const choices = useAtomValueRawSync(home.pinChoices);
  const [kind, setKind] = useState<HomePin['kind']>('album');
  const [search, setSearch] = useState('');
  const pinned = new Set(state.items.map(homePinKey));
  const filtered = choices.filter(
    (pin) =>
      pin.kind === kind && pin.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('home.addPin')}</DialogTitle>
          <DialogContent>
            {state.readFailed && (
              <p role="alert">
                {t('home.pinsReadFailed')}{' '}
                <Button className={viewControls.field} onClick={home.pins.retry}>
                  {t('album.retry')}
                </Button>
              </p>
            )}
            {state.saveFailed && <p role="alert">{t('home.pinsSaveFailed')}</p>}
            <TabList
              selectedValue={kind}
              onTabSelect={(_, data) => {
                if (data.value === 'album' || data.value === 'playlist' || data.value === 'channel')
                  setKind(data.value);
              }}
            >
              <Tab value="album">{t('place.albums')}</Tab>
              <Tab value="playlist">{t('place.playlists')}</Tab>
              <Tab value="channel">{t('home.channels')}</Tab>
            </TabList>
            <div className={styles.search}>
              <Input
                aria-label={t('home.findPin')}
                placeholder={t('home.findPin')}
                value={search}
                onChange={(_, data) => setSearch(data.value)}
              />
            </div>
            <div className={styles.choices}>
              {filtered.slice(0, 50).map((pin) => {
                const checked = pinned.has(homePinKey(pin));
                return (
                  <div key={homePinKey(pin)} className={styles.row}>
                    <span className={styles.name} title={pin.name}>
                      {pin.name}
                    </span>
                    <Tooltip content={t(checked ? 'home.unpin' : 'home.pin')} relationship="label">
                      <ToggleButton
                        icon={checked ? <PinOff20Regular /> : <Pin20Regular />}
                        checked={checked}
                        aria-label={`${t(checked ? 'home.unpin' : 'home.pin')} ${pin.name}`}
                        disabled={
                          state.readFailed || (!checked && state.items.length >= HOME_PIN_LIMIT)
                        }
                        onClick={() => home.pins.toggle(pin)}
                      />
                    </Tooltip>
                  </div>
                );
              })}
              {!filtered.length && <p>{t('home.noPinMatches')}</p>}
            </div>
            {filtered.length > 50 && <p>{t('home.pinMatchesLimit', { total: filtered.length })}</p>}
            {state.items.length >= HOME_PIN_LIMIT && (
              <p>{t('home.pinLimit', { count: HOME_PIN_LIMIT })}</p>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t('home.done')}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
