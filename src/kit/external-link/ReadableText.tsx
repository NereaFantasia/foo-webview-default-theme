import { Link, makeStyles } from '@fluentui/react-components';
import { readableUrl, textLinks, type TextLinkRange } from './textLinks.ts';
import styles from './ReadableText.module.css';

const useStyles = makeStyles({
  link: {
    fontSize: 'inherit',
    lineHeight: 'inherit',
    verticalAlign: 'baseline',
    overflowWrap: 'anywhere',
    whiteSpace: 'inherit',
  },
});

export function ReadableText({
  text,
  links = [],
  onOpen,
}: {
  readonly text: string;
  readonly links?: readonly TextLinkRange[];
  readonly onOpen: (url: string) => void;
}) {
  const classes = useStyles();
  return (
    <span className={styles.root}>
      {textLinks(text, links).map((part, index) =>
        part.url ? (
          <Link
            key={index}
            className={classes.link}
            href={part.url}
            title={part.url}
            onClick={(event) => {
              event.preventDefault();
              if (part.url) onOpen(part.url);
            }}
            onAuxClick={(event) => {
              event.preventDefault();
              if (event.button === 1 && part.url) onOpen(part.url);
            }}
          >
            {readableUrl(part.text)}
          </Link>
        ) : (
          part.text
        ),
      )}
    </span>
  );
}
