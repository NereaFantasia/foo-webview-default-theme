import {
  mergeClasses,
  Accordion,
  AccordionItem,
  Button,
  Input,
  RatingDisplay,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowLeft16Regular,
  ArrowSync16Regular,
  ChevronDown16Regular,
  ChevronUp16Regular,
  Copy16Regular,
  FolderOpen16Regular,
  MoreHorizontal16Regular,
  MusicNote2Regular,
  Search16Regular,
} from '@fluentui/react-icons';
import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Translate } from '../../i18n/translate.ts';
import type { ContextMenuPoint } from '../../kit/context-menu/contextMenuGeometry.ts';
import { ReadableText } from '../../kit/external-link/ReadableText.tsx';
import { useExternalLinks } from '../../kit/external-link/ExternalLinkProvider.tsx';
import { AccordionHeader, AccordionPanel } from '../../motion/FlowAccordion.tsx';
import { CoverFold } from '../right-card/RightCardHead.tsx';
import type { TrackInfoService } from './trackInfo.ts';
import type { TrackInfoTarget } from './trackInfoTarget.ts';
import {
  copyInfoTags,
  filterInfoTags,
  infoFilePath,
  infoIdentity,
  infoMediaKind,
  infoTags,
  infoTitle,
  INFO_SECTIONS,
  type InfoSection,
  type TrackInfoState,
} from './trackInfoModel.ts';
import { infoSectionNotice, trackInfoRows } from './trackInfoRows.ts';
import styles from './TrackInfoPanel.module.css';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

const useStyles = makeStyles({
  header: {
    minHeight: '36px',
    paddingInline: tokens.spacingHorizontalM,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  headerButton: {
    width: 'fit-content',
    maxWidth: '100%',
    padding: '0',
    minHeight: '36px',
    fontWeight: tokens.fontWeightSemibold,
    cursor: 'pointer',
  },
  panel: {
    margin: '0',
    paddingInline: tokens.spacingHorizontalM,
    paddingBottom: tokens.spacingVerticalM,
  },
  icon: { minWidth: '28px', width: '28px', height: '28px' },
  search: { width: '100%', minWidth: '0', boxSizing: 'border-box' },
  returning: { width: '100%', justifyContent: 'flex-start', minWidth: '0' },
  section: {
    borderBottom: `${tokens.strokeWidthThin} solid color-mix(in srgb, ${tokens.colorNeutralStroke2} 35%, transparent)`,
  },
});

export interface TrackInfoPanelProps {
  readonly service: TrackInfoService;
  readonly target: TrackInfoTarget;
  readonly t: Translate;
  readonly locale: string;
  readonly renderCover?: (track: Track, expanded: boolean) => ReactNode;
  readonly onTrackMenu?: (track: Track, at: ContextMenuPoint) => void;
}

function CopyInfoButton({
  text,
  service,
  t,
  disabled = false,
}: {
  readonly text: string;
  readonly service: TrackInfoService;
  readonly t: Translate;
  readonly disabled?: boolean;
}) {
  const controls = useViewControlStyles();
  const classes = useStyles();
  return (
    <span className={styles.copy}>
      <Tooltip content={t('trackInfo.copy')} relationship="label">
        <Button
          className={mergeClasses(classes.icon, controls.icon)}
          appearance="subtle"
          size="small"
          icon={<Copy16Regular />}
          disabled={disabled}
          onClick={() => void service.copy(text)}
        />
      </Tooltip>
    </span>
  );
}

function TagList({
  state,
  service,
  t,
}: {
  readonly state: TrackInfoState;
  readonly service: TrackInfoService;
  readonly t: Translate;
}) {
  const controls = useViewControlStyles();
  const classes = useStyles();
  const [search, setSearch] = useState('');
  const tags = state.metadata.status === 'ready' ? infoTags(state.metadata.value.tags) : [];
  const filtered = filterInfoTags(tags, search);
  const notice = infoSectionNotice(state, 'tags');
  return (
    <div className={styles.tags}>
      <div className={styles.tools}>
        <Input
          className={mergeClasses(classes.search, controls.field)}
          size="small"
          contentBefore={<Search16Regular />}
          aria-label={t('trackInfo.search')}
          placeholder={t('trackInfo.search')}
          value={search}
          onChange={(_, data) => setSearch(data.value)}
        />
        <Tooltip content={t('trackInfo.copyTags')} relationship="label">
          <Button
            className={mergeClasses(classes.icon, controls.icon)}
            appearance="subtle"
            icon={<Copy16Regular />}
            disabled={tags.length === 0}
            onClick={() => void service.copyTags()}
          />
        </Tooltip>
        <Tooltip content={t('trackInfo.refresh')} relationship="label">
          <Button
            className={mergeClasses(classes.icon, controls.icon)}
            appearance="subtle"
            icon={<ArrowSync16Regular />}
            disabled={
              state.metadata.status === 'loading' ||
              !state.track ||
              infoMediaKind(state.track) === 'stream'
            }
            onClick={() => service.refresh()}
          />
        </Tooltip>
      </div>
      {!notice && (
        <div className={styles.provenance}>
          <span>{t(state.tagSource === 'file' ? 'trackInfo.fileTags' : 'trackInfo.hostTags')}</span>
          <span>{t('trackInfo.tagCount', { count: tags.length })}</span>
        </div>
      )}
      {notice ? (
        <p className={styles.notice} role="status">
          {t(notice)}
        </p>
      ) : tags.length === 0 ? (
        <p className={styles.notice}>{t('trackInfo.noTags')}</p>
      ) : filtered.length === 0 ? (
        <p className={styles.notice}>{t('trackInfo.noResults')}</p>
      ) : (
        <dl className={styles.rows}>
          {filtered.map((tag) => (
            <div className={styles['tag-row']} key={tag.name}>
              <dt className={styles['tag-name']}>{tag.name}</dt>
              <dd>
                {(tag.values.length ? tag.values : ['']).map((value, index) => (
                  <div className={styles.value} key={index}>
                    {value || t('trackInfo.emptyValue')}
                  </div>
                ))}
              </dd>
              <CopyInfoButton text={copyInfoTags([tag])} service={service} t={t} />
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function InfoSectionContent({
  state,
  section,
  service,
  t,
  locale,
}: {
  readonly state: TrackInfoState;
  readonly section: InfoSection;
  readonly service: TrackInfoService;
  readonly t: Translate;
  readonly locale: string;
}) {
  const controls = useViewControlStyles();
  const notice = infoSectionNotice(state, section);
  const rows = trackInfoRows(state, section, t, locale);
  const classes = useStyles();
  const external = useExternalLinks();
  if (section === 'tags') return <TagList state={state} service={service} t={t} />;
  if (notice && section !== 'file')
    return (
      <p className={styles.notice} role="status">
        {t(notice)}
      </p>
    );
  return (
    <>
      {notice && (
        <p className={styles.notice} role="status">
          {t(notice)}
        </p>
      )}
      {rows.length > 0 && (
        <dl className={styles.rows}>
          {rows.map(({ label, values, missing }) => (
            <div className={styles.row} key={label}>
              <dt>{t(label)}</dt>
              <dd>
                {values.length ? (
                  values.map((value, index) => (
                    <div className={styles.value} key={index}>
                      <ReadableText
                        text={value || t('trackInfo.emptyValue')}
                        onOpen={external.open}
                      />
                    </div>
                  ))
                ) : (
                  <span className={styles.missing}>{t(missing ?? 'trackInfo.unknown')}</span>
                )}
              </dd>
              <CopyInfoButton
                text={values.join('\n')}
                service={service}
                t={t}
                disabled={values.length === 0}
              />
            </div>
          ))}
        </dl>
      )}
      {section === 'credits' && !rows.length && (
        <p className={styles.notice}>{t('trackInfo.noCredits')}</p>
      )}
      {section === 'replayGain' && (
        <p className={styles.notice}>
          {t(rows.length ? 'trackInfo.replayGainSource' : 'trackInfo.noReplayGain')}
        </p>
      )}
      {section === 'statistics' && (
        <p className={styles.notice}>{t('trackInfo.statisticsSource')}</p>
      )}
      {section === 'file' && (
        <Button
          appearance="subtle"
          size="small"
          icon={<FolderOpen16Regular />}
          className={mergeClasses(classes.returning, controls.icon)}
          disabled={
            !state.track ||
            !infoFilePath(state.track) ||
            state.file.status !== 'ready' ||
            !state.file.value.exists
          }
          onClick={() => void service.openFolder()}
        >
          {t('trackInfo.openFolder')}
        </Button>
      )}
    </>
  );
}

export function TrackInfoPanel({
  service,
  target,
  t,
  locale,
  renderCover,
  onTrackMenu,
}: TrackInfoPanelProps) {
  const controls = useViewControlStyles();
  const state = useAtomValueRawSync(service.state);
  const sections = useAtomValueRawSync(service.sections);
  const source = useAtomValueRawSync(target.source);
  const playing = useAtomValueRawSync(target.playing);
  const [expanded, setExpanded] = useState(false);
  const [folded, setFolded] = useState(true);
  if (expanded && folded) setFolded(false);
  const showRow = !expanded && folded;
  const head = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const toggle = () => {
    refocus.current = head.current?.contains(document.activeElement) ?? false;
    setExpanded(!expanded);
  };
  useLayoutEffect(() => {
    if (!refocus.current) return;
    const button = head.current?.querySelector<HTMLElement>('[data-info-cover-toggle]');
    if (button) {
      refocus.current = false;
      button.focus();
    }
  }, [showRow, expanded]);
  const settle = (_: null, data: { direction: 'enter' | 'exit' }) => {
    if (data.direction === 'exit') setFolded(true);
  };
  const classes = useStyles();
  const track = infoIdentity(state);
  const { rating } = state;
  const title = track ? infoTitle(track) : t('trackInfo.noTrack');
  const toggleLabel = t(expanded ? 'rightCard.hideCover' : 'rightCard.showCover');
  const artwork = track && renderCover ? renderCover(track, !showRow) : <MusicNote2Regular />;
  const identity = (
    <div
      className={styles.identity}
      data-expanded={!showRow || undefined}
      onContextMenu={(event) => {
        if (!track || !onTrackMenu) return;
        event.preventDefault();
        event.stopPropagation();
        head.current?.querySelector<HTMLElement>('[data-info-track-menu]')?.focus();
        onTrackMenu(track, { x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        className={styles.artwork}
        aria-label={toggleLabel}
        onClick={toggle}
        aria-expanded={expanded}
        disabled={!track}
      >
        {artwork}
      </button>
      <div className={styles['identity-text']}>
        <div className={styles.title} title={title}>
          {title}
        </div>
        {track && (
          <>
            <div className={styles.subtitle} title={track.artist}>
              {track.artist}
            </div>
            <div className={styles.subtitle} title={track.album}>
              {track.album}
            </div>
            {rating.status === 'ready' && rating.value.rating > 0 && (
              <Tooltip
                content={t(
                  rating.value.storage === 'stats'
                    ? 'trackInfo.ratingStats'
                    : 'trackInfo.ratingFile',
                )}
                relationship="description"
              >
                <RatingDisplay
                  value={rating.value.rating}
                  size="small"
                  color="brand"
                  aria-label={t('trackInfo.rating')}
                />
              </Tooltip>
            )}
          </>
        )}
      </div>
      <div className={styles['identity-actions']}>
        <Tooltip content={toggleLabel} relationship="label">
          <Button
            className={mergeClasses(classes.icon, controls.icon)}
            appearance="subtle"
            size="small"
            icon={expanded ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
            disabled={!track}
            data-info-cover-toggle={showRow || expanded ? '' : undefined}
            aria-expanded={expanded}
            onClick={toggle}
          />
        </Tooltip>
        {onTrackMenu && (
          <Tooltip content={t('trackInfo.trackMenu')} relationship="label">
            <Button
              className={mergeClasses(classes.icon, controls.icon)}
              appearance="subtle"
              size="small"
              icon={<MoreHorizontal16Regular />}
              disabled={!track}
              data-info-track-menu
              aria-haspopup="menu"
              onClick={(event) => {
                if (!track) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                onTrackMenu(track, { x: bounds.left, y: bounds.bottom });
              }}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
  return (
    <section className={styles.root} aria-label={t('trackInfo.title')} data-track-info>
      <div ref={head} className={styles.fold}>
        <CoverFold visible={expanded} unmountOnExit onMotionFinish={settle} onMotionCancel={settle}>
          {identity}
        </CoverFold>
        {showRow && identity}
      </div>
      <div className={styles.scroll} key={track?.handle ?? ''}>
        {track && (
          <Accordion
            multiple
            collapsible
            openItems={[...sections]}
            onToggle={(_, data) =>
              service.setSections(INFO_SECTIONS.filter((key) => data.openItems.includes(key)))
            }
          >
            {INFO_SECTIONS.map((section) => (
              <AccordionItem value={section} key={section}>
                <AccordionHeader
                  className={classes.header}
                  size="small"
                  button={{ className: classes.headerButton }}
                >
                  <span className={styles['section-label']} data-info-section-label>
                    {t(`trackInfo.${section}`)}
                  </span>
                </AccordionHeader>
                <AccordionPanel className={classes.panel}>
                  <InfoSectionContent
                    state={state}
                    section={section}
                    service={service}
                    t={t}
                    locale={locale}
                  />
                </AccordionPanel>
                <div className={classes.section} aria-hidden />
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
      <div className={styles.status} role="status" aria-live="polite">
        {state.action !== 'idle' && t(`trackInfo.${state.action}`)}
      </div>
      {source === 'preview' && (
        <div className={styles.return}>
          <Button
            className={mergeClasses(classes.returning, controls.icon)}
            appearance="subtle"
            size="small"
            icon={<ArrowLeft16Regular />}
            onClick={() => target.follow('playing')}
          >
            <span className={styles['return-text']}>
              <span>{t('trackInfo.return')}</span>
              {playing && <span className={styles['return-title']}>{infoTitle(playing)}</span>}
            </span>
          </Button>
        </div>
      )}
    </section>
  );
}
