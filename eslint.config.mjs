import js from '@eslint/js';
import { getStaticValue } from '@eslint-community/eslint-utils';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { layering } from './scripts/eslint-layering.mjs';

const publicSdkPath =
  /^foo-webview-sdk(?:\/(?:(?:bridge|components|smp-compat)(?:\.global)?|schema))?$/;
const privateSdkPath = /(?:^|[/\\])sdk[/\\](?:src|dist)(?:[/\\]|$)/;
const boundaryMessage = 'Use the public foo-webview-sdk package entry points.';
const nativeMessage = 'Access host capabilities through foo-webview-sdk.';

/**
 * 只许从 SDK 包声明的公开入口导入；深层路径、指向插件仓库 sdk/src 或 sdk/dist 的路径都拦下。
 * @type {import('eslint').Rule.RuleModule}
 */
const sdkBoundary = {
  meta: { type: 'problem', schema: [], messages: { boundary: boundaryMessage } },
  create(context) {
    /** @param {import('eslint').Rule.Node} node */
    function check(node) {
      const parent = node.parent;
      if (!parent) return;
      const pathContext =
        [
          'ImportDeclaration',
          'ImportExpression',
          'ExportNamedDeclaration',
          'ExportAllDeclaration',
          'TSLiteralType',
          'TSImportType',
        ].includes(parent.type) ||
        (parent.type === 'CallExpression' &&
          parent.callee.type === 'Identifier' &&
          parent.callee.name === 'require');
      if (!pathContext) return;
      const value = getStaticValue(node, context.sourceCode.getScope(node))?.value;
      if (
        typeof value === 'string' &&
        (privateSdkPath.test(value) ||
          (value.startsWith('foo-webview-sdk/') && !publicSdkPath.test(value)))
      ) {
        context.report({ node, messageId: 'boundary' });
      }
    }
    return { Literal: check, TemplateLiteral: check };
  },
};

const doubleAssertion = {
  selector: ':matches(TSAsExpression, TSTypeAssertion) > :matches(TSAsExpression, TSTypeAssertion)',
  message: 'Validate unknown values instead of using a double assertion.',
};

// 按键统一走命令登记处按层分派；各自在窗口或文档上监听 keydown，Esc 与后退就会互相抢。
const windowKeydown = {
  selector:
    "CallExpression[callee.property.name='addEventListener'][callee.object.name=/^(window|document)$/][arguments.0.value='keydown']",
  message: 'Register keys with the command registry.',
};

// 写入代数是永久契约，漏记一处，以后那个键换格式时就选不对迁移源。宿主 config 只由 host/configWrite.ts
// 在写锁里写并记代数；这里按写法认 `xxx.config.set / remove(...)`，解构出来的 config 认不出。
const hostConfigWrite = {
  selector:
    "CallExpression[callee.property.name=/^(set|remove)$/][callee.object.type='MemberExpression'][callee.object.property.name='config']",
  message: 'Write host config through host/configWrite.ts so the write records a generation.',
};

// 浏览器存储只由 kit/ 的 IndexedDB 适配与页面偏好存储碰：写入要记代数，localStorage 只留兼容值。
const browserStores = ['localStorage', 'sessionStorage', 'indexedDB'].map((name) => ({
  name,
  message: 'Read and write browser data through kit/ so the write records a generation.',
}));

// jotai 3 的 useAtomValue 在 effect 里才订阅、订阅时不补读，首帧之后、订阅之前写进 store 的值会丢；
// useAtomValueRawSync 走 useSyncExternalStore，订阅时再核对一次快照。useAtom 的读半边同样漏。
const atomReaders = {
  paths: ['jotai', 'jotai/react'].map((name) => ({
    name,
    importNames: ['useAtomValue', 'useAtom'],
    message: 'Read atoms with useAtomValueRawSync; write with useSetAtom.',
  })),
};

export default [
  {
    // 构建产物、测试输出、第三方包与不属于工程源码的目录不查。
    ignores: [
      'node_modules/**',
      'dist/**',
      'test-results/**',
      'playwright-report/**',
      'vendor/**',
      'docs/**',
      '.kiro/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: {
      theme: { rules: { 'sdk-boundary': sdkBoundary, layering } },
      'react-hooks': reactHooks,
    },
    rules: {
      'theme/sdk-boundary': 'error',
      'no-restricted-globals': [
        'error',
        { globals: [{ name: 'fb2k', message: nativeMessage }], checkGlobalObject: true },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'fb2k', message: nativeMessage },
        { property: 'webview', message: nativeMessage },
      ],
      'no-restricted-syntax': ['error', doubleAssertion],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    // 命令登记处本身是唯一挂窗口级 keydown 的地方。
    ignores: ['src/nav/commandRegistry.ts'],
    rules: {
      'no-restricted-syntax': ['error', doubleAssertion, windowKeydown, hostConfigWrite],
      'no-restricted-imports': ['error', atomReaders],
    },
  },
  {
    files: ['src/host/configWrite.ts'],
    rules: { 'no-restricted-syntax': ['error', doubleAssertion, windowKeydown] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/kit/browserDataStorage.ts',
      'src/kit/prefStorage.ts',
      'src/kit/loaderStorage.ts',
      'src/boot/main.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          globals: [{ name: 'fb2k', message: nativeMessage }, ...browserStores],
          checkGlobalObject: true,
        },
      ],
    },
  },
  {
    // 依赖方向，层表在 scripts/eslint-layering.mjs。
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'theme/layering': 'error' },
  },
];
