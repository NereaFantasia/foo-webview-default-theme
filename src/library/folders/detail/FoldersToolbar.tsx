import {
  Button,
  Dropdown,
  Option,
  Slider,
  ToggleButton,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  useRestoreFocusTarget,
} from '@fluentui/react-components';
import {
  ArrowSync20Regular,
  ArrowUp20Regular,
  ChevronRight16Regular,
  Grid20Regular,
  List20Regular,
  PanelLeft20Regular,
  Pin20Regular,
  PinOff20Regular,
  Table20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { ColumnMenu } from '../../../table/columns/ColumnMenu.tsx';
import type { TablePoint } from '../../../table/tableItems.ts';
import { foldersTreeAtom } from '../tree/foldersTree.ts';
import type { FoldersView } from './useFoldersView.ts';
import styles from './FoldersToolbar.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';

const useStyles = makeStyles({
  slider: { width: '128px', minWidth: '128px' },
  segment: {
    minWidth: '0',
    minHeight: '26px',
    height: '26px',
    flex: '1 0 auto',
    borderRadius: tokens.borderRadiusSmall,
    paddingInline: tokens.spacingHorizontalM,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
    whiteSpace: 'nowrap',
    '&[aria-pressed="true"]': {
      color: tokens.colorBrandForeground1,
      fontWeight: tokens.fontWeightSemibold,
    },
  },
  density: { minWidth: 0, width: '128px' },
  view: { paddingInline: tokens.spacingHorizontalS },
});
export interface FoldersToolbarProps {
  readonly model: FoldersView;
  readonly compact: boolean;
  onDirectory(): void;
}
export function FoldersToolbar({ model, compact, onDirectory }: FoldersToolbarProps) {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const catalog = useAtomValueRawSync(foldersTreeAtom);
  const { preview, prefs } = model;
  const classes = useStyles();
  const drawerTrigger = useRestoreFocusTarget();
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<TablePoint | null>(null);
  const node = preview.node;
  const path = [];
  let entry = node;
  while (entry) {
    path.unshift(entry);
    entry = entry.parent ? (catalog.nodes.get(entry.parent) ?? null) : null;
  }
  const pinned = prefs.pins.some((pin) => pin.key === node?.key);
  return (
    <div ref={root} className={styles.root}>
      <div className={styles.path}>
        {compact && (
          <Button
            className={controls.icon}
            {...drawerTrigger}
            appearance="transparent"
            icon={<PanelLeft20Regular />}
            onClick={onDirectory}
          >
            {t('folders.directory')}
          </Button>
        )}
        {!compact && (
          <Tooltip content={t('folders.parent')} relationship="label">
            <Button
              className={controls.icon}
              appearance="transparent"
              icon={<ArrowUp20Regular />}
              disabled={!node?.parent}
              onClick={() => node?.parent && void folders.visit(node.parent)}
            />
          </Tooltip>
        )}
        <nav className={styles.crumbs} aria-label={t('folders.path')}>
          {path.map((part, index) => (
            <span key={part.key} className={styles.crumb}>
              {index > 0 && <ChevronRight16Regular />}
              <button
                type="button"
                title={part.absolutePath}
                aria-current={part.key === node?.key ? 'location' : undefined}
                onClick={() => void folders.visit(part.key)}
              >
                {part.name}
              </button>
            </span>
          ))}
        </nav>
        <div className={styles['path-actions']}>
          <Tooltip content={t(pinned ? 'folders.unpin' : 'folders.pin')} relationship="label">
            <Button
              className={controls.icon}
              appearance="transparent"
              icon={pinned ? <PinOff20Regular /> : <Pin20Regular />}
              disabled={!node || preview.nodes.length !== 1}
              onClick={() => node && folders.prefs.pin(node)}
            />
          </Tooltip>
          <Tooltip content={t('folders.refresh')} relationship="label">
            <Button
              className={controls.icon}
              appearance="transparent"
              icon={<ArrowSync20Regular />}
              disabled={catalog.status === 'loading'}
              onClick={() => void folders.tree.retry()}
            />
          </Tooltip>
        </div>
      </div>
      <div className={styles.controls}>
        <div className={styles.range} role="group" aria-label={t('folders.range')}>
          <div className={styles.segments}>
            <ToggleButton
              size="small"
              appearance="subtle"
              className={mergeClasses(classes.segment, controls.icon)}
              checked={prefs.recursive}
              onClick={() => folders.prefs.change({ recursive: true })}
            >
              {t('folders.recursive')}
            </ToggleButton>
            <ToggleButton
              size="small"
              appearance="subtle"
              className={mergeClasses(classes.segment, controls.icon)}
              checked={!prefs.recursive}
              onClick={() => folders.prefs.change({ recursive: false })}
            >
              {t('folders.direct')}
            </ToggleButton>
          </div>
        </div>
        <div className={styles.display}>
          <div className={styles.setting} role="group" aria-label={t('folders.view')}>
            <div className={styles.segments}>
              <Tooltip content={t('folders.listView')} relationship="label">
                <ToggleButton
                  size="small"
                  appearance="subtle"
                  className={mergeClasses(classes.segment, classes.view, controls.icon)}
                  checked={prefs.view === 'list'}
                  icon={<List20Regular />}
                  onClick={() => folders.prefs.change({ view: 'list' })}
                >
                  <span className={styles.label}>{t('folders.listView')}</span>
                </ToggleButton>
              </Tooltip>
              <Tooltip content={t('folders.coverView')} relationship="label">
                <ToggleButton
                  size="small"
                  appearance="subtle"
                  className={mergeClasses(classes.segment, classes.view, controls.icon)}
                  checked={prefs.view === 'covers'}
                  icon={<Grid20Regular />}
                  onClick={() => folders.prefs.change({ view: 'covers' })}
                >
                  <span className={styles.label}>{t('folders.coverView')}</span>
                </ToggleButton>
              </Tooltip>
            </div>
          </div>
          <div className={styles.adjustment}>
            {prefs.view === 'covers' ? (
              <Slider
                className={classes.slider}
                min={128}
                max={256}
                step={8}
                value={prefs.size}
                aria-label={t('folders.coverSize')}
                onChange={(_, data) => folders.prefs.change({ size: data.value })}
              />
            ) : (
              <Dropdown
                className={mergeClasses(classes.density, controls.field)}
                appearance="outline"
                aria-label={t('folders.density')}
                value={t(`folders.${prefs.density}`)}
                selectedOptions={[prefs.density]}
                onOptionSelect={(_, data) => {
                  const density = data.optionValue;
                  if (density === 'compact' || density === 'standard' || density === 'comfortable')
                    folders.prefs.change({ density });
                }}
              >
                <Option value="compact">{t('folders.compact')}</Option>
                <Option value="standard">{t('folders.standard')}</Option>
                <Option value="comfortable">{t('folders.comfortable')}</Option>
              </Dropdown>
            )}
          </div>
          <Tooltip content={t('folders.columns')} relationship="label">
            <Button
              className={controls.icon}
              appearance="transparent"
              icon={<Table20Regular />}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setAt({ x: rect.x, y: rect.bottom });
              }}
            />
          </Tooltip>
        </div>
      </div>
      <ColumnMenu at={at} columns={model.columns} root={root} onClose={() => setAt(null)} />
    </div>
  );
}
