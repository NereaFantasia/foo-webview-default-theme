import { TERRAIN_COMMON } from './terrainShaders.ts';

/**
 * 山脊图 GPU 画法画线那一遍：每个实例是一行里的一段，即折线的一小段，或两侧竖边、基线。
 * canvas 2D 每行只描一次路径，重叠处不叠亮；这里一行拆成许多段各画各的，所以同一行里每个像素只让一段画：
 * 覆盖率最大的那段，一样大取序号小的。一行的覆盖率由此等于各段覆盖率的最大值，折线内部拐点是圆角，
 * 折线两端、竖边与基线是平头，与 canvas 的 `lineJoin: 'round'`、缺省 `lineCap` 一致。
 */

/** 顶点与片元两遍共用：一行里第几段的端点，以及它在某个像素上的覆盖率。 */
const SEGMENTS = `
uniform float uPixelRatio;
uniform vec2 uCanvas;

// 线宽 1 物理像素，像素中心离中心线 1 物理像素时覆盖率落到 0：四边形向四周放出这么多，同行的对手段也在这个距离内找。
const float REACH = 1.0;

struct Segment {
  vec2 a;
  vec2 b;
  bool buttStart;
  bool buttEnd;
  bool present;
};

// 行 k 的第 s 段，CSS 像素。0 … count − 2 是折线的段，接着是左、右竖边与基线；折线端点落在基线上时竖边没有。
Segment segmentAt(Row r, int k, int s) {
  int count = vertexCount();
  Segment segment;
  segment.present = true;
  segment.buttStart = true;
  segment.buttEnd = true;
  if (s < count - 1) {
    segment.a = vertexAt(r, k, s);
    segment.b = vertexAt(r, k, s + 1);
    segment.buttStart = s == 0;
    segment.buttEnd = s == count - 2;
  } else if (s == count - 1) {
    segment.a = vec2(r.left, pointAt(r, k, 0).y);
    segment.b = vec2(r.left, r.baseline);
    segment.present = segment.b.y > segment.a.y;
  } else if (s == count) {
    segment.a = vec2(r.right, pointAt(r, k, uPoints - 1).y);
    segment.b = vec2(r.right, r.baseline);
    segment.present = segment.b.y > segment.a.y;
  } else {
    segment.a = vec2(r.left, r.baseline);
    segment.b = vec2(r.right, r.baseline);
  }
  return segment;
}

// 物理像素中心 p 处的覆盖率（盒式滤波：离中心线 d 时 1 − d，平头按沿线距离渐隐），看不见为 0。
// 可见性按中心线上离 p 最近的点判：那一点高出轮廓才画，与 CPU 画法按中心线切段一致。
float coverageAt(Row r, int k, int s, vec2 p) {
  Segment segment = segmentAt(r, k, s);
  if (!segment.present) return 0.0;
  vec2 a = segment.a * uPixelRatio;
  vec2 b = segment.b * uPixelRatio;
  float len = length(b - a);
  vec2 dir = (b - a) / len;
  vec2 rel = p - a;
  float t = dot(rel, dir);
  float side = abs(dot(rel, vec2(-dir.y, dir.x)));
  float d = side;
  float along = 1.0;
  if (segment.buttStart) along *= clamp(0.5 + t, 0.0, 1.0);
  else if (t < 0.0) d = length(vec2(t, side));
  if (segment.buttEnd) along *= clamp(0.5 + len - t, 0.0, 1.0);
  else if (t > len) d = length(vec2(t - len, side));
  // CPU 光栅的 canvas 把 1 像素宽的线当细线画：沿主轴每步总覆盖为 1，斜线每单位长度的墨量是
  // max(|cos|, |sin|)，45° 时约 0.71。乘同一个系数，亮度与退回的 2D 画法一致。
  float hairline = max(abs(dir.x), abs(dir.y));
  float coverage = clamp(REACH - d, 0.0, 1.0) * along * hairline;
  if (coverage <= 0.0) return 0.0;
  vec2 nearest = (a + dir * clamp(t, 0.0, len)) / uPixelRatio;
  return skyAt(k, nearest.x) - nearest.y > 0.0 ? coverage : 0.0;
}
`;

/**
 * 每段一个四边形：端点连线向四周各放出 `REACH`。整段都在轮廓下面、跨度不超过 8 列的折线段不出片元；
 * 更宽的段不在这里判，交给片元逐像素判。
 */
export const LINE_VERTEX = `#version 300 es
${TERRAIN_COMMON}
${SEGMENTS}
uniform int uSegments;
in vec2 corner;
flat out int vRow;
flat out int vSegment;

// 同 skyline.ts 的 lowestIn 判据：所跨各列（连同右邻列）的轮廓都比这段最高处还高，整段看不见。
// 跨度超过 8 列不查，当作看得见。
bool hidden(int k, float x0, float x1, float top) {
  int last = textureSize(uSkyline, 0).x - 2;
  int first = int(clamp(floor(x0 - OCCLUSION_MARGIN), 0.0, float(last)));
  int stop = int(clamp(floor(x1 + OCCLUSION_MARGIN), 0.0, float(last))) + 1;
  if (stop - first > 8) return false;
  float lowest = -OPEN;
  for (int column = first; column <= stop; column++) {
    lowest = max(lowest, texelFetch(uSkyline, ivec2(column, k), 0).r);
  }
  return lowest <= top - OCCLUSION_MARGIN;
}

void main() {
  int k = gl_InstanceID / uSegments;
  int s = gl_InstanceID - k * uSegments;
  Row r = rowAt(k);
  Segment segment = segmentAt(r, k, s);
  bool skip = !r.live || !segment.present;
  if (!skip && s < vertexCount() - 1) {
    skip = hidden(k, segment.a.x, segment.b.x, min(segment.a.y, segment.b.y));
  }
  if (skip) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 a = segment.a * uPixelRatio;
  vec2 b = segment.b * uPixelRatio;
  vec2 dir = normalize(b - a);
  vec2 n = vec2(-dir.y, dir.x);
  vec2 end = corner.x > 0.5 ? b + dir * REACH : a - dir * REACH;
  vec2 position = end + n * corner.y * REACH;
  vRow = k;
  vSegment = s;
  vec2 clip = position / uCanvas * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

/** 同一行里比这段覆盖率高（或一样高而序号小）的段在这个像素上画，这段就让掉。 */
export const LINE_FRAGMENT = `#version 300 es
${TERRAIN_COMMON}
${SEGMENTS}
uniform vec4 uColor;
flat in int vRow;
flat in int vSegment;
out vec4 outColor;

// 左右各 1 物理像素的范围里最多查几段折线：canvas 300 物理像素宽时，最远一行在这个范围里约有 16 段。
const int MAX_RIVALS = 16;

bool outranked(Row r, int k, int s, int j, float own, vec2 p) {
  if (j == s) return false;
  float other = coverageAt(r, k, j, p);
  return other > own || (other == own && j < s);
}

void main() {
  int k = vRow;
  int s = vSegment;
  Row r = rowAt(k);
  vec2 p = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  float own = coverageAt(r, k, s, p);
  if (own <= 0.0) discard;
  vec2 c = p / uPixelRatio;
  float reach = REACH / uPixelRatio;
  int first;
  int last;
  float unused;
  locate((c.x - reach - r.left) / r.step, first, unused);
  locate((c.x + reach - r.left) / r.step, last, unused);
  for (int j = first; j <= last && j < first + MAX_RIVALS; j++) {
    if (outranked(r, k, s, j, own, p)) discard;
  }
  int count = vertexCount();
  if (abs(c.x - r.left) <= reach && outranked(r, k, s, count - 1, own, p)) discard;
  if (abs(c.x - r.right) <= reach && outranked(r, k, s, count, own, p)) discard;
  if (abs(c.y - r.baseline) <= reach && outranked(r, k, s, count + 1, own, p)) discard;
  float value = own * r.alpha * uColor.a;
  outColor = vec4(uColor.rgb * value, value);
}
`;
