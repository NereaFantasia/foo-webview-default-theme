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
import { Add20Regular, Pin20Regular, PinOff20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useHomeServices } from './homeContext.ts';
import { HOME_PIN_LIMIT, homePinKey, type HomePin } from './homePins.ts';
import styles from './HomePins.module.css';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

const PIN_LABELS = {
  album: 'place.albums',
  playlist: 'place.playlists',
  channel: 'home.channels',
} as const;

export function HomePins() {
  const viewControls = useViewControlStyles();
  const home = useHomeServices();
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(home.pins.state);
  const choices = useAtomValueRawSync(home.pinChoices);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<HomePin['kind']>('album');
  const [search, setSearch] = useState('');
  const byKey = new Map(choices.map((pin) => [homePinKey(pin), pin]));
  const pinned = new Set(state.items.map(homePinKey));
  const filtered = choices.filter(
    (pin) =>
      pin.kind === kind && pin.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const failure = (
    <>
      {state.readFailed && (
        <p role="alert">
          {t('home.pinsReadFailed')}{' '}
          <Button className={viewControls.field} onClick={home.pins.retry}>
            {t('album.retry')}
          </Button>
        </p>
      )}
      {state.saveFailed && <p role="alert">{t('home.pinsSaveFailed')}</p>}
    </>
  );
  return (
    <section aria-label={t('home.pins')} data-home-section="pins">
      <header className={styles.header}>
        <h2>{t('home.pins')}</h2>
        <Tooltip content={t('home.addPin')} relationship="label">
          <Button
            appearance="subtle"
            className={viewControls.icon}
            icon={<Add20Regular />}
            aria-label={t('home.addPin')}
            onClick={() => setOpen(true)}
          />
        </Tooltip>
      </header>
      {failure}
      {!state.items.length && !state.readFailed && <p>{t('home.noPins')}</p>}
      <div className={styles.list}>
        {state.items.map((saved) => {
          const current = byKey.get(homePinKey(saved));
          return (
            <div key={homePinKey(saved)} className={styles.row} data-home-item={homePinKey(saved)}>
              <Pin20Regular aria-hidden />
              <button
                type="button"
                className={styles.target}
                disabled={!current}
                title={current?.name ?? saved.name}
                onClick={() => current && home.openPin(current)}
              >
                <span>{current?.name ?? saved.name}</span>
                <small>{t(current ? PIN_LABELS[current.kind] : 'home.pinUnavailable')}</small>
              </button>
              <Tooltip content={t('home.unpin')} relationship="label">
                <Button
                  appearance="subtle"
                  className={viewControls.icon}
                  icon={<PinOff20Regular />}
                  aria-label={t('home.unpin')}
                  onClick={() => home.pins.toggle(saved)}
                />
              </Tooltip>
            </div>
          );
        })}
      </div>
      <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('home.addPin')}</DialogTitle>
            <DialogContent>
              {failure}
              <TabList
                selectedValue={kind}
                onTabSelect={(_, data) => {
                  if (
                    data.value === 'album' ||
                    data.value === 'playlist' ||
                    data.value === 'channel'
                  )
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
                      <Tooltip
                        content={t(checked ? 'home.unpin' : 'home.pin')}
                        relationship="label"
                      >
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
              {filtered.length > 50 && (
                <p>{t('home.pinMatchesLimit', { total: filtered.length })}</p>
              )}
              {state.items.length >= HOME_PIN_LIMIT && (
                <p>{t('home.pinLimit', { count: HOME_PIN_LIMIT })}</p>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpen(false)}>{t('home.done')}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}
