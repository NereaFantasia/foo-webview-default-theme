import type { FlowMotion } from './flowMotion.ts';
import type { ColorScheme } from '../themes.ts';
import {
  FLOW_VERTEX,
  FLOW_PREPARE,
  FLOW_COMPOSE,
  FLOW_DISTORT,
  FLOW_BLUR,
  FLOW_OUTPUT,
  FLOW_COPY,
} from './flowShaders.ts';

const SIZE = 512;
interface Pass {
  program: WebGLProgram;
  uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
}
interface Target {
  texture: WebGLTexture;
  frame: WebGLFramebuffer;
}

/** 每个实例独占全部 GPU 对象，构造失败也回收已创建的对象。 */
export function createFlowRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!context) throw new Error('无法创建背景绘制上下文');
  const gl = context;
  const programs: WebGLProgram[] = [],
    shaders: WebGLShader[] = [];
  const textures: WebGLTexture[] = [],
    frames: WebGLFramebuffer[] = [];
  let buffer: WebGLBuffer | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const program of programs) gl.deleteProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    for (const texture of textures) gl.deleteTexture(texture);
    for (const frame of frames) gl.deleteFramebuffer(frame);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  function shader(type: number, source: string): WebGLShader {
    const result = gl.createShader(type);
    if (!result) throw new Error('无法创建背景着色器');
    shaders.push(result);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('背景着色器编译失败');
    return result;
  }
  function pass(vertex: WebGLShader, fragment: string): Pass {
    const program = gl.createProgram();
    if (!program) throw new Error('无法创建背景程序');
    programs.push(program);
    gl.attachShader(program, vertex);
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('背景程序连接失败');
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of ['source', 'previous', 'blend', 'motion', 'direction', 'light'])
      uniforms[name] = gl.getUniformLocation(program, name);
    return { program, uniforms };
  }
  function texture(): WebGLTexture {
    const result = gl.createTexture();
    if (!result) throw new Error('无法创建背景纹理');
    textures.push(result);
    gl.bindTexture(gl.TEXTURE_2D, result);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return result;
  }
  function target(): Target {
    const image = texture(),
      frame = gl.createFramebuffer();
    if (!frame) throw new Error('无法创建背景绘制表面');
    frames.push(frame);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('背景绘制表面不可用');
    return { texture: image, frame };
  }
  try {
    canvas.width = canvas.height = SIZE;
    vao = gl.createVertexArray();
    buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error('无法创建背景顶点缓冲');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const vertex = shader(gl.VERTEX_SHADER, FLOW_VERTEX);
    const prepare = pass(vertex, FLOW_PREPARE),
      compose = pass(vertex, FLOW_COMPOSE);
    const distort = pass(vertex, FLOW_DISTORT),
      blur = pass(vertex, FLOW_BLUR);
    const output = pass(vertex, FLOW_OUTPUT),
      copy = pass(vertex, FLOW_COPY);
    const raw = texture(),
      current = target(),
      composition = target(),
      distortion = target();
    const horizontal = target(),
      vertical = target();
    let previous = target(),
      snapshot = target();
    let loaded = false;
    let activeMotion: FlowMotion | null = null;
    let activeScheme: ColorScheme = 'dark';

    function draw(
      pass: Pass,
      destination: Target | null,
      source: WebGLTexture,
      prior = source,
      blend = 1,
      x = 0,
      y = 0,
      size = SIZE,
    ) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination?.frame ?? null);
      gl.viewport(0, 0, size, size);
      gl.useProgram(pass.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prior);
      gl.uniform1i(pass.uniforms.source, 0);
      gl.uniform1i(pass.uniforms.previous, 1);
      gl.uniform1f(pass.uniforms.blend, blend);
      gl.uniform1f(pass.uniforms.light, activeScheme === 'light' ? 1 : 0);
      gl.uniform2f(pass.uniforms.direction, x, y);
      if (activeMotion)
        gl.uniform4f(
          pass.uniforms.motion,
          activeMotion.time,
          activeMotion.rotation,
          activeMotion.breathing,
          activeMotion.gradient,
        );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return {
      replace(image: ImageData | null, color: readonly number[], mix: number): boolean {
        const transition = loaded;
        if (loaded) {
          draw(copy, snapshot, current.texture, previous.texture, mix);
          [snapshot, previous] = [previous, snapshot];
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, raw);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        else
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            1,
            1,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array([...color, 255]),
          );
        draw(prepare, current, raw);
        if (!loaded) draw(copy, previous, current.texture);
        loaded = true;
        return transition;
      },
      draw(motion: FlowMotion, mix: number, scheme: ColorScheme) {
        if (disposed || !loaded) return;
        activeMotion = motion;
        activeScheme = scheme;
        draw(compose, composition, current.texture, previous.texture, mix);
        draw(distort, distortion, composition.texture);
        draw(blur, horizontal, distortion.texture, distortion.texture, 1, 0.9 / SIZE, 0);
        draw(blur, vertical, horizontal.texture, horizontal.texture, 1, 0, 1.2 / SIZE);
        draw(blur, horizontal, vertical.texture, vertical.texture, 1, 0.9 / SIZE, 0);
        draw(blur, vertical, horizontal.texture, horizontal.texture, 1, 0, 1.2 / SIZE);
        draw(output, null, vertical.texture);
      },
      snapshot(): ImageData | null {
        if (disposed || !activeMotion || gl.isContextLost()) return null;
        // 默认缓冲在呈现后可被清空；只在休眠时从保留的末级纹理重画一次缩略图。
        const size = 256;
        draw(output, composition, vertical.texture, vertical.texture, 1, 0, 0, size);
        const raw = new Uint8Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const pixels = new ImageData(size, size);
        const stride = size * 4;
        for (let y = 0; y < size; y++)
          pixels.data.set(raw.subarray(y * stride, (y + 1) * stride), (size - y - 1) * stride);
        return pixels;
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export type FlowRenderer = ReturnType<typeof createFlowRenderer>;
