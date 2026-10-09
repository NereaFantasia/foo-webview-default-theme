// ESLint 规则：src/ 内的相对导入只许往下层走，第 2 层的业务目录之间不互相导入。
// 层表就是下面的 LAYERS；src/ 下出现没登记的顶层目录也报，新建或改名的目录要先定层，规则才不会悄悄放过它。
// 没有存量基线，也不为它加抑制：越层的导入要改结构，不能放行。
import { dirname, relative, resolve, sep } from 'node:path';

/**
 * src/ 的顶层目录与直属文件 → 层。0 基础，1 共享领域，2 业务，3 装配。
 * @type {Readonly<Record<string, 0 | 1 | 2 | 3>>}
 */
export const LAYERS = {
  host: 0,
  server: 0,
  i18n: 0,
  theme: 0,
  motion: 0,
  styles: 0,
  kit: 0,
  playback: 1,
  track: 1,
  table: 1,
  covers: 1,
  nav: 1,
  lyrics: 1,
  library: 2,
  playlist: 2,
  settings: 2,
  immersive: 2,
  shell: 2,
  video: 2,
  update: 2,
  app: 3,
  'App.tsx': 3,
  'main.tsx': 3,
};

/**
 * 路径在 src/ 下时给出顶层段（目录名或直属文件名），否则 null。
 * @param {string} srcRoot
 * @param {string} path
 */
function topOf(srcRoot, path) {
  const inside = relative(srcRoot, path);
  if (!inside || inside.startsWith('..') || resolve(srcRoot, inside) !== path) return null;
  return inside.split(sep)[0] ?? null;
}

/** @param {string} top */
function layerOf(top) {
  return Object.hasOwn(LAYERS, top) ? LAYERS[top] : undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export const layering = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      upward: 'src/{{from}} (layer {{fromLayer}}) must not import src/{{to}} (layer {{toLayer}}).',
      crossBusiness:
        'Business directories must not import each other (src/{{from}} -> src/{{to}}): inject an interface from app/ or move the shared part to layer 0 or 1.',
      unknown: 'src/{{dir}} has no layer; register it in LAYERS of scripts/eslint-layering.mjs.',
      isolated:
        'The boot entry must stay independent: it cannot import packages or other src/ directories, and other src/ directories cannot import it.',
    },
  },
  create(context) {
    const srcRoot = resolve(context.cwd, 'src');
    const file = resolve(context.cwd, context.filename);
    const from = topOf(srcRoot, file);
    if (from === null) return {};
    const fromLayer = layerOf(from);

    /** @param {import('estree').Node & { source?: import('estree').Node | null }} node */
    function check(node) {
      const source = node.source;
      if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return;
      if (from === 'boot' && !source.value.startsWith('.')) {
        context.report({ node: source, messageId: 'isolated' });
        return;
      }
      if (!source.value.startsWith('.')) return;
      const to = topOf(srcRoot, resolve(dirname(file), source.value));
      if (from !== to && (from === 'boot' || to === 'boot')) {
        context.report({ node: source, messageId: 'isolated' });
        return;
      }
      if (to === null || to === from) return;
      const toLayer = layerOf(to);
      if (toLayer === undefined) {
        context.report({ node: source, messageId: 'unknown', data: { dir: to } });
        return;
      }
      if (fromLayer === undefined) return;
      const data = { from, to, fromLayer: String(fromLayer), toLayer: String(toLayer) };
      if (toLayer > fromLayer) context.report({ node: source, messageId: 'upward', data });
      else if (toLayer === 2 && fromLayer === 2)
        context.report({ node: source, messageId: 'crossBusiness', data });
    }

    return {
      Program(node) {
        if (fromLayer === undefined && from !== 'boot')
          context.report({ node, messageId: 'unknown', data: { dir: from } });
      },
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};
