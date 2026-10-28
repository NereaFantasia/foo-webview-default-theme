import js from '@eslint/js';
import { getStaticValue } from '@eslint-community/eslint-utils';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { immersiveLayering, layering } from './scripts/eslint-layering.mjs';

const publicSdkPath =
  /^foo-webview-sdk(?:\/(?:(?:bridge|components|smp-compat)(?:\.global)?|schema))?$/;
const privateSdkPath = /(?:^|[/\\])sdk[/\\](?:src|dist)(?:[/\\]|$)/;
const boundaryMessage = 'Use the public foo-webview-sdk package entry points.';
const nativeMessage = 'Access host capabilities through foo-webview-sdk.';

/**
 * 限制仅允许从 SDK 声明的公开入口导入；拦截深层路径或指向本地 sdk/src、sdk/dist 的引用
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

/**
 * 业务对象跳转统一经由 nav/objectOpener.ts 处理（数据获取、状态切换、激活与提示单点维护）
 * @type {import('eslint').Rule.RuleModule}
 */
const objectNavigation = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { opener: 'Open library and online objects through the object opener.' },
  },
  create(context) {
    const id =
      "Property[key.name='id'][value.value=/^(album|artists|genres|folders|playlist|onlineList|onlineAlbums)$/]";
    /** @param {import('eslint').Rule.Node} node */
    const report = (node) => context.report({ node, messageId: 'opener' });
    return {
      [`CallExpression[callee.property.name='navigate'] > ObjectExpression > ${id}`]: report,
    };
  },
};

const doubleAssertion = {
  selector: ':matches(TSAsExpression, TSTypeAssertion) > :matches(TSAsExpression, TSTypeAssertion)',
  message: 'Validate unknown values instead of using a double assertion.',
};

// 按键统一走命令登记处按层分派，禁止在窗口或文档上随意监听 keydown
const windowKeydown = {
  selector:
    "CallExpression[callee.property.name='addEventListener'][callee.object.name=/^(window|document)$/][arguments.0.value='keydown']",
  message: 'Register keys with the command registry.',
};

// 宿主配置写入必须经由 host/configWrite.ts 记录代数版本
const hostConfigWrite = {
  selector:
    "CallExpression[callee.property.name=/^(set|remove)$/][callee.object.type='MemberExpression'][callee.object.property.name='config']",
  message: 'Write host config through host/configWrite.ts so the write records a generation.',
};

// 曲目封面统一经由 covers/trackArtwork.ts 分流获取，支持在线曲目解析
const hostArtworkUrl = {
  selector: 'MemberExpression[property.name=/^getFb2kUrlByPath(Batch)?$/]',
  message: 'Request track artwork through covers/trackArtwork.ts so online tracks get their cover.',
};
const artworkOwners = ['src/covers/trackArtwork.ts', 'src/library/**/*.{ts,tsx}'];

// 曲目来源与能力查询统一查验 host/trackOrigin.ts 能力表
const onlineAddressReaders = {
  group: ['**/server/onlineAddress.ts'],
  importNames: ['readOnlineAddress'],
  message: 'Check track origin and abilities through host/trackOrigin.ts.',
};
const onlineAddressOwners = [
  'src/server/**/*.ts',
  'src/host/trackOrigin.ts',
  'src/playback/**/*.ts',
  'src/covers/trackArtwork.ts',
  'src/track/displayTrack.ts',
  'src/library/search/online/**/*.{ts,tsx}',
];

// 浏览器持久化存储统一封装于 kit/ 模块并记录写入代数
const browserStores = ['localStorage', 'sessionStorage', 'indexedDB'].map((name) => ({
  name,
  message: 'Read and write browser data through kit/ so the write records a generation.',
}));

// Jotai 状态读取统一采用 useAtomValueRawSync 确保外部存储快照一致性
const atomReaders = {
  paths: ['jotai', 'jotai/react'].map((name) => ({
    name,
    importNames: ['useAtomValue', 'useAtom'],
    message: 'Read atoms with useAtomValueRawSync; write with useSetAtom.',
  })),
};

export default [
  {
    // 忽略构建产物、测试输出与第三方依赖目录
    ignores: [
      'node_modules/**',
      'dist/**',
      'release/**',
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
      theme: {
        rules: {
          'sdk-boundary': sdkBoundary,
          layering,
          'immersive-layering': immersiveLayering,
          'object-navigation': objectNavigation,
        },
      },
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
    // 命令登记处作为唯一合法的窗口级按键监听入口
    ignores: ['src/nav/commandRegistry.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        doubleAssertion,
        windowKeydown,
        hostConfigWrite,
        hostArtworkUrl,
      ],
      'no-restricted-imports': ['error', { ...atomReaders, patterns: [onlineAddressReaders] }],
    },
  },
  {
    files: ['src/host/configWrite.ts'],
    rules: { 'no-restricted-syntax': ['error', doubleAssertion, windowKeydown, hostArtworkUrl] },
  },
  {
    files: artworkOwners,
    rules: { 'no-restricted-syntax': ['error', doubleAssertion, windowKeydown, hostConfigWrite] },
  },
  {
    files: onlineAddressOwners,
    rules: { 'no-restricted-imports': ['error', atomReaders] },
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
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/nav/**',
      'src/app/**',
      'src/library/artists/artistPlaces.ts',
      'src/library/folders/foldersServices.ts',
    ],
    rules: { 'theme/object-navigation': 'error' },
  },
  {
    // 分层架构依赖方向校验（规则定义于 scripts/eslint-layering.mjs）
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'theme/layering': 'error' },
  },
  {
    // 沉浸模式内部依赖边界校验（规则定义于 scripts/eslint-layering.mjs）
    files: ['src/immersive/**/*.{ts,tsx}'],
    rules: { 'theme/immersive-layering': 'error' },
  },
];
