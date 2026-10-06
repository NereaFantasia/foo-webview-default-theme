import {
  Button,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  createPresenceComponent,
  makeStyles,
  type OverlayDrawerProps,
} from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { CURVE } from '../../motion/timing.ts';

/** WinUI SplitView 的侧向浮层：打开 350 ms，关闭 120 ms；减弱动效由 Fluent 缩到终态。 */
const DrawerMotion = createPresenceComponent({
  enter: {
    keyframes: [{ translate: '-100% 0' }, { translate: '0 0' }],
    duration: 350,
    easing: CURVE.decelerateMax.timing,
  },
  exit: {
    keyframes: [{ translate: '0 0' }, { translate: '-100% 0' }],
    duration: 120,
    easing: CURVE.decelerateMax.timing,
  },
});
const DRAWER_MOTION: OverlayDrawerProps['surfaceMotion'] = {
  children: (_, props) => <DrawerMotion {...props} />,
};

const useStyles = makeStyles({
  drawer: { width: '320px', maxWidth: '100vw' },
  body: { display: 'flex', flexDirection: 'column', minHeight: 0, padding: 0 },
});
interface LibraryDrawerProps {
  readonly open: boolean;
  readonly title: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
  onOpenChange(open: boolean): void;
}
export function LibraryDrawer(props: LibraryDrawerProps) {
  const classes = useStyles();
  return (
    <OverlayDrawer
      surfaceMotion={DRAWER_MOTION}
      className={classes.drawer}
      position="start"
      open={props.open}
      onOpenChange={(_, data) => props.onOpenChange(data.open)}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="transparent"
              icon={<Dismiss20Regular />}
              aria-label={props.closeLabel}
              onClick={() => props.onOpenChange(false)}
            />
          }
        >
          {props.title}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody className={classes.body}>{props.children}</DrawerBody>
    </OverlayDrawer>
  );
}
