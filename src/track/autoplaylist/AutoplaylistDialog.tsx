import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Label,
  makeStyles,
  Switch,
  tokens,
  Tooltip,
} from '@fluentui/react-components';
import { BookInformation20Regular, ErrorCircle16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { useService } from '../../kit/useService.ts';
import { QueryCopyButton, QueryEditor, type QueryEditorHandle } from '../QueryEditor.tsx';
import { SyntaxReferenceColumn, SyntaxReferencePanel } from '../syntax/SyntaxReference.tsx';
import type { ReferenceItem } from '../syntax/syntaxReference.ts';
import { issueText, type PanelGroup } from '../syntax/syntaxText.ts';
import {
  canCreate,
  conditionOf,
  previewLineOf,
  type AutoplaylistOutcome,
  type AutoplaylistRequest,
} from './autoplaylistForm.ts';
import { autoplaylistPreviewAtom, autoplaylistPreviewKey } from './autoplaylistPreview.ts';
import styles from './AutoplaylistDialog.module.css';

/** 预览条上不带位置的几种问题各写什么 */
const ERROR_KEY = {
  invalid: 'autoplaylist.invalid',
  failed: 'autoplaylist.countFailed',
  sortConflict: 'autoplaylist.sortConflict',
} as const;

/** 没提交成时写什么：按模式与结局，`lost` 只有编辑会走到 */
const FAILURE_KEY = {
  create: { failed: 'autoplaylist.createFailed', lost: 'autoplaylist.createFailed' },
  edit: { failed: 'autoplaylist.saveFailed', lost: 'autoplaylist.saveLost' },
} as const;

// 底部操作按钮均分宽度，紧凑内边距容纳原生属性按钮换行；覆盖 Fluent 按钮默认 minWidth 与内边距
const useButtonStyles = makeStyles({
  action: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: `calc((100% - 2 * ${tokens.spacingHorizontalS}) / 3)`,
    minWidth: 0,
    paddingLeft: tokens.spacingHorizontalXS,
    paddingRight: tokens.spacingHorizontalXS,
    textAlign: 'center',
  },
  // 按钮行占满对话框宽度并靠右对齐
  actions: { justifySelf: 'stretch', justifyContent: 'flex-end' },
  // 宽窗常驻参考栏，窄窗收为按钮；合并 Fluent 按钮的 display 属性
  reference: { display: 'none', '@media (max-width: 760px)': { display: 'inline-flex' } },
});

/** 排序框只用 Title Formatting，参考栏相应只列字段与函数 */
const SORT_GROUPS: readonly PanelGroup[] = ['field', 'function'];

export interface AutoplaylistDialogProps {
  /** `create` 新建，带名称；`edit` 改一张已有的列表，没有名称，规则没改时不能保存 */
  readonly mode: 'create' | 'edit';
  /** 打开时预填的内容；编辑时 `name` 不用 */
  readonly initial: AutoplaylistRequest;
  /** foo_playcount 确认没装：补全与参考里依赖它的字段标签变警示色 */
  readonly playcountMissing: boolean;
  /** 提交；`done` 对话框关闭，别的留着并写明为什么没成 */
  onSubmit(request: AutoplaylistRequest): Promise<AutoplaylistOutcome>;
  /** 编辑时按钮组最左的「打开原生属性」操作 */
  onNative?(): void;
  onClose(): void;
}

/**
 * 新建或编辑自动播放列表：名称（新建可用）、查询、排序与保持排序，显示宿主计算的命中数；宽窗常驻语法参考栏，窄窗收起为弹出面板
 * 提交条件：新建时名称非空，查询已由宿主返回命中数，编辑时规则存在变更
 * 快捷键：Ctrl+Enter 提交
 */
export function AutoplaylistDialog(props: AutoplaylistDialogProps) {
  const { mode, initial, playcountMissing, onSubmit, onNative, onClose } = props;
  const editing = mode === 'edit';
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const buttonStyles = useButtonStyles();
  const preview = useService(autoplaylistPreviewKey);
  const previewState = useAtomValueRawSync(autoplaylistPreviewAtom);
  const [name, setName] = useState(initial.name);
  const [query, setQuery] = useState(initial.query);
  const [sort, setSort] = useState(initial.sort);
  const [keepSorted, setKeepSorted] = useState(initial.keepSorted);
  const [active, setActive] = useState<'query' | 'sort'>('query');
  const [creating, setCreating] = useState(false);
  const [outcome, setOutcome] = useState<'failed' | 'lost' | null>(null);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [referenceButton, setReferenceButton] = useState<HTMLElement | null>(null);
  const editors = {
    query: useRef<QueryEditorHandle>(null),
    sort: useRef<QueryEditorHandle>(null),
  };
  const first = useRef(true);

  useEffect(() => {
    preview.request(conditionOf(query), first.current);
    first.current = false;
  }, [preview, query]);
  useEffect(() => () => preview.reset(), [preview]);

  const line = previewLineOf(query, sort, previewState);
  const changed =
    query !== initial.query || sort !== initial.sort || keepSorted !== initial.keepSorted;
  const ready = canCreate(editing ? null : name, line) && !creating && (!editing || changed);
  const submit = async () => {
    if (!ready) return;
    setCreating(true);
    setOutcome(null);
    const result = await onSubmit({ name: name.trim(), query: query.trim(), sort, keepSorted });
    if (result === 'done') return onClose();
    setCreating(false);
    setOutcome(result);
  };
  const insert = (item: ReferenceItem) => editors[active].current?.insertReference(item);

  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !creating) onClose();
      }}
    >
      <DialogSurface className={styles.surface} data-autoplaylist-dialog>
        <DialogBody>
          <DialogTitle>
            {t(editing ? 'autoplaylist.editTitle' : 'autoplaylist.createTitle')}
          </DialogTitle>
          <DialogContent className={styles.content}>
            <div className={styles.layout}>
              <div className={styles.form}>
                {!editing && (
                  <Field label={t('autoplaylist.name')} required>
                    <Input
                      value={name}
                      maxLength={120}
                      disabled={creating}
                      onChange={(_, data) => setName(data.value)}
                      data-autoplaylist-name
                    />
                  </Field>
                )}
                <div className={styles.field} data-autoplaylist-field="query">
                  <div className={styles.fieldHead}>
                    <Label required>{t('autoplaylist.query')}</Label>
                    <div className={styles.headTools}>
                      <Tooltip content={t('query.syntax.reference')} relationship="label">
                        <Button
                          ref={setReferenceButton}
                          className={buttonStyles.reference}
                          appearance="subtle"
                          size="small"
                          icon={<BookInformation20Regular />}
                          aria-expanded={referenceOpen}
                          onClick={() => setReferenceOpen((open) => !open)}
                          data-autoplaylist-reference-button
                        />
                      </Tooltip>
                      <SyntaxReferencePanel
                        open={referenceOpen}
                        pinned={pinned}
                        target={referenceButton}
                        align="end"
                        playcountMissing={playcountMissing}
                        onClose={() => setReferenceOpen(false)}
                        onPinned={setPinned}
                        onInsert={insert}
                      />
                      <QueryCopyButton text={query} label={t('query.syntax.copyQuery')} />
                    </div>
                  </div>
                  <QueryEditor
                    value={query}
                    kind="query"
                    label={t('autoplaylist.query')}
                    invalid={line.kind === 'invalid' || line.kind === 'issue'}
                    playcountMissing={playcountMissing}
                    minRows={3}
                    maxRows={6}
                    handle={editors.query}
                    onChange={setQuery}
                    onSubmit={() => void submit()}
                    onFocus={() => setActive('query')}
                  />
                </div>
                <div
                  className={styles.preview}
                  role="status"
                  data-level={line.kind === 'count' ? 'ok' : 'wait'}
                  data-autoplaylist-preview={line.kind}
                >
                  {line.kind === 'count' && (
                    <span>
                      {t(
                        plural(line.total, 'autoplaylist.matchCountOne', 'autoplaylist.matchCount'),
                        {
                          count: new Intl.NumberFormat().format(line.total),
                        },
                      )}
                    </span>
                  )}
                  {line.kind === 'counting' && <span>{t('autoplaylist.counting')}</span>}
                  {(line.kind === 'issue' ||
                    line.kind === 'invalid' ||
                    line.kind === 'failed' ||
                    line.kind === 'sortConflict') && (
                    <span className={styles.error} data-level="error">
                      <ErrorCircle16Regular />
                      {line.kind === 'issue'
                        ? issueText(line.issue, query, t)
                        : t(ERROR_KEY[line.kind])}
                    </span>
                  )}
                </div>
                <div className={styles.field} data-autoplaylist-field="sort">
                  <div className={styles.fieldHead}>
                    <Label>{t('autoplaylist.sort')}</Label>
                    <QueryCopyButton text={sort} label={t('autoplaylist.copySort')} />
                  </div>
                  <QueryEditor
                    value={sort}
                    kind="sort"
                    label={t('autoplaylist.sort')}
                    placeholder={t('autoplaylist.sortPlaceholder')}
                    minRows={1}
                    maxRows={3}
                    handle={editors.sort}
                    onChange={setSort}
                    onSubmit={() => void submit()}
                    onFocus={() => setActive('sort')}
                  />
                </div>
                <Switch
                  checked={keepSorted}
                  disabled={creating}
                  label={t('autoplaylist.keepSorted')}
                  onChange={(_, data) => setKeepSorted(data.checked)}
                  data-autoplaylist-keep-sorted
                />
              </div>
              <aside className={styles.column} data-autoplaylist-reference>
                <SyntaxReferenceColumn
                  playcountMissing={playcountMissing}
                  only={active === 'sort' ? SORT_GROUPS : undefined}
                  onInsert={insert}
                />
              </aside>
            </div>
          </DialogContent>
          <DialogActions fluid className={buttonStyles.actions}>
            {outcome && (
              <span className={styles.failure} role="alert" data-autoplaylist-failure={outcome}>
                {t(FAILURE_KEY[mode][outcome])}
              </span>
            )}
            <div className={styles.buttons}>
              {editing && onNative && (
                <Button
                  className={buttonStyles.action}
                  appearance="secondary"
                  disabled={creating}
                  onClick={onNative}
                  data-autoplaylist-native
                >
                  {t('autoplaylist.native')}
                </Button>
              )}
              <Button
                className={buttonStyles.action}
                appearance="primary"
                disabled={!ready}
                onClick={() => void submit()}
                data-autoplaylist-create
              >
                {t(editing ? 'autoplaylist.save' : 'autoplaylist.create')}
              </Button>
              <Button
                className={buttonStyles.action}
                appearance="secondary"
                disabled={creating}
                onClick={onClose}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
