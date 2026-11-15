import { Link, makeStyles, tokens } from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';
import { useExternalLinks } from '../../../kit/external-link/ExternalLinkProvider.tsx';
import type { BiographyTranslate } from '../BiographyPanel.tsx';
import styles from './BiographyPhotoSource.module.css';

const useStyles = makeStyles({
  link: { fontSize: tokens.fontSizeBase200, lineHeight: tokens.lineHeightBase200 },
});

/** `name` 是来源的名字（Last.fm、Apple Music），在线照片的 `album` 就是它 */
export function BiographyPhotoSource({
  url,
  name,
  t,
}: {
  readonly url: string;
  readonly name: string;
  readonly t: BiographyTranslate;
}) {
  const classes = useStyles();
  const links = useExternalLinks();
  return (
    <div className={styles.root} data-biography-photo-source>
      <span>
        {t('biography.onlinePhotoSource', { source: name })} · {t('biography.photoLicenseUnknown')}
      </span>
      <Link className={classes.link} onClick={() => links.open(url)}>
        {t('biography.openPhotoSource')} <Open16Regular aria-hidden />
      </Link>
    </div>
  );
}
