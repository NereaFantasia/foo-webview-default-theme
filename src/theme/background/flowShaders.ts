export const FLOW_VERTEX = `#version 300 es
in vec2 position;
out vec2 point;
void main() {
  point = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
in vec2 point;
out vec4 outputColor;
uniform sampler2D source;
uniform sampler2D previous;
uniform float blend;
uniform vec4 motion;
vec4 field(sampler2D image, vec2 p) { return texture(image, vec2(p.x, 1.0 - p.y)); }
vec2 rotatePoint(vec2 p, float angle) {
  float c = cos(angle), s = sin(angle);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}
`;

export const FLOW_PREPARE = `${HEADER}
void main() {
  vec4 pixel = texture(source, point);
  vec3 c = (pixel.rgb - 0.5) * 1.3 + 0.5;
  float mean = (c.r + c.g + c.b) / 3.0;
  // 超过固定阈值后按亮度逐渐减色，大片近白区域可降至黑色，避免抬高背景亮度。
  if (mean > 0.5) c *= 2.0 - mean / 0.5;
  // 在有效色域内收敛彩度，避免暖色通道裁切后仍呈现高饱和的纯色块。
  c = clamp(c, 0.0, 1.0);
  float gray = dot(c, vec3(0.299, 0.587, 0.114));
  outputColor = vec4(mix(vec3(gray), c, 0.75), pixel.a);
}`;

export const FLOW_COMPOSE = `${HEADER}
vec4 sampleLayer(vec2 shift, float scale, float angle) {
  vec2 p = fract(rotatePoint((point - shift - 0.5) / scale, angle) + 0.5);
  return mix(field(previous, p), field(source, p), blend);
}
void main() {
  float t = motion.x, angle = motion.y, breath = motion.z;
  vec3 c = sampleLayer(vec2(0.0), 3.0, 0.0).rgb;
  for (int i = 0; i < 3; i++) {
    float n = float(i), phase = n * 2.39996;
    vec2 shift = vec2(0.1 + n * 0.15) + vec2(sin(t * 0.25 + phase) * 0.08, cos(t * 0.25 + phase) * 0.06);
    vec4 layer = sampleLayer(shift, (3.0 + n * 0.8) * breath, angle * 0.5 + n * 0.15);
    c = mix(c, layer.rgb, layer.a * 0.6 / (n + 1.0));
  }
  vec4 a = sampleLayer(vec2(sin(t * 0.5) * 0.05, cos(t * 0.5) * 0.04), 2.4 * breath, angle + sin(t * 0.5) * 0.02);
  vec4 b = sampleLayer(vec2(0.3) + vec2(sin(t * 0.5 + 1.0) * 0.06, cos(t * 0.5 + 1.0) * 0.05), 2.0 * breath, -angle * 0.5 + sin(t * 0.7 + 1.0) * 0.02);
  vec4 d = sampleLayer(vec2(-0.2 + sin(t * 0.4) * 0.07, 0.4 + cos(t * 0.3) * 0.05), 1.8 * breath, angle * 0.8 + sin(t * 0.8 + 2.0) * 0.02);
  vec4 e = sampleLayer(vec2(0.4 + sin(t * 0.35 + 3.0) * 0.08, -0.1 + cos(t * 0.25 + 3.0) * 0.06), 2.2 * breath, angle * 1.5 + sin(t * 0.6 + 3.0) * 0.02);
  c = mix(c, a.rgb, a.a * 0.85);
  c = mix(c, b.rgb, b.a * 0.7);
  c = mix(c, d.rgb, d.a * 0.55);
  outputColor = vec4(mix(c, e.rgb, e.a * 0.4), 1.0);
}`;

export const FLOW_DISTORT = `${HEADER}
void main() {
  vec3 rate = vec3(0.05, 0.03, 0.06) * 0.35;
  vec3 boundary = vec3(0.25, 0.5, 0.75) + sin(rate * (motion.x * 0.005 + point.y * 512.0 * motion.y)) * (90.0 / 512.0);
  float left = 0.0, right = boundary.x, origin = 0.0;
  if (point.x >= boundary.x) { left = boundary.x; right = boundary.y; origin = 0.25; }
  if (point.x >= boundary.y && point.x >= boundary.x) { left = boundary.y; right = boundary.z; origin = 0.5; }
  if (point.x >= boundary.z && point.x >= boundary.y && point.x >= boundary.x) { left = boundary.z; right = 1.0; origin = 0.75; }
  float x = origin + clamp((point.x - left) / max(right - left, 0.01), 0.0, 1.0) * 0.25;
  outputColor = field(source, vec2(clamp(x, 0.0, 1.0), point.y));
}`;

export const FLOW_BLUR = `${HEADER}
uniform vec2 direction;
const float weights[9] = float[9](0.1027, 0.0984, 0.0867, 0.0702, 0.0523, 0.0358, 0.0225, 0.0130, 0.0069);
void main() {
  vec4 c = field(source, point) * weights[0];
  for (int i = 1; i < 9; i++) {
    vec2 delta = direction * float(i);
    c += (field(source, point + delta) + field(source, point - delta)) * weights[i];
  }
  outputColor = c;
}`;

export const FLOW_OUTPUT = `${HEADER}
uniform float light;
vec3 lightField(vec3 c) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float span = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  float presence = smoothstep(0.015, 0.18, span);
  // 明度与色差分别约束；无彩区域接近白色，彩色区域保留流动边界而不带入暗灰。
  float tone = 0.975 - 0.065 * presence - 0.01 * smoothstep(0.0, 0.6, luma);
  vec3 tint = (c - vec3(luma)) * min(1.0, 0.20 / max(span, 0.00001));
  float peak = max(max(tint.r, tint.g), tint.b);
  tint *= min(1.0, (1.0 - tone) / max(peak, 0.00001));
  return vec3(tone) + tint;
}
float noise(vec2 p) {
  vec3 v = fract(vec3(p.x, p.y, p.x) * 0.1031);
  v += dot(v, v.yzx + 33.33);
  return fract((v.x + v.y) * v.z);
}
void main() {
  vec2 p = fract(rotatePoint((point - 0.5) / (2.0 * motion.z), motion.w) + 0.5);
  vec3 c = field(source, p).rgb * 1.05;
  if (light > 0.5) c = lightField(c);
  vec2 seed = point * 512.0 + vec2(motion.x * 100.0, motion.x * 57.0);
  float dither = (noise(seed) + noise(seed + 19.19) - 1.0) / 255.0;
  outputColor = vec4(clamp(c + dither, 0.0, 1.0), 1.0);
}`;

export const FLOW_COPY = `${HEADER}
void main() { outputColor = mix(field(previous, point), field(source, point), blend); }
`;
