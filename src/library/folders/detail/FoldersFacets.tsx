import { Checkbox, Input, makeStyles, tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, useState } from 'react';
import type { LibraryTrack } from 'foo-webview-sdk';
import { translateAtom } from '../../../i18n/locale.ts';
import {
  SONG_FACETS,
  songFacetOptions,
  type SongFacet,
  type SongFacetValue,
} from '../../songs/songsFacets.ts';
import { decadeLabel } from '../../songs/songsLabels.ts';
import type { SongsFilter } from '../../songs/songsFilter.ts';
import styles from './FoldersFacets.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';

const LABELS = {
  genre: 'songs.facetGenre',
  decade: 'songs.facetDecade',
  artist: 'songs.facetArtist',
} as const;
const useStyles = makeStyles({
  check: { minWidth: 0, flex: 1 },
  label: {
    fontSize: tokens.fontSizeBase200,
    overflowWrap: 'anywhere',
    paddingTop: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalXS,
  },
});
function FolderFacet({
  facet,
  values,
  checked,
}: {
  readonly facet: SongFacet;
  readonly values: readonly SongFacetValue[];
  readonly checked: ReadonlySet<string>;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const classes = useStyles();
  const [needle, setNeedle] = useState('');
  const shown = values.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(needle.toLocaleLowerCase()),
  );
  return (
    <div className={styles.column} role="group" aria-label={t(LABELS[facet])}>
      <span>{t(LABELS[facet])}</span>
      {values.length > 12 && (
        <Input
          size="small"
          value={needle}
          aria-label={t(LABELS[facet])}
          onChange={(_, data) => setNeedle(data.value)}
        />
      )}
      <div className={styles.list}>
        {shown.map((entry) => (
          <div className={styles.row} key={entry.name}>
            <Checkbox
              className={classes.check}
              checked={checked.has(entry.name)}
              label={{
                children: facet === 'decade' ? decadeLabel(entry.name, t) : entry.name,
                className: classes.label,
              }}
              onChange={() => folders.results.toggleFacet(facet, entry.name)}
            />
            <span>{entry.count}</span>
          </div>
        ))}
        {!shown.length && <span>{t('songs.facetEmpty')}</span>}
      </div>
    </div>
  );
}
export function FoldersFacets({
  tracks,
  filter,
}: {
  readonly tracks: readonly LibraryTrack[];
  readonly filter: SongsFilter;
}) {
  const options = useMemo(() => songFacetOptions(tracks), [tracks]);
  return (
    <div className={styles.root}>
      {SONG_FACETS.map((facet) => (
        <FolderFacet
          key={facet}
          facet={facet}
          values={options[facet]}
          checked={filter.facets[facet]}
        />
      ))}
    </div>
  );
}
