import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { waitForHost } from '../../host/waitForHost.ts';
import type { PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { backgroundSourceAtom, saveBackgroundImageName } from './windowBackground.ts';

type ImageStatus = 'empty' | 'loading' | 'ready' | 'failed';
export type BackgroundImageFailure = 'choose' | 'read' | 'decode' | 'save' | 'bytes' | 'pixels';
const stateAtom = atom<{
  readonly status: ImageStatus;
  readonly url: string;
  readonly failure?: BackgroundImageFailure;
}>({
  status: 'empty',
  url: '',
});
const requestAtom = atom({ serial: 0, choose: false });
export const backgroundImageAtom = atom((get) => get(stateAtom));
export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;

class ImagePixelLimitError extends Error {}

export function requestBackgroundImage(store: Store, choose: boolean): void {
  store.set(requestAtom, (current) => ({ serial: current.serial + 1, choose }));
}

async function decodeImage(bytes: Uint8Array): Promise<string> {
  if (!bytes.length) throw new Error('图片内容为空');
  const blob = new Blob([new Uint8Array(bytes)]);
  const bitmap = await createImageBitmap(blob);
  const pixels = bitmap.width * bitmap.height;
  bitmap.close();
  if (pixels > 64_000_000) throw new ImagePixelLimitError('图片尺寸超限');
  if (pixels <= 0) throw new Error('图片尺寸无效');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('图片读取失败'));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export interface BackgroundImageOptions {
  readonly host?: Pick<typeof fb, 'isAvailable' | 'ready'> & {
    readonly dialog: Pick<typeof fb.dialog, 'openFile'>;
    readonly file: Pick<typeof fb.file, 'readBinary' | 'writeBinary'>;
    readonly misc: Pick<typeof fb.misc, 'getProfilePath'>;
  };
  readonly storage?: PrefStorage | null;
  readonly decode?: (bytes: Uint8Array) => Promise<string>;
}

/** 固定私有副本只在新图可解码后原子替换；取消选择与迟到应答不改当前图片。 */
export function startBackgroundImage(store: Store, options: BackgroundImageOptions = {}) {
  const host = options.host ?? fb;
  const decode = options.decode ?? decodeImage;
  const waiter = waitForHost(host);
  let disposed = false;
  let generation = 0;
  let choosing = false;
  let directory: Promise<string> | undefined;
  function managedPath(): Promise<string> {
    directory ??= host.misc
      .getProfilePath()
      .then((answer) => {
        if (answer.success === false) throw new Error('无法读取配置目录');
        return `${answer.path.replace(/[\\/]$/, '')}\\default-theme\\background.image`;
      })
      .catch((error: unknown) => {
        directory = undefined;
        throw error;
      });
    return directory;
  }
  async function read(choose: boolean): Promise<void> {
    if (disposed || choosing) return;
    const mine = ++generation;
    choosing = choose;
    const previous = store.get(stateAtom);
    if (!choose) store.set(stateAtom, { status: 'loading', url: '' });
    let failure: BackgroundImageFailure = choose ? 'choose' : 'read';
    try {
      if (!(host.isAvailable() || (await waiter.done))) throw new Error('宿主不可用');
      if (disposed || mine !== generation) return;
      let picked = '';
      if (choose) {
        const answer = await host.dialog.openFile({
          multiple: false,
          filters: [{ extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif'] }],
        });
        if (disposed || mine !== generation) return;
        if (answer.success === false) throw new Error('无法选择图片');
        if (answer.canceled) return;
        picked = answer.filePaths[0] ?? '';
        if (!picked) return;
        store.set(stateAtom, { status: 'loading', url: previous.url });
      }
      failure = choose ? 'save' : 'read';
      const path = await managedPath();
      if (disposed || mine !== generation) return;
      failure = 'read';
      const bytes = await host.file.readBinary(picked || path);
      if (bytes.length > MAX_BACKGROUND_BYTES) {
        failure = 'bytes';
        throw new Error('图片大小超限');
      }
      failure = 'decode';
      const url = await decode(bytes);
      if (disposed || mine !== generation) return;
      if (picked) {
        failure = 'save';
        const answer = await host.file.writeBinary(path, bytes, { atomic: true });
        if (disposed || mine !== generation) return;
        if (answer.success === false) throw new Error('无法保存图片');
        saveBackgroundImageName(
          store,
          picked.split(/[\\/]/).at(-1)?.slice(0, 256) ?? '',
          options.storage,
        );
      }
      store.set(stateAtom, { status: 'ready', url });
    } catch (error) {
      if (!disposed && mine === generation)
        store.set(stateAtom, {
          status: 'failed',
          url: choose ? previous.url : '',
          failure: error instanceof ImagePixelLimitError ? 'pixels' : failure,
        });
    } finally {
      if (mine === generation) choosing = false;
    }
  }
  const offRequest = store.sub(requestAtom, () => {
    void read(store.get(requestAtom).choose);
  });
  const onSource = () => {
    if (store.get(backgroundSourceAtom) === 'image' && store.get(stateAtom).status === 'empty')
      void read(false);
  };
  const offSource = store.sub(backgroundSourceAtom, onSource);
  onSource();
  return {
    dispose() {
      disposed = true;
      generation += 1;
      waiter.cancel();
      offRequest();
      offSource();
    },
  };
}
