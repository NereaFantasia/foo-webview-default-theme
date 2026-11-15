import type { StoredOptions } from './presetOptions.ts';
import type { SceneView } from './sceneState.ts';

/**
 * 预设模板收到的属性：场景状态推出的版式，和这个预设的用户存档（只含认得的键与合法的值，没改过就没有）
 *
 * 模板自己按预设声明的可调项合并缺省（`mergeOptions`）；宿主不替它合并，免得登记表里的预设类型各不相同
 */
export interface PresetTemplateProps {
  readonly scene: SceneView;
  readonly stored?: StoredOptions;
}
