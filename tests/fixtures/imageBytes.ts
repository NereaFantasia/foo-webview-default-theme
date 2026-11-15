// 手搭的最小图片字节：动图封面共用；只有文件头与块结构是对的，不能解码出画面

export const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

export const bytes = (...parts: readonly (readonly number[])[]) => Uint8Array.from(parts.flat());

/** 一帧：图像描述符、LZW 码长、一个数据子块和收尾 */
export const GIF_FRAME = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00, 0x02, 0x01, 0x44, 0x00];
/** 图形控制扩展：动图每帧前都有 */
export const GIF_CONTROL = [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00];
export const GIF_HEAD = [...ascii('GIF89a'), 1, 0, 1, 0, 0x00, 0, 0];
export const GIF_END = [0x3b];

/** 有 `frames` 帧的 GIF；一帧是静图 */
export function gif(frames: number): Uint8Array {
  const body = Array.from({ length: frames }, () => [...GIF_CONTROL, ...GIF_FRAME]).flat();
  return bytes(GIF_HEAD, body, GIF_END);
}

/** 只有文件头的 JPEG，足以让嗅探判成静图 */
export const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], new Array<number>(20).fill(1));
