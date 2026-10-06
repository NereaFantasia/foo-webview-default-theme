import { GRID, ZOOM } from './coverWarp.ts';

/**
 * 封面网格变形流动的 WebGL 渲染：`coverWarp.ts` 的 `warp`、`sampleCover`、`shade` 搬进片元着色器，逐像素、全程浮点算。
 *
 * 纸面色在着色器里混，canvas 不透明：若让 canvas 半透明再由合成器叠到纸面上，最后一次 8 bit 量化发生在合成器里，
 * 着色器加的抖动到那里只剩几分之一，挡不住断层。输出前加三角分布的抖动，种子逐帧换，画面流动时量化边界
 * 也不会停在同一处；canvas 必须按设备像素 1:1 渲染，低分辨率放大会把抖动抹成几个像素的团块。
 *
 * 建上下文时带 `failIfMajorPerformanceCaveat`：浏览器判定只能软件渲染（显卡进黑名单、远程桌面、
 * 无 GPU 的虚拟机）时直接拒绝，`createWarpRenderer` 返回 `null`，调用方退到静态档。着色器编译或链接失败
 * 也返回 `null`，那时这块 canvas 已经开过 WebGL、要不到 2D 上下文，静态档得换一块 canvas 画。
 */

/** 抖动幅度，单位是 8 bit 色阶。 */
const DITHER_LEVELS = 1.5;
const glsl = (value: number) => value.toFixed(4);

const VERTEX = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_cover;
uniform vec2 u_size;
uniform float u_seed;
uniform vec2 u_offsets[${GRID * GRID}];
uniform float u_angle;
uniform vec3 u_paper;
uniform float u_strength;
uniform float u_saturation;

vec3 decode(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 encode(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float keys(float t) {
  float x = abs(t);
  if (x <= 1.0) return (1.5 * x - 2.5) * x * x + 1.0;
  if (x < 2.0) return ((-0.5 * x + 2.5) * x - 4.0) * x + 2.0;
  return 0.0;
}

float weightAt(float g, int column) {
  float w = keys(g - float(column));
  if (column == 0) w += keys(g + 1.0);
  if (column == ${GRID - 1}) w += keys(g - ${GRID.toFixed(1)});
  return w;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float longSide = max(u_size.x, u_size.y);
  vec2 frag = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  vec2 d = (frag - 0.5 * u_size) / longSide * ${glsl(ZOOM)};
  float ca = cos(u_angle);
  float sa = sin(u_angle);
  vec2 uv = 0.5 + vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y);
  vec2 g = clamp(uv, 0.0, 1.0) * ${(GRID - 1).toFixed(1)};
  vec2 offset = vec2(0.0);
  for (int row = 0; row < ${GRID}; row++) {
    float wy = weightAt(g.y, row);
    for (int column = 0; column < ${GRID}; column++) {
      offset += wy * weightAt(g.x, column) * u_offsets[row * ${GRID} + column];
    }
  }
  uv += offset;
  vec3 cover = decode(texture2D(u_cover, uv).rgb);
  float luma = dot(cover, vec3(0.2126, 0.7152, 0.0722));
  cover = max(mix(vec3(luma), cover, u_saturation), 0.0);
  vec3 lin = clamp(mix(u_paper, cover, u_strength), 0.0, 1.0);
  float noise = hash(gl_FragCoord.xy + u_seed) + hash(gl_FragCoord.xy * 1.37 + u_seed + 17.0) - 1.0;
  gl_FragColor = vec4(encode(lin) + noise * ${glsl(DITHER_LEVELS)} / 255.0, 1.0);
}
`;

export interface WarpFrame {
  width: number;
  height: number;
  /** 各控制点的位移，来自 `controlOffsets`。 */
  offsets: Float32Array;
  /** 整幅旋转角，来自 `rotationAt`。 */
  angle: number;
  /** 纸面色，线性光 0–1。 */
  paper: readonly [number, number, number];
  strength: number;
  saturation: number;
  /** 抖动种子，每帧换一个；取值落在几百以内，太大时 `sin` 哈希在部分显卡上精度不够。 */
  seed: number;
}

export interface WarpRenderer {
  draw(frame: WarpFrame): void;
  /** 上下文是否已丢（驱动重置、显卡被拔）；丢了就不会再画出东西。 */
  lost(): boolean;
  dispose(): void;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

/** `cover` 是预糊过的源图，边长须是 2 的幂（镜像环绕的要求）。 */
export function createWarpRenderer(
  canvas: HTMLCanvasElement,
  cover: ImageData,
): WarpRenderer | null {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  // 一个盖满视口的大三角形，比两个三角形拼的矩形少一条对角线上的重复着色。
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cover);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);

  const at = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    cover: at('u_cover'),
    size: at('u_size'),
    seed: at('u_seed'),
    offsets: at('u_offsets'),
    angle: at('u_angle'),
    paper: at('u_paper'),
    strength: at('u_strength'),
    saturation: at('u_saturation'),
  };
  gl.uniform1i(uniforms.cover, 0);

  return {
    draw(frame) {
      gl.viewport(0, 0, frame.width, frame.height);
      gl.uniform2f(uniforms.size, frame.width, frame.height);
      gl.uniform1f(uniforms.seed, frame.seed);
      gl.uniform2fv(uniforms.offsets, frame.offsets);
      gl.uniform1f(uniforms.angle, frame.angle);
      gl.uniform3f(uniforms.paper, frame.paper[0], frame.paper[1], frame.paper[2]);
      gl.uniform1f(uniforms.strength, frame.strength);
      gl.uniform1f(uniforms.saturation, frame.saturation);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    lost: () => gl.isContextLost(),
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
