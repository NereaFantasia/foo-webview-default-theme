import { RuleTester } from 'eslint';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import {
  IMMERSIVE_LEGACY,
  IMMERSIVE_LEGACY_SHARED,
  LAYERS,
  immersiveLayering,
  layering,
} from '../../scripts/eslint-layering.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

/** 规则按工作目录下的 src/ 认层，用例的文件名取绝对路径。 */
function at(path: string): string {
  return resolve(process.cwd(), path);
}

describe('LAYERS', () => {
  it('src/ 下现有的每个顶层目录都登记了层', () => {
    const missing = readdirSync(at('src')).filter(
      (name) => name !== 'boot' && !Object.hasOwn(LAYERS, name),
    );
    if (missing.length) throw new Error(`没登记层：${missing.join('、')}`);
  });
});

tester.run('layering', layering, {
  valid: [
    { filename: at('src/boot/main.ts'), code: "import { a } from './loader.ts';" },
    { filename: at('src/app/x.ts'), code: "import { a } from '../update/loaderConfirmation.ts';" },
    { filename: at('src/library/AlbumWall.tsx'), code: "import { a } from './albums.ts';" },
    { filename: at('src/library/AlbumWall.tsx'), code: "import { a } from '../table/x.ts';" },
    { filename: at('src/table/x.ts'), code: "import type { T } from '../host/y.ts';" },
    { filename: at('src/kit/x.ts'), code: "import { t } from '../theme/y.ts';" },
    { filename: at('src/track/x.ts'), code: "import { t } from '../table/y.ts';" },
    { filename: at('src/immersive/x.ts'), code: "import { p } from '../playback/playback.ts';" },
    { filename: at('src/app/x.ts'), code: "import { a } from '../library/albums.ts';" },
    { filename: at('src/main.tsx'), code: "import { App } from './App.tsx';" },
    { filename: at('src/library/songs/x.ts'), code: "import { a } from '../albums.ts';" },
    { filename: at('src/library/x.ts'), code: "import { useMemo } from 'react';" },
    { filename: at('tests/unit/x.test.ts'), code: "import { a } from '../../src/shell/y.ts';" },
  ],
  invalid: [
    {
      filename: at('src/boot/main.ts'),
      code: "import { a } from '../kit/localPref.ts';",
      errors: [{ messageId: 'isolated' }],
    },
    {
      filename: at('src/app/x.ts'),
      code: "import { a } from '../boot/loader.ts';",
      errors: [{ messageId: 'isolated' }],
    },
    {
      filename: at('src/boot/main.ts'),
      code: "import { fb } from 'foo-webview-sdk/bridge';",
      errors: [{ messageId: 'isolated' }],
    },
    {
      filename: at('src/table/x.ts'),
      code: "import { a } from '../library/contract.ts';",
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: at('src/host/x.ts'),
      code: "import type { Store } from '../shell/store.ts';",
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: at('src/library/x.ts'),
      code: "export { a } from '../playlist/y.ts';",
      errors: [{ messageId: 'crossBusiness' }],
    },
    {
      filename: at('src/immersive/x.ts'),
      code: "export * from '../library/y.ts';",
      errors: [{ messageId: 'crossBusiness' }],
    },
    {
      filename: at('src/library/x.ts'),
      code: "const m = import('../app/y.ts');",
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: at('src/library/x.ts'),
      code: "import { a } from '../widgets/y.ts';",
      errors: [{ messageId: 'unknown', data: { dir: 'widgets' } }],
    },
    {
      filename: at('src/widgets/x.ts'),
      code: "import { a } from '../host/y.ts';",
      errors: [{ messageId: 'unknown', data: { dir: 'widgets' } }],
    },
  ],
});

describe('IMMERSIVE_LEGACY', () => {
  it('表里的每个旧目录都还在 src/immersive/ 下，白名单只放旧目录', () => {
    const present = readdirSync(at('src/immersive'));
    const missing = IMMERSIVE_LEGACY.filter((name) => !present.includes(name));
    if (missing.length) throw new Error(`旧目录表里有已不存在的：${missing.join('、')}`);
    const stray = IMMERSIVE_LEGACY_SHARED.filter((name) => !IMMERSIVE_LEGACY.includes(name));
    if (stray.length) throw new Error(`白名单里不是旧目录：${stray.join('、')}`);
  });
});

tester.run('immersive-layering', immersiveLayering, {
  valid: [
    // 旧目录之间的历史导入不管，也能导入宿主
    { filename: at('src/immersive/paper/x.ts'), code: "import { a } from '../dial/y.ts';" },
    { filename: at('src/immersive/dial/x.ts'), code: "import { a } from '../page/y.ts';" },
    // 宿主在旧目录里，能导入所有新目录
    { filename: at('src/immersive/page/x.ts'), code: "import { a } from '../presets/y.ts';" },
    { filename: at('src/immersive/page/x.ts'), code: "import { a } from '../lease/y.ts';" },
    { filename: at('src/immersive/page/x.ts'), code: "import { a } from '../layout/y.ts';" },
    // 元素只导入共用件与 frame，同目录与 immersive 外的不管
    { filename: at('src/immersive/layout/x.ts'), code: "import { a } from '../lease/y.ts';" },
    { filename: at('src/immersive/layout/x.ts'), code: "import { a } from '../frame/y.ts';" },
    { filename: at('src/immersive/layout/x.ts'), code: "import { a } from './y.ts';" },
    { filename: at('src/immersive/layout/x.ts'), code: "import { a } from '../../kit/y.ts';" },
    { filename: at('src/immersive/layout/x.ts'), code: "import { a } from 'react';" },
    // 预设导入元素与共用件
    { filename: at('src/immersive/presets/x.ts'), code: "import { a } from '../layout/y.ts';" },
    { filename: at('src/immersive/presets/x.ts'), code: "import { a } from '../backdrop/y.ts';" },
    { filename: at('src/immersive/presets/x.ts'), code: "import { a } from '../lease/y.ts';" },
    { filename: at('src/immersive/presets/x.ts'), code: "import { a } from '../frame/y.ts';" },
    // 场景状态一类的共用件，元素、预设与宿主都能导入
    { filename: at('src/immersive/layout/x.ts'), code: "import { a } from '../scene/y.ts';" },
    { filename: at('src/immersive/presets/x.ts'), code: "import { a } from '../scene/y.ts';" },
    { filename: at('src/immersive/page/x.ts'), code: "import { a } from '../scene/y.ts';" },
    // 共用件只用 immersive 外的
    { filename: at('src/immersive/lease/x.ts'), code: "import { a } from '../../kit/y.ts';" },
    { filename: at('src/immersive/scene/x.ts'), code: "import { a } from '../../kit/y.ts';" },
    // 不在 src/immersive/ 里的文件不归这条规则
    { filename: at('src/app/x.ts'), code: "import { a } from '../immersive/presets/y.ts';" },
    { filename: at('src/library/x.ts'), code: "import { a } from '../immersive/layout/y.ts';" },
    {
      filename: at('tests/unit/x.test.ts'),
      code: "import { a } from '../../src/immersive/layout/y.ts';",
    },
  ],
  invalid: [
    {
      filename: at('src/immersive/paper/x.ts'),
      code: "import { a } from '../presets/y.ts';",
      errors: [{ messageId: 'legacyToNew' }],
    },
    {
      filename: at('src/immersive/spectrum/x.ts'),
      code: "import { a } from '../lease/y.ts';",
      errors: [{ messageId: 'legacyToNew' }],
    },
    {
      filename: at('src/immersive/wash/x.ts'),
      code: "export { a } from '../layout/y.ts';",
      errors: [{ messageId: 'legacyToNew' }],
    },
    {
      filename: at('src/immersive/layout/x.ts'),
      code: "import { a } from '../paper/y.ts';",
      errors: [{ messageId: 'newToLegacy' }],
    },
    {
      filename: at('src/immersive/layout/x.ts'),
      code: "import { a } from '../page/y.ts';",
      errors: [{ messageId: 'newToLegacy' }],
    },
    {
      filename: at('src/immersive/presets/x.ts'),
      code: "const m = import('../spectrum/y.ts');",
      errors: [{ messageId: 'newToLegacy' }],
    },
    {
      filename: at('src/immersive/lease/x.ts'),
      code: "import { a } from '../layout/y.ts';",
      errors: [{ messageId: 'sharedIsolated' }],
    },
    {
      filename: at('src/immersive/lease/x.ts'),
      code: "import { a } from '../frame/y.ts';",
      errors: [{ messageId: 'sharedIsolated' }],
    },
    {
      filename: at('src/immersive/scene/x.ts'),
      code: "import { a } from '../lease/y.ts';",
      errors: [{ messageId: 'sharedIsolated' }],
    },
    {
      filename: at('src/immersive/scene/x.ts'),
      code: "import { a } from '../frame/y.ts';",
      errors: [{ messageId: 'sharedIsolated' }],
    },
    {
      filename: at('src/immersive/paper/x.ts'),
      code: "import { a } from '../scene/y.ts';",
      errors: [{ messageId: 'legacyToNew' }],
    },
    {
      filename: at('src/immersive/layout/x.ts'),
      code: "import { a } from '../presets/y.ts';",
      errors: [{ messageId: 'elementToPreset' }],
    },
    {
      filename: at('src/immersive/layout/x.ts'),
      code: "import { a } from '../backdrop/y.ts';",
      errors: [{ messageId: 'elementToElement' }],
    },
    {
      filename: at('src/immersive/backdrop/x.ts'),
      code: "export * from '../customize/y.ts';",
      errors: [{ messageId: 'elementToElement' }],
    },
  ],
});
