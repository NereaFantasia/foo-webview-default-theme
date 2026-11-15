import { Button, Tooltip } from '@fluentui/react-components';
import { Library20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { browserPanelKey } from '../../nav/browserPanel.ts';
import { backdropDegradedAtom } from '../backdrop/backdropState.ts';
import { useControlKeyClasses } from '../scene/controlKeyStyles.ts';

/**
 * 控制层左边设置键之后的一颗键：开关浏览面板
 *
 * 面板开着时是按下态。面板用不了（窗口窄到侧边栏收起、迷你窗口）时不出。面板的点外面收起把这颗键排除在外
 * （`data-browse-key`），免得按下时先收起、随后的单击又把它打开
 */
export function BrowseKey() {
  const t = useAtomValueRawSync(translateAtom);
  const browser = useService(browserPanelKey);
  const open = useAtomValueRawSync(browser.open);
  const available = useAtomValueRawSync(browser.available);
  const keys = useControlKeyClasses(useAtomValueRawSync(backdropDegradedAtom));
  if (!available) return null;
  return (
    <Tooltip content={t('immersive.browse')} relationship="label">
      <Button
        appearance="transparent"
        shape="circular"
        className={keys.key}
        icon={<Library20Regular />}
        aria-pressed={open}
        data-browse-key
        onClick={browser.toggle}
      />
    </Tooltip>
  );
}
