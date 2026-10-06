import { Link, makeStyles, tokens } from '@fluentui/react-components';
import type { BiographyDocument } from '../biographyModel.ts';
import type { BiographyTranslate } from '../BiographyPanel.tsx';
import { BiographyDetails } from '../details/BiographyDetails.tsx';
import type {
  BiographyDetails as Details,
  BiographyFact,
} from '../details/biographyDetailsModel.ts';
import { ReadableText } from '../../../kit/external-link/ReadableText.tsx';
import styles from './BiographyArticle.module.css';
const useStyles = makeStyles({
  source: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground3,
    ':hover': { color: tokens.colorBrandForeground1 },
  },
});

export interface BiographyArticleProps {
  readonly document: BiographyDocument | null;
  readonly details: Details | null | undefined;
  readonly facts: readonly BiographyFact[];
  readonly factsUrl?: string;
  readonly artistImages?: ReadonlyMap<string, string>;
  readonly artistLinks?: ReadonlyMap<string, () => void>;
  readonly t: BiographyTranslate;
  onOpen(url: string): void;
}

export function BiographyArticle(props: BiographyArticleProps) {
  const { document, details, t, onOpen } = props;
  const classes = useStyles();
  const hasContent =
    document ||
    props.facts.length ||
    details?.counters.length ||
    details?.tags.length ||
    details?.similar.length;
  if (!hasContent) return null;
  return (
    <div className={styles.root} data-biography-article>
      {document && (
        <div className={styles.body} lang={document.language}>
          <div className={styles.text}>
            {document.paragraphs.map((paragraph, index) => (
              <p key={index}>
                <ReadableText
                  text={paragraph}
                  links={document.links?.filter((link) => link.paragraph === index)}
                  onOpen={onOpen}
                />{' '}
              </p>
            ))}
          </div>
        </div>
      )}
      <div className={styles.after}>
        <BiographyDetails
          facts={props.facts}
          details={details}
          t={t}
          onOpen={onOpen}
          artistImages={props.artistImages}
          artistLinks={props.artistLinks}
        />
        <footer className={styles.sources} data-biography-sources>
          <div>
            {document && (
              <>
                <span>{t('biography.textSource')} </span>
                <Link className={classes.source} onClick={() => onOpen(document.url)}>
                  {t('biography.source')}
                </Link>
                {' · '}
                <Link className={classes.source} onClick={() => onOpen(document.licenseUrl)}>
                  {document.license}
                </Link>
              </>
            )}
            {props.factsUrl && (
              <>
                {' · '}
                {t('biography.facts')}{' '}
                <Link className={classes.source} onClick={() => onOpen(props.factsUrl ?? '')}>
                  MusicBrainz
                </Link>
                {' · '}
                <Link
                  className={classes.source}
                  onClick={() => onOpen('https://creativecommons.org/publicdomain/zero/1.0/')}
                >
                  CC0
                </Link>
              </>
            )}
          </div>
          {details && (
            <div>
              <Link className={classes.source} onClick={() => onOpen(details.url)}>
                {t('biography.detailsSource')}
              </Link>
              {' · '}
              {t('biography.cachedAt')} {new Date(details.fetchedAt).toLocaleDateString()}
            </div>
          )}
          <div className={styles.links}>
            {document && (
              <Link onClick={() => onOpen(document.url)}>{t('biography.readFull')}</Link>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
