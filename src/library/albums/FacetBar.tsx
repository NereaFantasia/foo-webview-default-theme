import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { Translate } from '../../i18n/translate.ts';
import { FacetConditions } from '../../kit/FacetConditions.tsx';
import { FacetPanel } from '../../kit/FacetPanel.tsx';
import { useService } from '../../kit/useService.ts';
import { albumsKey } from '../albumServices.ts';
import { albumBrowseAtom, facetOptionsAtom } from './albumBrowse.ts';
import { FACET_FIELDS, type FacetField } from './facets.ts';
import styles from './FacetBar.module.css';

const LABELS: Readonly<Record<FacetField, MessageKey>> = {
  genre: 'album.facetGenre',
  decade: 'album.facetDecade',
  albumArtist: 'album.facetAlbumArtist',
};

function labelOf(t: Translate, field: FacetField, name: string): string {
  return field === 'decade' ? t('album.decade', { decade: name.slice(0, 4) }) : name;
}

/** 专辑分面的计数来自专辑清单，整张专辑作为一个结果 */
export function FacetBar({ tabs }: { readonly tabs: boolean }) {
  const t = useAtomValueRawSync(translateAtom);
  const { facets } = useAtomValueRawSync(albumBrowseAtom);
  const options = useAtomValueRawSync(facetOptionsAtom);
  const albums = useService(albumsKey);
  return (
    <FacetPanel
      label={t('album.facets')}
      tabs={tabs}
      columns={FACET_FIELDS.map((field) => ({
        id: field,
        label: t(LABELS[field]),
        selected: facets[field],
        options: options[field].map(({ name, albumCount }) => ({
          value: name,
          label: labelOf(t, field, name),
          count: albumCount,
        })),
      }))}
      onToggle={albums.browse.toggleFacet}
    />
  );
}

/** 生效条件留在结果上方；关闭筛选浮层后仍可查看和移除 */
export function AlbumFacetConditions({ onAdd }: { readonly onAdd: () => void }) {
  const t = useAtomValueRawSync(translateAtom);
  const { facets } = useAtomValueRawSync(albumBrowseAtom);
  const albums = useService(albumsKey);
  const chips = FACET_FIELDS.flatMap((field) =>
    [...facets[field]].map((name) => ({
      field,
      name,
      key: JSON.stringify([field, name]),
      label: labelOf(t, field, name),
    })),
  );
  return (
    <FacetConditions
      className={styles.conditions}
      label={t('album.facets')}
      chips={chips}
      removeLabel={(chip) => t('album.facetRemove', { value: chip.label })}
      clearLabel={t('album.facetClear')}
      onRemove={(key) => {
        const chip = chips.find((item) => item.key === key);
        if (chip) albums.browse.toggleFacet(chip.field, chip.name);
      }}
      onAdd={onAdd}
      onClear={() => albums.browse.clearFacets()}
    />
  );
}
