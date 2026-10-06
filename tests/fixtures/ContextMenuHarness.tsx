import { Button, FluentProvider } from '@fluentui/react-components';
import { useState } from 'react';
import { ContextMenu } from '../../src/kit/context-menu/ContextMenu.tsx';
import type { ContextMenuPoint } from '../../src/kit/context-menu/contextMenuGeometry.ts';
import type { ContextMenuEntry } from '../../src/kit/context-menu/contextMenuItems.ts';
import { MENU_SURFACE_MOTION } from '../../src/motion/MenuMotion.tsx';
import { darkTheme, lightTheme } from '../../src/theme/themes.ts';

export function ContextMenuHarness() {
  const [at, setAt] = useState<ContextMenuPoint | null>(null);
  const [version, setVersion] = useState(1);
  const [result, setResult] = useState('');
  const [closedBy, setClosedBy] = useState('');
  const params = new URLSearchParams(location.search);
  const command = (id: string, label: string): ContextMenuEntry => ({
    kind: 'command',
    id,
    label,
    onSelect: () => setResult(id),
  });
  const items: ContextMenuEntry[] = [
    command('play', '播放所选'),
    {
      kind: 'command',
      id: 'retry',
      label: '重新读取',
      keepOpen: true,
      onSelect: () => setResult('retried'),
    },
    {
      kind: 'command',
      id: 'invalidate',
      label: '更新对象',
      keepOpen: true,
      onSelect: () => setVersion(version + 1),
    },
    {
      kind: 'submenu',
      id: 'send-to',
      label: '发送到播放列表',
      items: [
        command('new', '新建播放列表'),
        ...Array.from({ length: 35 }, (_, i) => command(`target-${i}`, `播放列表 ${i}`)),
        {
          kind: 'submenu',
          id: 'nested',
          label: '更多目标',
          items: [command('deep', '深层目标')],
        },
      ],
    },
    {
      kind: 'submenu',
      id: 'rating',
      label: '评分',
      items: [
        {
          ...command('three', '3 星'),
          kind: 'command',
          id: 'three',
          label: '3 星',
          checked: true,
          check: 'radio',
          onSelect: () => setResult('three'),
        },
        {
          kind: 'command',
          id: 'five',
          label: '5 星',
          checked: false,
          check: 'radio',
          onSelect: () => setResult('five'),
        },
      ],
    },
    {
      kind: 'command',
      id: 'locked',
      label: '从播放列表移除',
      disabled: true,
      reason: '播放列表已锁定',
      onSelect: () => setResult('locked'),
    },
    ...Array.from({ length: 30 }, (_, i) => command(`extra-${i}`, `扩展命令 ${i}`)),
    command('long', '转换为无损格式并保留原目录结构和完整的曲目信息'.repeat(3)),
  ];
  return (
    <FluentProvider theme={params.has('light') ? lightTheme : darkTheme}>
      <div style={{ minHeight: 1600 }}>
        <Button
          data-open-menu
          onClick={(event) => {
            event.currentTarget.focus();
            setAt({ x: event.clientX, y: event.clientY });
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.currentTarget.focus();
            setAt({ x: event.clientX, y: event.clientY });
          }}
        >
          曲目
        </Button>
        <Button data-change-target onClick={() => setVersion(version + 1)}>
          更换对象
        </Button>
        <input aria-label="其他输入" />
        <output>{result}</output>
        <span data-closed-by>{closedBy}</span>
      </div>
      <ContextMenu
        at={at}
        targetKey={String(version)}
        title="已选 3 首"
        subtitle="Massive Attack · 58:24"
        backLabel="返回"
        items={items}
        surfaceMotion={MENU_SURFACE_MOTION}
        onClose={(reason) => {
          setClosedBy(reason);
          setAt(null);
        }}
      />
    </FluentProvider>
  );
}
