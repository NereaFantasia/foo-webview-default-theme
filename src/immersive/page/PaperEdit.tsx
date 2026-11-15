import { EDIT_BACKGROUND, EDIT_MORE, EDIT_VIEW, EDIT_WAVEFORM } from './editSession.ts';
import { EditHost, type EditSpec } from './EditHost.tsx';
import {
  PaperBackgroundSection,
  PerformanceSection,
  ViewStyleSection,
  WaveformSection,
} from './SettingsSections.tsx';

/**
 * 图纸视图的分类：视图（视图样式）、背景（封面底色与山脊图）、波形、其他（性能）；都只有一组，不画组标题
 *
 * 波形在右边的仪表面板里，它的卡片停在左边，压在封面上；其余停在右边。图纸视图没有可描的元素，也没有拖柄
 */
const PAPER_CATEGORIES: readonly [EditSpec, ...EditSpec[]] = [
  {
    id: EDIT_VIEW,
    label: 'immersive.edit.view',
    dock: 'end',
    content: <ViewStyleSection titled={false} />,
  },
  {
    id: EDIT_BACKGROUND,
    label: 'immersive.settings.background',
    dock: 'end',
    content: <PaperBackgroundSection titled={false} />,
  },
  {
    id: EDIT_WAVEFORM,
    label: 'immersive.edit.waveform',
    dock: 'start',
    content: <WaveformSection titled={false} />,
  },
  {
    id: EDIT_MORE,
    label: 'immersive.settings.more',
    dock: 'end',
    content: <PerformanceSection titled={false} />,
  },
];

/** 图纸视图的设置编辑；图纸没有场景上下文，所以直接放在视图里 */
export function PaperEdit() {
  return <EditHost categories={PAPER_CATEGORIES} />;
}
