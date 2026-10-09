import { Subtitle1 } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import type { PageProps } from '../nav/places.ts';
import { usePlaceName } from './usePlaceName.ts';
import styles from './PlaceholderPage.module.css';

/** 没登记页面的地点显示它：只写出地点的名字，带主体的写主体（列表名、专辑名）。 */
export function PlaceholderPage({ place }: PageProps) {
  const t = useAtomValueRawSync(translateAtom);
  const placeName = usePlaceName();
  return (
    <div className={styles.root} data-page-scrolls-header>
      <Subtitle1>{t('page.placeholder', { place: placeName(place) })}</Subtitle1>
    </div>
  );
}
