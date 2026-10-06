import { Link, makeStyles, tokens } from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';
import { useExternalLinks } from '../../../kit/external-link/ExternalLinkProvider.tsx';
import type { BiographyTranslate } from '../BiographyPanel.tsx';
import styles from './BiographyPhotoSource.module.css';

const useStyles = makeStyles({
  link: { fontSize: tokens.fontSizeBase200, lineHeight: tokens.lineHeightBase200 },
});

export function BiographyPhotoSource({
  url,
  t,
}: {
  readonly url: string;
  readonly t: BiographyTranslate;
}) {
  const classes = useStyles();
  const links = useExternalLinks();
  return (
    <div className={styles.root} data-biography-photo-source>
      <span>
        {t('biography.onlinePhotoSource')} · {t('biography.photoLicenseUnknown')}
      </span>
      <Link className={classes.link} onClick={() => links.open(url)}>
        {t('biography.openPhotoSource')} <Open16Regular aria-hidden />
      </Link>
    </div>
  );
}
