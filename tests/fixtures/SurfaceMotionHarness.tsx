import {
  Button,
  DialogBody,
  DialogSurface,
  DialogTitle,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  FluentProvider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  PopoverSurface,
  PopoverTrigger,
  Tab,
} from '@fluentui/react-components';
import { useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import {
  Dialog,
  FlyoutMotion,
  Menu,
  OverlayDrawer,
  Popover,
  TabList,
} from '../../src/motion/Surfaces.tsx';
import { MOTION_VARIABLES, REDUCED_MOTION_VARIABLES } from '../../src/motion/timing.ts';
import { darkTheme, lightTheme } from '../../src/theme/themes.ts';

const FLYOUT_STYLE: CSSProperties & Record<`--${string}`, string> = {
  '--fui-positioning-slide-direction-x': '0px',
  '--fui-positioning-slide-direction-y': '-1px',
  position: 'fixed',
  top: 300,
  left: 250,
  width: 200,
  height: 120,
};

export function SurfaceMotionHarness() {
  const params = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [flyout, setFlyout] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [menu, setMenu] = useState(false);
  const [popover, setPopover] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState('first');
  const [actions, setActions] = useState(0);
  const [finishes, setFinishes] = useState(0);
  const [cancels, setCancels] = useState<string[]>([]);
  return (
    <FluentProvider
      theme={params.has('light') ? lightTheme : darkTheme}
      style={{ ...MOTION_VARIABLES, ...(reduced ? REDUCED_MOTION_VARIABLES : {}) }}
    >
      <Button data-toggle-flyout onClick={() => flushSync(() => setFlyout(!flyout))}>
        开合浮层
      </Button>
      <Button data-toggle-dialog onClick={() => flushSync(() => setDialog(!dialog))}>
        开合对话框
      </Button>
      <Button data-unmount-flyout onClick={() => flushSync(() => setMounted(false))}>
        移除浮层
      </Button>
      <Button data-change-tab onClick={() => setTab(tab === 'first' ? 'second' : 'first')}>
        恢复标签
      </Button>
      <Button data-toggle-drawer onClick={() => flushSync(() => setDrawer(!drawer))}>
        开合抽屉
      </Button>
      <output data-actions>{actions}</output>
      <output data-finishes>{finishes}</output>
      <output data-cancels>{cancels.join(',')}</output>
      {mounted && (
        <FlyoutMotion
          visible={flyout}
          appear={!params.has('no-appear')}
          unmountOnExit
          onMotionCancel={(_, data) => setCancels((values) => [...values, data.direction])}
          onMotionFinish={(_, data) => {
            if (data.direction === 'exit') setFinishes((value) => value + 1);
          }}
        >
          <div data-flyout style={FLYOUT_STYLE}>
            <Button onClick={() => setActions(actions + 1)}>浮层操作</Button>
          </div>
        </FlyoutMotion>
      )}
      <Dialog open={dialog} onOpenChange={(_, data) => setDialog(data.open)}>
        <DialogSurface data-dialog>
          <DialogBody>
            <DialogTitle>动效对话框</DialogTitle>
            <Button data-dialog-action onClick={() => setActions(actions + 1)}>
              对话框操作
            </Button>
            <Button data-close-dialog onClick={() => flushSync(() => setDialog(false))}>
              关闭对话框
            </Button>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <OverlayDrawer open={drawer} position="end" unmountOnClose={false} data-drawer>
        <DrawerHeader>
          <DrawerHeaderTitle>侧向抽屉</DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody>
          <Button data-drawer-action>抽屉操作</Button>
        </DrawerBody>
      </OverlayDrawer>
      <Menu open={menu} onOpenChange={(_, data) => setMenu(data.open)}>
        <MenuTrigger disableButtonEnhancement>
          <Button data-menu-trigger>菜单</Button>
        </MenuTrigger>
        <MenuPopover data-menu>
          <MenuList>
            <MenuItem
              onClick={() => {
                setMenu(false);
                setDialog(true);
              }}
            >
              打开对话框
            </MenuItem>
            <MenuItem onClick={() => setActions(actions + 1)}>菜单操作</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <Popover open={popover} onOpenChange={(_, data) => setPopover(data.open)}>
        <PopoverTrigger disableButtonEnhancement>
          <Button data-popover-trigger>弹出层</Button>
        </PopoverTrigger>
        <PopoverSurface data-popover>
          <Button data-close-popover onClick={() => flushSync(() => setPopover(false))}>
            关闭弹出层
          </Button>
        </PopoverSurface>
      </Popover>
      <TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}>
        <Tab value="first">第一项</Tab>
        <Tab value="second">第二项</Tab>
      </TabList>
    </FluentProvider>
  );
}
