// ESLint 规则：src/ 分层依赖方向校验（仅允许单向向下层依赖，业务目录之间相互隔离）
// 顶层目录必须在 LAYERS 表中定层，未定层目录抛出错误；无存量豁免基线
import { dirname, relative, resolve, sep } from 'node:path';

/**
 * 顶层目录与入口文件的分层映射表（0 基础，1 领域共享，2 业务，3 装配组合）
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
 * 提取文件路径在 src/ 下的所属顶层段（目录或根级文件）；非 src 路径返回 null
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

/**
 * src/immersive/ 存量目录清单（历史图纸场景及其共享组件）
 * 规则限定存量目录与新场景目录之间的依赖边界；未在此表中的目录视为新场景目录
 */
export const IMMERSIVE_LEGACY = [
  'analysis',
  'decor',
  'dial',
  'fields',
  'frame',
  'gauges',
  'lyrics',
  'page',
  'paper',
  'perf',
  'spectrum',
  'stereo',
  'tempo',
  'terrain',
  'wash',
  'waveform',
];

/** 新目录可以导入的旧目录：只有真正不依赖图纸场景的。别的件要用，先把用到的那部分下沉出来，不放行 */
export const IMMERSIVE_LEGACY_SHARED = ['frame'];

/** 新目录里的共用件：元素与预设都能导入，自己不导入 immersive/ 里的别的目录 */
export const IMMERSIVE_SHARED = ['lease', 'scene'];

/** @param {string} dir */
function immersiveKind(dir) {
  if (dir === 'page') return 'host';
  if (IMMERSIVE_LEGACY.includes(dir)) return 'legacy';
  if (IMMERSIVE_SHARED.includes(dir)) return 'shared';
  if (dir === 'presets') return 'preset';
  return 'element';
}

/**
 * 解析路径在 src/immersive/ 下的子目录名；非沉浸子目录路径返回 null
 * @param {string} srcRoot
 * @param {string} path
 */
function immersiveDirOf(srcRoot, path) {
  const base = resolve(srcRoot, 'immersive');
  const inside = relative(base, path);
  if (!inside || inside.startsWith('..') || resolve(base, inside) !== path) return null;
  const first = inside.split(sep)[0];
  return first && !first.includes('.') ? first : null;
}

/**
 * 判定沉浸模块间依赖边界合法性（合规返回 null，违规返回对应错误标识）
 * @param {string} from
 * @param {string} to
 */
function immersiveViolation(from, to) {
  const fromKind = immersiveKind(from);
  const toKind = immersiveKind(to);
  switch (fromKind) {
    case 'host':
      return null;
    case 'legacy':
      return toKind === 'legacy' || toKind === 'host' ? null : 'legacyToNew';
    case 'shared':
      return 'sharedIsolated';
    default:
      if (toKind === 'shared') return null;
      if (toKind === 'legacy') return IMMERSIVE_LEGACY_SHARED.includes(to) ? null : 'newToLegacy';
      if (toKind === 'host') return 'newToLegacy';
      if (toKind === 'preset') return 'elementToPreset';
      return fromKind === 'preset' ? null : 'elementToElement';
  }
}

/**
 * src/immersive/ 内部依赖方向校验规则
 *
 * 宿主 page/ 允许导入所有新目录；presets/ 允许导入元素与共享件；
 * 场景元素目录仅允许导入 lease/、scene/ 与 frame/，禁止元素间相互依赖；
 * 旧目录除 page/ 外禁止依赖任何新目录
 * @type {import('eslint').Rule.RuleModule}
 */
export const immersiveLayering = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      legacyToNew:
        'src/immersive/{{from}} belongs to the figure scene and must not import src/immersive/{{to}}; only page/ hosts the new directories.',
      newToLegacy:
        'src/immersive/{{from}} may only import frame/ from the figure-scene directories; src/immersive/{{to}} is not shared. Move the part you need down into a new shared directory.',
      sharedIsolated:
        'src/immersive/{{from}} is a shared piece and must not import other src/immersive directories (src/immersive/{{to}}).',
      elementToPreset:
        'Elements must not import presets (src/immersive/{{from}} -> src/immersive/{{to}}): a preset gives positions and parameters, elements do not know it.',
      elementToElement:
        'Elements must not import each other (src/immersive/{{from}} -> src/immersive/{{to}}): share through lease/ or scene/, or move the shared part down.',
    },
  },
  create(context) {
    const srcRoot = resolve(context.cwd, 'src');
    const file = resolve(context.cwd, context.filename);
    const dir = immersiveDirOf(srcRoot, file);
    if (dir === null) return {};
    const from = dir;

    /** @param {import('estree').Node & { source?: import('estree').Node | null }} node */
    function check(node) {
      const source = node.source;
      if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return;
      if (!source.value.startsWith('.')) return;
      const to = immersiveDirOf(srcRoot, resolve(dirname(file), source.value));
      if (to === null || to === from) return;
      const messageId = immersiveViolation(from, to);
      if (messageId) context.report({ node: source, messageId, data: { from, to } });
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};
