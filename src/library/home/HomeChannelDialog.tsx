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
  Option,
  Spinner,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import { ArrowClockwise20Regular } from '@fluentui/react-icons';
import { translateAtom } from '../../i18n/locale.ts';
import { ScrollDropdown } from '../../kit/ScrollDropdown.tsx';
import { PresetChips } from '../../track/PresetChips.tsx';
import { QueryBox } from '../../track/QueryBox.tsx';
import type { QueryInput } from '../../track/queryInput.ts';
import {
  PLAYCOUNT_GROUP,
  presetOf,
  togglePreset,
  type PresetId,
} from '../../track/queryPresets.ts';
import { allOf, queryWords, wordsQuery, type QueryScope } from '../../track/trackQuery.ts';
import { durationText } from '../../table/cellText.ts';
import { CHANNEL_SORTS, type HomeChannel, type ChannelSort } from './homeChannels.ts';
import { HOME_CHANNEL_TEMPLATES, type HomeChannelDraft } from './homeChannelTemplates.ts';
import { useHomeServices } from './homeContext.ts';
import { useChannelQuery } from './useChannelQuery.ts';
import type { ChannelQueryService } from './channelQuery.ts';
import styles from './HomeChannelDialog.module.css';

const useStyles = makeStyles({
  content: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
  },
});

interface HomeChannelDialogProps {
  readonly channel: HomeChannel | null;
  readonly draft?: HomeChannelDraft;
  readonly onClose: () => void;
}
export function HomeChannelDialog(props: HomeChannelDialogProps) {
  const query = useChannelQuery(true);
  return query ? <ChannelEditor {...props} query={query} /> : null;
}

function ChannelEditor({
  channel,
  draft,
  onClose,
  query,
}: HomeChannelDialogProps & {
  readonly query: ChannelQueryService;
}) {
  const home = useHomeServices();
  const classes = useStyles();
  const t = useAtomValueRawSync(translateAtom);
  const preview = useAtomValueRawSync(query.state);
  const saved = useAtomValueRawSync(home.channels.state);
  const feed = useAtomValueRawSync(home.feed.state);
  const initial = channel ?? draft;
  const [id] = useState(() => channel?.id ?? crypto.randomUUID());
  const [name, setName] = useState(initial?.name ?? '');
  const [input, setInput] = useState<QueryInput>({
    mode: initial ? 'advanced' : 'text',
    text: '',
    advancedText: initial?.query ?? '',
  });
  const [scope, setScope] = useState<QueryScope>('all');
  const [presets, setPresets] = useState<ReadonlySet<PresetId>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [templateId, setTemplateId] = useState(
    HOME_CHANNEL_TEMPLATES.find((item) => item.query === draft?.query)?.id ?? '',
  );
  const [sort, setSort] = useState<ChannelSort>(initial?.sort ?? 'album');
  const template = HOME_CHANNEL_TEMPLATES.find((item) => item.id === templateId);
  const sortLabel = t(
    sort === 'album' ? 'home.sortAlbum' : sort === 'title' ? 'home.sortTitle' : 'home.sortRandom',
  );
  const text = allOf([
    input.mode === 'advanced' ? input.advancedText : wordsQuery(queryWords(input.text), scope),
    ...[...presets].map((preset) => presetOf(preset).query),
  ]);
  const missingStatistics =
    feed.available === false &&
    [...presets].some((preset) => presetOf(preset).group === PLAYCOUNT_GROUP);
  const matchesPreview = preview.query === text && preview.sort === sort;
  const tooLong = text.length > 8000;
  useEffect(() => {
    query.setQuery(tooLong ? '' : text, sort);
  }, [query, text, sort, tooLong]);
  const valid =
    name.trim() &&
    !tooLong &&
    !missingStatistics &&
    preview.status === 'ready' &&
    matchesPreview &&
    !preview.dirty &&
    !saved.saving;
  const save = async () => {
    if (!valid) return;
    if (await home.channels.save({ id, name: name.trim(), query: text, sort }, !!channel))
      onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !saved.saving) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t(channel ? 'home.editChannel' : 'home.newChannel')}</DialogTitle>
          <DialogContent className={classes.content}>
            {!channel && (
              <Field label={t('home.template')}>
                <ScrollDropdown
                  inlinePopup
                  value={t(template?.label ?? 'home.templateCustom')}
                  selectedOptions={[templateId]}
                  disabled={saved.saving}
                  onOptionSelect={(_, data) => {
                    if (data.optionValue === undefined) return;
                    setTemplateId(data.optionValue);
                    const selected = HOME_CHANNEL_TEMPLATES.find(
                      (item) => item.id === data.optionValue,
                    );
                    if (!selected) return;
                    setName(t(selected.label));
                    setInput({ mode: 'advanced', text: '', advancedText: selected.query });
                    setPresets(new Set());
                    setSort('random');
                  }}
                >
                  <Option value="">{t('home.templateCustom')}</Option>
                  {HOME_CHANNEL_TEMPLATES.map((template) => (
                    <Option
                      key={template.id}
                      value={template.id}
                      disabled={template.statistics && feed.available !== true}
                    >
                      {t(template.label)}
                    </Option>
                  ))}
                </ScrollDropdown>
              </Field>
            )}
            <Field label={t('home.name')} required>
              <Input
                value={name}
                maxLength={120}
                disabled={saved.saving}
                onChange={(_, data) => setName(data.value)}
              />
            </Field>
            <Field
              label={t('home.query')}
              validationState={tooLong || missingStatistics ? 'error' : 'none'}
              validationMessage={
                tooLong
                  ? t('home.queryTooLong')
                  : missingStatistics
                    ? t('query.needsPlaycount')
                    : undefined
              }
            >
              <QueryBox
                input={input}
                scope={scope}
                invalid={tooLong}
                menuOpen={menuOpen && !saved.saving}
                placeholder={t('home.queryPlaceholder')}
                label={t('home.query')}
                onChange={(next) => {
                  if (!saved.saving) setInput(next);
                }}
                onEnter={() => {
                  if (!tooLong) query.setQuery(text, sort, true);
                }}
                onScope={setScope}
                onMenuOpenChange={setMenuOpen}
              />
            </Field>
            <PresetChips
              checked={presets}
              playcount={feed.available}
              onToggle={(preset) => {
                if (!saved.saving) setPresets((previous) => togglePreset(previous, preset));
              }}
            />
            <Field label={t('home.sort')}>
              <ScrollDropdown
                inlinePopup
                value={sortLabel}
                selectedOptions={[sort]}
                disabled={saved.saving}
                onOptionSelect={(_, data) => {
                  const next = CHANNEL_SORTS.find((value) => value === data.optionValue);
                  if (!next) return;
                  setSort(next);
                }}
              >
                <Option value="album">{t('home.sortAlbum')}</Option>
                <Option value="title">{t('home.sortTitle')}</Option>
                <Option value="random">{t('home.sortRandom')}</Option>
              </ScrollDropdown>
            </Field>
            <section className={styles.preview} aria-label={t('home.preview')} aria-live="polite">
              <header className={styles['preview-header']}>
                <span>{t('home.preview')}</span>
                <Button
                  icon={<ArrowClockwise20Regular />}
                  aria-label={t('home.refreshPreview')}
                  title={t('home.refreshPreview')}
                  disabled={saved.saving || tooLong}
                  onClick={() => query.setQuery(text, sort, true)}
                />
              </header>
              {!tooLong && (!matchesPreview || preview.status === 'loading') && (
                <Spinner size="tiny" label={t('album.loading')} />
              )}
              {matchesPreview && preview.status === 'ready' && (
                <>
                  <p>
                    {t(preview.total ? 'home.previewCount' : 'home.previewEmpty', {
                      count: preview.total,
                    })}
                  </p>
                  {preview.tracks.map((track) => (
                    <div key={track.handle} className={styles['preview-row']}>
                      <div className={styles.metadata}>
                        <span title={track.title}>{track.title || track.handle}</span>
                        <small>{track.artist}</small>
                      </div>
                      <span>{durationText(track.duration ?? 0)}</span>
                    </div>
                  ))}
                </>
              )}
              {matchesPreview && ['failed', 'unavailable', 'disabled'].includes(preview.status) && (
                <>
                  <p role="alert">{t('home.queryFailed')}</p>
                  <Button onClick={() => query.retry()}>{t('album.retry')}</Button>
                </>
              )}
              {preview.dirty && <Button onClick={() => query.retry()}>{t('home.refresh')}</Button>}
              {saved.saveFailed && <p role="alert">{t('home.savedFailed')}</p>}
            </section>
          </DialogContent>
          <DialogActions>
            <Button disabled={saved.saving} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button appearance="primary" disabled={!valid} onClick={() => void save()}>
              {t('home.save')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
