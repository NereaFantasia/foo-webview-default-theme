import {
  Button,
  FluentProvider,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
} from '@fluentui/react-components';
import { Play16Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { Menu } from '../../src/motion/Surfaces.tsx';
import { MenuSurface } from '../../src/theme/MenuSurface.tsx';
import { darkTheme, lightTheme } from '../../src/theme/themes.ts';

export function MenuMotionHarness() {
  const params = new URLSearchParams(location.search);
  const up = params.has('up');
  const left = params.has('left');
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <FluentProvider theme={params.has('light') ? lightTheme : darkTheme}>
      <output data-count>{count}</output>
      <Menu
        open={open}
        onOpenChange={(_, data) => flushSync(() => setOpen(data.open))}
        positioning={{ position: up ? 'above' : 'below', align: 'start' }}
      >
        <MenuTrigger disableButtonEnhancement>
          <Button
            data-trigger
            style={{
              position: 'fixed',
              top: up ? 650 : 150,
              left: params.has('edge') ? 1100 : left ? 750 : 150,
            }}
          >
            菜单
          </Button>
        </MenuTrigger>
        <MenuSurface data-primary>
          <MenuList>
            <MenuItem icon={<Play16Regular />} onClick={() => setCount(count + 1)}>
              播放
            </MenuItem>
            <Menu
              defaultCheckedValues={{ target: ['one'] }}
              positioning={{ position: left ? 'before' : 'after', align: up ? 'bottom' : 'top' }}
            >
              <MenuTrigger disableButtonEnhancement>
                <MenuItem data-subtrigger>发送到</MenuItem>
              </MenuTrigger>
              <MenuSurface data-child>
                <MenuList>
                  <MenuItem onClick={() => setCount(count + 1)}>新建播放列表</MenuItem>
                  <MenuItemRadio name="target" value="one">
                    收藏
                  </MenuItemRadio>
                  <MenuItem disabled>不可用</MenuItem>
                </MenuList>
              </MenuSurface>
            </Menu>
            <MenuItem disabled>不可用</MenuItem>
          </MenuList>
        </MenuSurface>
      </Menu>
    </FluentProvider>
  );
}
