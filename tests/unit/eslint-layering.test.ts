import { RuleTester } from 'eslint';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { LAYERS, layering } from '../../scripts/eslint-layering.mjs';

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
