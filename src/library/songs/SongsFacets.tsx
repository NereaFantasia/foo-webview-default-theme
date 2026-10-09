import {
  Button,
  Checkbox,
  Input,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { Search16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useMemo, useState } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { LibraryTracksState } from '../libraryTracks.ts';
import {
  SONG_FACETS,
  songFacetOptions,
  type SongFacet,
  type SongFacetValue,
} from './songsFacets.ts';
import styles from './SongsFacets.module.css';
import type { SongsFilter } from './songsFilter.ts';
import { decadeLabel } from './songsLabels.ts';
import { useService } from '../../kit/useService.ts';
import { songsKey } from './songsServices.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

const LABELS: Readonly<Record<SongFacet, MessageKey>> = {
  genre: 'songs.facetGenre',
  decade: 'songs.facetDecade',
  artist: 'songs.facetArtist',
};

/** 一栏最多画这么多项；艺术家多了靠栏顶的筛选框找。 */
const SHOWN_LIMIT = 200;
const useStyles = makeStyles({
  box: { minWidth: 0, maxWidth: '100%', flexGrow: 1, color: tokens.colorNeutralForeground1 },
  label: {
    flexGrow: 1,
    overflowWrap: 'anywhere',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    paddingTop: tokens.spacingVerticalSNudge,
    paddingBottom: tokens.spacingVerticalSNudge,
    marginTop: 0,
    marginBottom: 0,
  },
  indicator: {
    marginTop: tokens.spacingVerticalSNudge,
    marginBottom: tokens.spacingVerticalSNudge,
  },
  checked: {
    color: tokens.colorBrandForeground1,
    ':hover': { color: tokens.colorBrandForegroundLinkHover },
    ':active': { color: tokens.colorBrandForegroundLinkPressed },
  },
  search: { minHeight: '28px' },
});

export interface SongsFacetsProps {
  readonly filter: SongsFilter;
  readonly library: LibraryTracksState;
}

/**
 * 分面条：流派、年代、艺术家三栏，各是一列可勾的值，后面写带它的首数；栏内或、跨栏与。取值按整库曲目算，库变了
 * 之后勾选里不在清单上的值剔掉。艺术家一栏顶上有筛选框。
 */
export function SongsFacets({ filter, library }: SongsFacetsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const songs = useService(songsKey);
  const options = useMemo(() => songFacetOptions(library.byHandle.values()), [library.byHandle]);
  useEffect(() => {
    if (library.status === 'ready') songs.filter.pruneFacets(options);
  }, [songs, options, library.status]);
  return (
    <div className={styles.root} role="group" aria-label={t('songs.facets')} data-songs-facets>
      {SONG_FACETS.map((facet) => (
        <FacetColumn
          key={facet}
          facet={facet}
          values={options[facet]}
          checked={filter.facets[facet]}
        />
      ))}
    </div>
  );
}

interface FacetColumnProps {
  readonly facet: SongFacet;
  readonly values: readonly SongFacetValue[];
  readonly checked: ReadonlySet<string>;
}

function FacetColumn({ facet, values, checked }: FacetColumnProps) {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const songs = useService(songsKey);
  const labelId = useId();
  const [needle, setNeedle] = useState('');
  const numbers = new Intl.NumberFormat();
  const lowered = needle.trim().toLowerCase();
  const shown = (
    lowered === '' ? values : values.filter((value) => value.name.toLowerCase().includes(lowered))
  ).slice(0, SHOWN_LIMIT);
  const labelOf = (name: string) => (facet === 'decade' ? decadeLabel(name, t) : name);
  return (
    <div className={styles.column} data-songs-facet={facet}>
      <div className={styles.head}>
        <span id={labelId} className={styles.label}>
          {t(LABELS[facet])}
        </span>
        {checked.size > 0 && (
          <Button
            appearance="transparent"
            size="small"
            className={mergeClasses(styles.checked, classes.checked, controls.icon)}
            onClick={() => {
              for (const name of checked) songs.filter.toggleFacet(facet, name);
            }}
          >
            {t('songs.facetChecked', { count: checked.size })}
          </Button>
        )}
      </div>
      <div className={styles.list} role="group" aria-labelledby={labelId}>
        {(facet === 'artist' || values.length > SHOWN_LIMIT) && (
          <Input
            size="small"
            appearance="filled-darker"
            className={mergeClasses(styles.search, classes.search, controls.field)}
            contentBefore={<Search16Regular />}
            placeholder={t(facet === 'artist' ? 'songs.facetSearch' : 'songs.facetFilter')}
            aria-label={t(facet === 'artist' ? 'songs.facetSearch' : 'songs.facetFilter')}
            value={needle}
            onChange={(_, data) => setNeedle(data.value)}
          />
        )}
        {shown.length === 0 && <div className={styles.empty}>{t('songs.facetEmpty')}</div>}
        {shown.map((value) => (
          <div
            key={value.name}
            className={checked.has(value.name) ? `${styles.row} ${styles.on}` : styles.row}
          >
            <Checkbox
              className={classes.box}
              checked={checked.has(value.name)}
              indicator={{ className: classes.indicator }}
              label={{ children: labelOf(value.name), className: classes.label }}
              onChange={() => songs.filter.toggleFacet(facet, value.name)}
            />
            <span className={styles.count}>{numbers.format(value.count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
