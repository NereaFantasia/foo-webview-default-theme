import { Button, Input, Spinner, Tooltip, makeStyles } from '@fluentui/react-components';
import {
  ArrowLeft20Regular,
  Dismiss16Regular,
  Folder20Regular,
  Search20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { useCommand } from '../../../nav/useCommand.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { foldersPrefsAtom } from '../foldersPrefs.ts';
import { foldersPreviewAtom } from '../detail/foldersPreview.ts';
import { FoldersTree, type FoldersTreeHandle } from './FoldersTree.tsx';
import { foldersFilterAtom } from './foldersFilter.ts';
import type { FolderNode } from './foldersModel.ts';
import { foldersTreeAtom } from './foldersTree.ts';
import styles from './FoldersNavigator.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';

const useStyles = makeStyles({
  input: { width: '100%', minWidth: 0 },
  pin: { justifyContent: 'flex-start', width: '100%' },
});
export interface FoldersNavigatorProps {
  readonly active: boolean;
  readonly scroll: RefObject<HTMLDivElement | null>;
  readonly handle: RefObject<FoldersTreeHandle | null>;
  onMenu(nodes: readonly FolderNode[], point: TablePoint): void;
  onPlay(node: FolderNode): void;
}
export function FoldersNavigator(props: FoldersNavigatorProps) {
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const filter = useAtomValueRawSync(foldersFilterAtom);
  const catalog = useAtomValueRawSync(foldersTreeAtom);
  const prefs = useAtomValueRawSync(foldersPrefsAtom);
  const preview = useAtomValueRawSync(foldersPreviewAtom);
  const [open, setOpen] = useState(!!filter.text);
  const input = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLButtonElement>(null);
  const classes = useStyles();
  const id = useId();
  useEffect(() => {
    if (filter.text) setOpen(true);
  }, [filter.text]);
  function close() {
    folders.filter.setText('');
    setOpen(false);
    search.current?.focus();
  }
  useCommand({
    id: `folders.locator.close.${id}`,
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () => props.active && document.activeElement === input.current,
    run: () => (filter.text ? folders.filter.setText('') : close()),
  });
  useCommand({
    id: `folders.locator.search.${id}`,
    layer: 'input',
    keys: [{ key: 'Enter' }],
    enabled: () => props.active && document.activeElement === input.current,
    run: folders.filter.flush,
  });
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {open && (
          <Button
            appearance="transparent"
            icon={<ArrowLeft20Regular />}
            aria-label={t('folders.endLocate')}
            onClick={close}
          />
        )}
        <span>{t('folders.directory')}</span>
        <Tooltip content={t('folders.locate')} relationship="label">
          <Button
            ref={search}
            appearance="transparent"
            icon={<Search20Regular />}
            onClick={() => {
              setOpen(true);
              input.current?.focus();
            }}
          />
        </Tooltip>
      </div>
      {open && (
        <Input
          className={classes.input}
          ref={input}
          value={filter.text}
          contentBefore={<Search20Regular />}
          aria-label={t('folders.locate')}
          placeholder={t('folders.locatePlaceholder')}
          onChange={(_, data) => folders.filter.setText(data.value)}
          contentAfter={
            filter.text ? (
              <Button
                appearance="transparent"
                size="small"
                icon={<Dismiss16Regular />}
                aria-label={t('folders.clear')}
                onClick={() => folders.filter.setText('')}
              />
            ) : undefined
          }
        />
      )}
      {!filter.text && prefs.pins.length > 0 && (
        <div className={styles.pins}>
          <span className={styles.label}>{t('folders.pins')}</span>
          {prefs.pins.map((pin) => (
            <Button
              key={pin.key}
              appearance="subtle"
              className={classes.pin}
              icon={<Folder20Regular />}
              title={pin.name}
              onClick={() => void folders.visit(pin.key)}
            >
              <span className={styles.name}>{pin.name}</span>
            </Button>
          ))}
        </div>
      )}
      <span className={styles.label}>{t('folders.tree')}</span>
      {(catalog.status === 'loading' || filter.status === 'loading') && (
        <Spinner size="tiny" label={t('folders.loading')} />
      )}
      {filter.status === 'fallback' && (
        <p role="status" className={styles.hint}>
          {t('folders.filterFallback')}
        </p>
      )}
      <FoldersTree {...props} />
      {filter.status === 'ready' && filter.text && (
        <span className={styles.label}>{t('folders.located', { count: filter.matches })}</span>
      )}
      <span className={styles.label} title={preview.node?.absolutePath}>
        {t('folders.current', { name: preview.node?.name ?? '—' })}
      </span>
    </div>
  );
}
