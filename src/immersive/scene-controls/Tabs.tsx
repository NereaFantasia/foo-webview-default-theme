import { Tab } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { createPortal } from 'react-dom';
import { translateAtom } from '../../i18n/locale.ts';
import type { MessageKey } from '../../i18n/en.ts';
import { TabList } from '../../motion/Surfaces.tsx';
import { sceneStateAtom } from '../scene/sceneActions.ts';
import { useControlSlots, useSceneActions } from '../scene/sceneContext.ts';
import { useSceneTabStyles } from '../scene/tabStyles.ts';
import { SIDEBAR_PAGES } from '../scene/sceneState.ts';

const PAGE_LABELS: Readonly<Record<(typeof SIDEBAR_PAGES)[number], MessageKey>> = {
  lyrics: 'rightCard.page.lyrics',
  queue: 'rightCard.page.queue',
  history: 'immersive.page.history',
};

/**
 * 沉浸模式侧栏内容页签栏
 *
 * 在歌词、队列与播放历史之间切换当前子视图；支持左右方向键切换，通过场景动作触发切页并自动解除强制折叠，
 * 渲染结果通过 Portal 注入控制层中心插槽
 */
export function Tabs() {
  const t = useAtomValueRawSync(translateAtom);
  const actions = useSceneActions();
  const { page } = useAtomValueRawSync(sceneStateAtom);
  const classes = useSceneTabStyles();
  const slots = useControlSlots();
  const tabs = (
    <div data-scene-element="tabs">
      <TabList
        size="small"
        className={classes.list}
        selectedValue={page}
        aria-label={t('immersive.pages')}
        onTabSelect={(_, data) => {
          const next = SIDEBAR_PAGES.find((candidate) => candidate === data.value);
          if (next) actions.selectPage(next);
        }}
      >
        {SIDEBAR_PAGES.map((value) => (
          <Tab
            key={value}
            className={classes.tab}
            content={{ className: classes.text }}
            value={value}
            data-sidebar-page={value}
          >
            {t(PAGE_LABELS[value])}
          </Tab>
        ))}
      </TabList>
    </div>
  );
  if (!slots) return tabs;
  return slots.tabs ? createPortal(tabs, slots.tabs) : null;
}
