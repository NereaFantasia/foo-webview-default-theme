import { Button, makeStyles, mergeClasses, type ButtonProps } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useMemo } from 'react';
import { AccentContext } from './accentContext.ts';
import { globalAccentToneAtom } from './accentState.ts';
import { colorSchemeAtom } from './colorScheme.ts';
import { playButtonColors } from './playButtonColors.ts';
import { playButtonStyleAtom } from './playButtonStyle.ts';

const useStyles = makeStyles({
  colored: {
    backgroundColor: 'var(--play-button-bg)',
    color: 'var(--play-button-fg)',
    '& .fui-Button__icon': { color: 'var(--play-button-icon)' },
    ':hover': {
      backgroundColor: 'var(--play-button-hover-bg)',
      color: 'var(--play-button-hover-fg)',
      '& .fui-Button__icon': { color: 'var(--play-button-hover-icon)' },
    },
    ':active': {
      backgroundColor: 'var(--play-button-pressed-bg)',
      color: 'var(--play-button-pressed-fg)',
      '& .fui-Button__icon': { color: 'var(--play-button-pressed-icon)' },
    },
  },
});

export function PrimaryPlayButton({ className, style, ...props }: ButtonProps) {
  const local = useContext(AccentContext);
  const global = useAtomValueRawSync(globalAccentToneAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const mode = useAtomValueRawSync(playButtonStyleAtom);
  const classes = useStyles();
  const colors = useMemo(
    () => playButtonColors(local ?? global, scheme, mode),
    [local, global, scheme, mode],
  );
  const variables = {
    '--play-button-bg': colors.rest.background,
    '--play-button-fg': colors.rest.foreground,
    '--play-button-icon': colors.rest.icon,
    '--play-button-hover-bg': colors.hover.background,
    '--play-button-hover-fg': colors.hover.foreground,
    '--play-button-hover-icon': colors.hover.icon,
    '--play-button-pressed-bg': colors.pressed.background,
    '--play-button-pressed-fg': colors.pressed.foreground,
    '--play-button-pressed-icon': colors.pressed.icon,
  };
  return (
    <Button
      {...props}
      appearance="primary"
      className={mergeClasses(
        !props.disabled && !props.disabledFocusable && classes.colored,
        className,
      )}
      style={{ ...variables, ...style }}
    />
  );
}
