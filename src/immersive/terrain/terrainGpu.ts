import { rgbaOf } from '../frame/cssColor.ts';
import {
  ALPHA_FAR,
  ALPHA_NEAR,
  AMPLITUDE,
  FAR_WIDTH,
  type SpectrumHistory,
  type TerrainDrawOptions,
} from './terrain.ts';
import type { TerrainDrawer } from './terrainPainter.ts';
import { LINE_FRAGMENT, LINE_VERTEX } from './terrainLineShaders.ts';
import {
  FULLSCREEN_VERTEX,
  SKYLINE_SCAN_FRAGMENT,
  SKYLINE_SEED_FRAGMENT,
} from './terrainShaders.ts';

/**
 * 山脊图的 GPU 画法（WebGL2）：整幅在显卡上算，每帧脚本只设几个 uniform、发几次绘制命令。
 * 历史缓冲整份传成一张 R32F 纹理（行数 × 点数，按物理行存），只在缓冲进了新行时重传。
 *
 * 一帧三步：轮廓第一遍把每行折线在各 CSS 像素列的 y 写进纹理的下一行；再做几遍前缀最小值，行 k 成为
 * 它前面各行的合成轮廓（与 `skyline.ts` 逐行并进的结果相同）；最后一次实例化绘制画完所有行的折线、
 * 两侧竖边与基线，同一行里每个像素只由一段画（`terrainLineShaders.ts`）。几何与 CPU 画法的对应见 `terrainShaders.ts`。
 *
 * 与 `drawTerrain` 的差别：曲线恒切 4 份，不看 `flatness`（自适应细分与恒切 4 份差不到 0.1 物理像素）；
 * 不支持 `smooth`（重画循环从不设它）；被挡处按像素切齐，不做沿线的抗锯齿；线的覆盖率是盒式滤波，
 * 斜线与 Skia 的抗锯齿不逐像素相同。
 *
 * 要 WebGL2 与 `EXT_color_buffer_float`（轮廓纹理要当浮点渲染目标）；建上下文带 `failIfMajorPerformanceCaveat`，
 * 软件渲染等情形会被拒。缺哪样都由调用方退回 canvas 2D。
 */

/** 能开 WebGL2 的 canvas：主线程的 `HTMLCanvasElement`，Worker 里与探测用的 `OffscreenCanvas`。 */
export interface GpuCanvas {
  width: number;
  height: number;
  getContext(contextId: 'webgl2', options?: WebGLContextAttributes): WebGL2RenderingContext | null;
}

export const GPU_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  failIfMajorPerformanceCaveat: true,
};

const CORNERS = new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]);
/** 每行除折线的段以外还有两侧竖边与基线三段。 */
const EXTRA_SEGMENTS = 3;

type Uniforms = Record<string, WebGLUniformLocation | null>;

interface Program {
  program: WebGLProgram;
  uniforms: Uniforms;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!vs || !fs || !program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteProgram(program);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const uniforms: Uniforms = {};
  const count = Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS));
  for (let index = 0; index < count; index += 1) {
    const info = gl.getActiveUniform(program, index);
    if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

function floatTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

interface Renderer {
  draw(history: SpectrumHistory, options: TerrainDrawOptions): void;
  dispose(): void;
}

/** 编着色器、建纹理与缓冲；缺扩展或编不过返回 `null`。 */
function createRenderer(gl: WebGL2RenderingContext, canvas: GpuCanvas): Renderer | null {
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  const seed = link(gl, FULLSCREEN_VERTEX, SKYLINE_SEED_FRAGMENT);
  const scan = link(gl, FULLSCREEN_VERTEX, SKYLINE_SCAN_FRAGMENT);
  const line = link(gl, LINE_VERTEX, LINE_FRAGMENT);
  const historyTexture = floatTexture(gl);
  const skylines = [floatTexture(gl), floatTexture(gl)];
  const framebuffers = [gl.createFramebuffer(), gl.createFramebuffer()];
  const corners = gl.createBuffer();
  const lineVao = gl.createVertexArray();
  const emptyVao = gl.createVertexArray();
  const cornerAt = line ? gl.getAttribLocation(line.program, 'corner') : -1;
  let uploaded: { history: SpectrumHistory; count: number; rows: number; bands: number } | null =
    null;
  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    uploaded = null;
    gl.deleteTexture(historyTexture);
    for (const texture of skylines) gl.deleteTexture(texture);
    for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
    gl.deleteBuffer(corners);
    gl.deleteVertexArray(lineVao);
    gl.deleteVertexArray(emptyVao);
    for (const linked of [seed, scan, line]) gl.deleteProgram(linked?.program ?? null);
  }
  if (
    !seed ||
    !scan ||
    !line ||
    !historyTexture ||
    !corners ||
    !lineVao ||
    !emptyVao ||
    cornerAt < 0 ||
    skylines.some((t) => !t) ||
    framebuffers.some((f) => !f)
  ) {
    dispose();
    return null;
  }

  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(cornerAt);
  gl.vertexAttribPointer(cornerAt, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  let skylineSize = { columns: 0, rows: 0 };

  // 历史纹理固定在 0 号单元，轮廓纹理在 1 号单元。
  function uploadHistory(history: SpectrumHistory): void {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, historyTexture);
    if (uploaded?.history === history && uploaded.count === history.count) return;
    const { rows, bands } = history;
    if (uploaded?.rows === rows && uploaded.bands === bands) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, bands, rows, gl.RED, gl.FLOAT, history.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, bands, rows, 0, gl.RED, gl.FLOAT, history.data);
    }
    uploaded = { history, count: history.count, rows, bands };
  }

  function ensureSkylines(columns: number, rows: number): void {
    if (skylineSize.columns === columns && skylineSize.rows === rows) return;
    gl.activeTexture(gl.TEXTURE1);
    skylines.forEach((texture, index) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, columns, rows, 0, gl.RED, gl.FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[index] ?? null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    });
    skylineSize = { columns, rows };
  }

  return {
    dispose,
    draw(history, options) {
      if (disposed) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (history.count === 0) return;
      uploadHistory(history);
      const rows = history.rows;
      const points = Math.max(2, history.bands);
      const columns = Math.max(2, Math.ceil(options.width) + 2);
      ensureSkylines(columns, rows);
      const curve = (options.curve ?? true) && points > 2;
      const vertices = curve ? 4 * (points - 2) + 2 : points;
      const segments = vertices - 1 + EXTRA_SEGMENTS;
      const drawn = Math.min(rows, history.count);

      const common = (uniforms: Uniforms): void => {
        gl.uniform1i(uniforms.uHistory ?? null, 0);
        gl.uniform1i(uniforms.uSkyline ?? null, 1);
        gl.uniform1i(uniforms.uRows ?? null, rows);
        gl.uniform1i(uniforms.uPoints ?? null, points);
        gl.uniform1i(uniforms.uHead ?? null, history.head);
        gl.uniform1i(uniforms.uDrawn ?? null, drawn);
        gl.uniform1i(uniforms.uCurve ?? null, curve ? 1 : 0);
        gl.uniform1f(uniforms.uOffset ?? null, Math.min(1, Math.max(0, options.offset ?? 0)));
        gl.uniform2f(uniforms.uSize ?? null, options.width, options.height);
        gl.uniform1f(uniforms.uHorizon ?? null, options.horizon);
        gl.uniform1f(uniforms.uFarWidth ?? null, options.farWidth ?? FAR_WIDTH);
        gl.uniform1f(uniforms.uAmplitude ?? null, options.amplitude ?? AMPLITUDE);
        gl.uniform1f(uniforms.uAlphaNear ?? null, options.alphaNear ?? ALPHA_NEAR);
        gl.uniform1f(uniforms.uAlphaFar ?? null, options.alphaFar ?? ALPHA_FAR);
      };

      // 轮廓：第一遍写各行折线，再按 1、2、4…行的步长做前缀最小值；浮点目标不能开混合。
      gl.disable(gl.BLEND);
      gl.bindVertexArray(emptyVao);
      gl.viewport(0, 0, columns, rows);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[0] ?? null);
      // 1 号单元别留着正要写的那张纹理，免得成了读写同一张纹理的回环。
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, skylines[1] ?? null);
      gl.useProgram(seed.program);
      common(seed.uniforms);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      let current = 0;
      gl.useProgram(scan.program);
      gl.uniform1i(scan.uniforms.uPrevious ?? null, 1);
      for (let stride = 1; stride < rows; stride *= 2) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1 - current] ?? null);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, skylines[current] ?? null);
        gl.uniform1i(scan.uniforms.uStride ?? null, stride);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        current = 1 - current;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, skylines[current] ?? null);
      gl.enable(gl.BLEND);
      gl.bindVertexArray(lineVao);
      gl.useProgram(line.program);
      common(line.uniforms);
      const [r, g, b, a] = rgbaOf(options.lineColor);
      gl.uniform1i(line.uniforms.uSegments ?? null, segments);
      gl.uniform1f(line.uniforms.uPixelRatio ?? null, options.pixelRatio ?? 1);
      gl.uniform2f(line.uniforms.uCanvas ?? null, canvas.width, canvas.height);
      gl.uniform4f(line.uniforms.uColor ?? null, r, g, b, a);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, drawn * segments);
      gl.bindVertexArray(null);
    },
  };
}

/**
 * 先在一块 1 × 1 的 `OffscreenCanvas` 上试建：要画的那块 canvas 一旦开了 WebGL 就再也要不到 2D 上下文，
 * 探测不能拿它试。试完立刻丢掉上下文，不占着显存。
 */
export function probeTerrainGpu(): boolean {
  if (typeof OffscreenCanvas === 'undefined') return false;
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2', GPU_ATTRIBUTES);
  if (!gl) return false;
  const renderer = createRenderer(gl, canvas);
  renderer?.dispose();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return renderer !== null;
}

/**
 * 探测通过才动要画的 canvas；返回 `null` 时它没开过任何上下文，调用方可以接着要 2D。
 * 探测通过而这块 canvas 建不起渲染器（同一块显卡上不该发生）时抛错：它已经开了 WebGL，只能换一块新的。
 * 上下文丢了，下一次 `draw` 调一次 `onLost`，之后不再画。
 */
export function openTerrainGpu(canvas: GpuCanvas, onLost: () => void): TerrainDrawer | null {
  if (!probeTerrainGpu()) return null;
  const gl = canvas.getContext('webgl2', GPU_ATTRIBUTES);
  if (!gl) return null;
  const renderer = createRenderer(gl, canvas);
  if (!renderer) throw new Error('山脊图的 WebGL2 渲染器建不起来');
  let lost = false;
  return {
    kind: 'webgl',
    dispose() {
      lost = true;
      renderer.dispose();
    },
    resize(width, height, pixelRatio) {
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
    },
    draw(history, options) {
      if (lost) return;
      if (gl.isContextLost()) {
        lost = true;
        onLost();
        return;
      }
      renderer.draw(history, options);
    },
  };
}
