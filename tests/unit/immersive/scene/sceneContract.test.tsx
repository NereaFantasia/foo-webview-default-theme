import { describe, expect, it } from 'vitest';
import {
  SCENE_MARK,
  allSceneViews,
  checkPreset,
  renderedElements,
  requiredElements,
  type ContractPreset,
  type SceneElementName,
} from '../../../fixtures/sceneContract.ts';
import type { SceneView } from '../../../../src/immersive/scene/sceneState.ts';

/** 按场景状态老老实实排元素的假预设：框架自己的试金石，真预设做出来后照样交给 `checkPreset` */
function Mark({ name }: { name: SceneElementName }) {
  return <div {...{ [SCENE_MARK]: name }} />;
}

function Good({ scene }: { scene: SceneView }) {
  return (
    <section>
      {requiredElements(scene).map((name) => (
        <Mark key={name} name={name} />
      ))}
    </section>
  );
}

const good: ContractPreset = { id: 'good', Template: Good };

describe('结构契约的框架', () => {
  it('场景状态遍历齐全：3 页 × 3 种侧栏方式 × 2 模式 × 3 种歌词 × 放不放得下', () => {
    expect(allSceneViews()).toHaveLength(3 * 3 * 2 * 3 * 2);
  });

  it('各状态下该有的元素', () => {
    const view = allSceneViews().find(
      (candidate) => candidate.mode === 'none' && candidate.page === 'queue' && !candidate.centered,
    );
    expect(requiredElements(view!)).toEqual([
      'cover',
      'info',
      'progress',
      'transport',
      'volume',
      'more',
      'tabs',
      'queue',
    ]);
  });

  it('Coverflow 模式里模板照常排自己的版式，页签已收，元素里没有 coverflow', () => {
    const view = allSceneViews().find(
      (candidate) =>
        candidate.mode === 'coverflow' && candidate.page === 'queue' && !candidate.centered,
    );
    expect(view?.showTabs).toBe(false);
    expect(requiredElements(view!)).toEqual([
      'cover',
      'info',
      'progress',
      'transport',
      'volume',
      'more',
      'queue',
    ]);
    for (const candidate of allSceneViews()) {
      expect(requiredElements(candidate)).not.toContain('coverflow');
    }
  });

  it('按版式排元素的预设全部通过，顺序也对', () => {
    expect(checkPreset(good)).toEqual([]);
    expect(checkPreset({ ...good, order: ['cover', 'info', 'progress', 'transport'] })).toEqual([]);
  });

  it('播放顺序键可有可无，所有版式都一样', () => {
    function WithOrder({ scene }: { scene: SceneView }) {
      return (
        <section>
          <Good scene={scene} />
          <Mark name="order" />
        </section>
      );
    }
    expect(checkPreset({ id: 'order', Template: WithOrder })).toEqual([]);
    expect(requiredElements(allSceneViews()[0]!)).not.toContain('order');
  });

  it('模板里画了 coverflow 就报：舞台归宿主', () => {
    function WithStage({ scene }: { scene: SceneView }) {
      return (
        <section>
          <Good scene={scene} />
          <Mark name="coverflow" />
        </section>
      );
    }
    const problems = checkPreset({ id: 'stage', Template: WithStage });
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) expect(problem).toContain('不该有 coverflow');
    // 夹具把相同的描述去重，模式里的版式与常规版式都查到了
    expect(problems.some((problem) => problem.includes('/ coverflow '))).toBe(true);
    expect(problems.some((problem) => problem.includes('/ none '))).toBe(true);
  });

  it('只认标记表里的名字，别的标记不管', () => {
    function Extra({ scene }: { scene: SceneView }) {
      return (
        <section>
          <div {...{ [SCENE_MARK]: 'decor' }} />
          <Good scene={scene} />
        </section>
      );
    }
    const [view] = allSceneViews();
    expect(renderedElements({ id: 'extra', Template: Extra }, view!)).toEqual(
      requiredElements(view!),
    );
    expect(checkPreset({ id: 'extra', Template: Extra })).toEqual([]);
  });

  it('漏元素、多元素、重复封面与顺序错都查得出', () => {
    function NoTransport({ scene }: { scene: SceneView }) {
      return (
        <section>
          {requiredElements(scene)
            .filter((name) => name !== 'transport')
            .map((name) => (
              <Mark key={name} name={name} />
            ))}
        </section>
      );
    }
    function TabsAlways({ scene }: { scene: SceneView }) {
      return (
        <section>
          <Good scene={scene} />
          <Mark name="tabs" />
        </section>
      );
    }
    function TwoCovers({ scene }: { scene: SceneView }) {
      return (
        <section>
          <Good scene={scene} />
          <Mark name="cover" />
        </section>
      );
    }
    function Reversed({ scene }: { scene: SceneView }) {
      return (
        <section>
          {[...requiredElements(scene)].reverse().map((name) => (
            <Mark key={name} name={name} />
          ))}
        </section>
      );
    }
    expect(checkPreset({ id: 'a', Template: NoTransport }).join('\n')).toContain('缺 transport');
    expect(checkPreset({ id: 'b', Template: TabsAlways }).join('\n')).toContain('不该有 tabs');
    expect(checkPreset({ id: 'c', Template: TwoCovers }).join('\n')).toContain('当前封面出现多次');
    expect(
      checkPreset({ id: 'd', Template: Reversed, order: ['cover', 'info'] }).join('\n'),
    ).toContain('顺序是');
  });
});
