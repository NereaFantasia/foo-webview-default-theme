import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { SortMenu } from '../kit/SortMenu.tsx';
import { COLUMNS, type ColumnId } from '../table/columns/columns.ts';
import type { TableSort } from '../table/TrackTableHeader.tsx';
import { isTrackSortColumn, startsDescending, TRACK_STATS_COLUMNS } from './trackSort.ts';

export interface TrackSortMenuProps {
  readonly sort: TableSort | null;
  readonly playcount: boolean | null;
  readonly onSort: (sort: TableSort | null) => void;
  readonly defaultLabel?: string;
  /** 宽档键上带「排序」二字；其余档只留图标 */
  readonly labelled: boolean;
  readonly buttonAttributes?: Readonly<Record<`data-${string}`, string>>;
}

export function TrackSortMenu({
  sort,
  playcount,
  onSort,
  defaultLabel,
  labelled,
  buttonAttributes,
}: TrackSortMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <SortMenu<ColumnId | 'default'>
      buttonAttributes={buttonAttributes}
      tool={{ labelled }}
      field={sort?.column ?? 'default'}
      descending={sort?.descending ?? false}
      groups={[
        {
          options: [
            ...(defaultLabel ? [{ value: 'default' as const, label: defaultLabel }] : []),
            ...COLUMNS.filter(({ id }) => isTrackSortColumn(id)).map(({ id, label }) => ({
              value: id,
              label: t(label),
              disabled: TRACK_STATS_COLUMNS.has(id) && playcount !== true,
            })),
          ],
        },
      ]}
      onField={(column) =>
        onSort(
          column === 'default'
            ? null
            : {
                column,
                descending: sort?.column === column ? sort.descending : startsDescending(column),
              },
        )
      }
      onDescending={sort ? (descending) => onSort({ ...sort, descending }) : undefined}
    />
  );
}
