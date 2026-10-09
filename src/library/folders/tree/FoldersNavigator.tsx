import {
  mergeClasses,
  Button,
  Input,
  Spinner,
  Tooltip,
  makeStyles,
} from '@fluentui/react-components';
import {
  ArrowLeft20Regular,
  Dismiss16Regular,
  Folder20Regular,
  Search20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { translateAtom } from '../../../i18n/locale.ts';
import { useCommand } from '../../../nav/useCommand.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { foldersPrefsAtom } from '../foldersPrefs.ts';
import { FoldersTree, type FoldersTreeHandle } from './FoldersTree.tsx';
import { foldersFilterAtom } from './foldersFilter.ts';
import type { FolderNode } from './foldersModel.ts';
import { foldersTreeAtom } from './foldersTree.ts';
import styles from './FoldersNavigator.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { LibraryDrawerToolsContext } from '../../split-view/LibraryDrawer.tsx';

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
  const controls = useViewControlStyles();
  const drawerTools = useContext(LibraryDrawerToolsContext);
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const filter = useAtomValueRawSync(foldersFilterAtom);
  const catalog = useAtomValueRawSync(foldersTreeAtom);
  const prefs = useAtomValueRawSync(foldersPrefsAtom);
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
  const showPins = !filter.text && prefs.pins.length > 0;
  const back = open && (
    <Button
      className={controls.icon}
      appearance="transparent"
      icon={<ArrowLeft20Regular />}
      aria-label={t('folders.endLocate')}
      onClick={close}
    />
  );
  const find = (
    <Tooltip content={t('folders.locate')} relationship="label">
      <Button
        className={controls.icon}
        ref={search}
        appearance="transparent"
        icon={<Search20Regular />}
        onClick={() => {
          setOpen(true);
          input.current?.focus();
        }}
      />
    </Tooltip>
  );
  return (
    <div className={styles.root}>
      {drawerTools === undefined ? (
        <div className={styles.header}>
          {back}
          <span>{t('folders.directory')}</span>
          {find}
        </div>
      ) : drawerTools ? (
        createPortal(
          <>
            {back}
            {find}
          </>,
          drawerTools,
        )
      ) : null}
      {open && (
        <div className={styles.locator}>
          <Input
            className={mergeClasses(classes.input, controls.field)}
            ref={input}
            value={filter.text}
            contentBefore={<Search20Regular />}
            aria-label={t('folders.locate')}
            placeholder={t('folders.locatePlaceholder')}
            onChange={(_, data) => folders.filter.setText(data.value)}
            contentAfter={
              filter.text ? (
                <Button
                  className={controls.icon}
                  appearance="transparent"
                  size="small"
                  icon={<Dismiss16Regular />}
                  aria-label={t('folders.clear')}
                  onClick={() => folders.filter.setText('')}
                />
              ) : undefined
            }
          />
        </div>
      )}
      {showPins && (
        <div className={styles.pins}>
          <span className={styles.label}>{t('folders.pins')}</span>
          {prefs.pins.map((pin) => (
            <Button
              key={pin.key}
              appearance="subtle"
              className={mergeClasses(classes.pin, controls.icon)}
              icon={<Folder20Regular />}
              title={pin.name}
              onClick={() => void folders.visit(pin.key)}
            >
              <span className={styles.name}>{pin.name}</span>
            </Button>
          ))}
        </div>
      )}
      {showPins && <span className={styles.label}>{t('folders.tree')}</span>}
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
    </div>
  );
}
