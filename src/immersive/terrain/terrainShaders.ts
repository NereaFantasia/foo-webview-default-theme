/**
 * 山脊图 GPU 画法（`terrainGpu.ts`）的着色器：各遍共用的几何与轮廓两遍；画线那一遍在 `terrainLineShaders.ts`。
 * 几何与 `terrain.ts` 的 `rowGeometry` / `drawTerrain`、`skyline.ts` 的 `tracePolyline` / 轮廓逐一对应，
 * 改那边的公式要同步改这里。长度一律 CSS 像素，只有画线那一遍换成物理像素；行 k = 0 最近。
 */

/** 各遍共用：历史缓冲、行几何、折线的点与轮廓。 */
export const TERRAIN_COMMON = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uHistory;
uniform sampler2D uSkyline;
uniform int uRows;
uniform int uPoints;
uniform int uHead;
uniform int uDrawn;
uniform int uCurve;
uniform float uOffset;
uniform vec2 uSize;
uniform float uHorizon;
uniform float uFarWidth;
uniform float uAmplitude;
uniform float uAlphaNear;
uniform float uAlphaFar;

// 「还没画过」的轮廓高度，同 skyline.ts 的 OPEN。
const float OPEN = 1e9;
const float OCCLUSION_MARGIN = 0.01;

struct Row {
  float baseline;
  float left;
  float right;
  float step;
  float amplitude;
  float alpha;
  bool live;
};

Row rowAt(int k) {
  float position = float(k) + uOffset;
  float last = max(1.0, float(uRows - 1));
  float near = max(0.0, 1.0 - position / last);
  float width = uSize.x * (uFarWidth + (1.0 - uFarWidth) * near);
  Row r;
  r.baseline = uHorizon + (uSize.y - uHorizon) * near * near;
  r.left = (uSize.x - width) * 0.5;
  r.right = r.left + width;
  r.step = width / float(uPoints - 1);
  r.amplitude = uAmplitude * uSize.y * (0.5 + 0.5 * near);
  r.alpha = uAlphaFar + (uAlphaNear - uAlphaFar) * near;
  // 滑过最远一行的那一行已经出了地平线，与 drawTerrain 一样不画。
  r.live = k < uDrawn && position <= float(uRows - 1);
  return r;
}

vec2 pointAt(Row r, int k, int j) {
  float value = texelFetch(uHistory, ivec2(j, (uHead + k) % uRows), 0).r;
  return vec2(r.left + float(j) * r.step, r.baseline - r.amplitude * value);
}

bool curved() {
  return uCurve == 1 && uPoints > 2;
}

int vertexCount() {
  return curved() ? 4 * (uPoints - 2) + 2 : uPoints;
}

// 折线第 v 个点：P0 起，第 i 段以 Pi 为控制点、到 Pi 与 Pi+1 的中点，每段切 4 份，末段直线到最后一点。
vec2 vertexAt(Row r, int k, int v) {
  if (!curved()) return pointAt(r, k, v);
  if (v <= 0) return pointAt(r, k, 0);
  if (v >= vertexCount() - 1) return pointAt(r, k, uPoints - 1);
  int i = (v - 1) / 4 + 1;
  float t = float((v - 1) % 4 + 1) / 4.0;
  vec2 control = pointAt(r, k, i);
  vec2 before = pointAt(r, k, i - 1);
  vec2 start = i == 1 ? before : (before + control) * 0.5;
  vec2 end = (control + pointAt(r, k, i + 1)) * 0.5;
  float a = (1.0 - t) * (1.0 - t);
  float b = 2.0 * (1.0 - t) * t;
  float c = t * t;
  return a * start + b * control + c * end;
}

// 以点距为单位的横坐标 u 落在折线第 v0 段（v0 到 v0 + 1 两点之间）的比例 f；行宽以外夹到首末段。
// 点距均匀，第 2 段起 x 随参数线性走；首段从 P0 起，u = 2t − t² / 2。
void locate(float u, out int v0, out float f) {
  float last = float(uPoints - 1);
  if (!curved()) {
    v0 = int(clamp(floor(u), 0.0, last - 1.0));
    f = u - float(v0);
  } else if (u <= 1.5) {
    float t = 2.0 - sqrt(max(0.0, 4.0 - 2.0 * u));
    v0 = int(clamp(floor(t * 4.0), 0.0, 3.0));
    float t0 = float(v0) / 4.0;
    float t1 = float(v0 + 1) / 4.0;
    float u0 = 2.0 * t0 - 0.5 * t0 * t0;
    float u1 = 2.0 * t1 - 0.5 * t1 * t1;
    f = (u - u0) / (u1 - u0);
  } else if (u <= last - 0.5) {
    int i = int(clamp(floor(u + 0.5), 2.0, last - 1.0));
    float t = (u - (float(i) - 0.5)) * 4.0;
    int sub = int(clamp(floor(t), 0.0, 3.0));
    v0 = (i - 1) * 4 + sub;
    f = t - float(sub);
  } else {
    v0 = vertexCount() - 2;
    f = (u - (last - 0.5)) / 0.5;
  }
}

// 折线在 x 处的 y（点与点之间线性插值），行宽以外是 OPEN。
float lineYAt(Row r, int k, float x) {
  float u = (x - r.left) / r.step;
  if (u < 0.0 || u > float(uPoints - 1)) return OPEN;
  int v0;
  float f;
  locate(u, v0, f);
  return mix(vertexAt(r, k, v0).y, vertexAt(r, k, v0 + 1).y, clamp(f, 0.0, 1.0));
}

// 行 k 前面各行的合成轮廓在 x 处的高度：相邻两列线性插值，同 skyline.ts 的 at。
float skyAt(int k, float x) {
  int last = textureSize(uSkyline, 0).x - 2;
  int column = int(clamp(floor(x), 0.0, float(last)));
  float fraction = clamp(x - float(column), 0.0, 1.0);
  float left = texelFetch(uSkyline, ivec2(column, k), 0).r;
  float right = texelFetch(uSkyline, ivec2(column + 1, k), 0).r;
  return mix(left, right, fraction);
}
`;

/** 盖满目标的一个大三角形；轮廓各遍按片元坐标取列与行。 */
export const FULLSCREEN_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** 轮廓第一遍：纹素 (列 c, 行 k) 写行 k − 1 的折线在 x = c 处的 y；行 0 前面没有行。 */
export const SKYLINE_SEED_FRAGMENT = `#version 300 es
${TERRAIN_COMMON}
out float outHeight;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float y = OPEN;
  if (p.y >= 1) {
    Row r = rowAt(p.y - 1);
    if (r.live) y = lineYAt(r, p.y - 1, float(p.x));
  }
  outHeight = y;
}
`;

/** 轮廓的前缀最小值：每遍与上方 `uStride` 行取小，步长逐遍翻倍，几遍之后行 k 是前面各行的最高点。 */
export const SKYLINE_SCAN_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPrevious;
uniform int uStride;
out float outHeight;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float y = texelFetch(uPrevious, p, 0).r;
  if (p.y >= uStride) y = min(y, texelFetch(uPrevious, ivec2(p.x, p.y - uStride), 0).r);
  outHeight = y;
}
`;
