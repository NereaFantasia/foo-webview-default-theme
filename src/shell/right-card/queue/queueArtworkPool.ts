/** 图片内容相同才共享对象地址；不同路径和不同专辑名不作为内容相同的证据。 */
export interface QueueImageIO {
  read(url: string): Promise<Blob | null>;
  create(blob: Blob): string;
  revoke(url: string): void;
}

export const QUEUE_IMAGE_IO: QueueImageIO = {
  async read(url) {
    const response = await fetch(url);
    return response.ok ? response.blob() : null;
  },
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 64;
interface ImageEntry {
  readonly bytes: Uint8Array;
  readonly url: string;
}

export function createQueueArtworkPool(io: QueueImageIO = QUEUE_IMAGE_IO) {
  const images = new Map<string, ImageEntry[]>();
  let bytes = 0;
  let count = 0;
  let disposed = false;
  return {
    async load(source: string): Promise<string | null> {
      try {
        const blob = await io.read(source);
        if (!blob || disposed || blob.size > MAX_BYTES) return null;
        const data = new Uint8Array(await blob.arrayBuffer());
        if (disposed) return null;
        let hash = 2166136261;
        for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
        const key = `${data.length}:${hash >>> 0}`;
        const bucket = images.get(key) ?? [];
        const known = bucket.find((image) => image.bytes.every((byte, i) => byte === data[i]));
        // hash 只用于缩小候选，逐字节相等才复用，碰撞不会显示错图。
        if (known) {
          images.delete(key);
          images.set(key, bucket);
          return known.url;
        }
        const url = io.create(blob);
        bucket.push({ bytes: data, url });
        images.set(key, bucket);
        bytes += data.length;
        count++;
        return url;
      } catch {
        return null;
      }
    },
    trim(pinned: ReadonlySet<string>): string[] {
      const removed: string[] = [];
      for (const [key, bucket] of images) {
        for (let i = bucket.length - 1; i >= 0 && (bytes > MAX_BYTES || count > MAX_IMAGES); i--) {
          const entry = bucket[i];
          if (pinned.has(entry.url)) continue;
          bucket.splice(i, 1);
          bytes -= entry.bytes.length;
          count--;
          removed.push(entry.url);
          io.revoke(entry.url);
        }
        if (!bucket.length) images.delete(key);
        if (bytes <= MAX_BYTES && count <= MAX_IMAGES) break;
      }
      return removed;
    },
    touch(url: string) {
      for (const [key, bucket] of images) {
        if (bucket.some((entry) => entry.url === url)) {
          images.delete(key);
          images.set(key, bucket);
          break;
        }
      }
    },
    dispose() {
      disposed = true;
      for (const bucket of images.values()) for (const entry of bucket) io.revoke(entry.url);
      images.clear();
      bytes = 0;
      count = 0;
    },
  };
}
