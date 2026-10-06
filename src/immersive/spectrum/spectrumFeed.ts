import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../host/hostCall.ts';
import type { FrameClock } from '../frame/frameScheduler.ts';
import { binsFrameOf, type BinsFrame } from './spectrumBins.ts';
import { startSpectrumPull, type SpectrumAnswer } from './spectrumPull.ts';

/**
 * 频谱的两份订阅与逐拍拉帧：建订阅、判结局、开拉，`close` 时停拉并退订。两份都要宿主的 FFT 频点
 * （`output: 'bins'`，逐频点 dB 功率，见 `spectrumBins.ts`）：山脊图要 16384 点的长窗取低频细节；频谱柱另订一份
 * 短窗（`BARS_FFT_SIZE`），长窗在 44.1 kHz 下约 0.37 s，一个鼓点前后各拖约 0.19 s，柱跟不上。山脊图关着时
 * 只订柱那份，由它当主订阅（拉取与被拒都看它）。
 *
 * 取数用拉取，不用推送：宿主推帧的定时器订 60 实得约 40 帧/秒，间隔在 16…46 ms 之间跳。订阅只为让
 * `getSpectrum` 能按它的参数算帧，按宿主下限 1 fps 订、推来的帧不用；主订阅成立后由 `spectrumPull.ts` 的循环
 * 逐拍拉帧，两份按同一拍一起拉。别的程序在前台时宿主给订阅限流（`backgroundThrottle`，缺省开，封顶 12 帧/秒），
 * 只限推帧，拉取不受它影响。
 *
 * 结局：不认 `output` 的旧宿主照样答成功，但登记成频带订阅、结局里的 `output` 报 `'bands'`，
 * 这样的结局按被拒处理。主订阅被拒就两份都退掉、叫 `onRefused`，此后不再有帧；柱那份被拒只退它自己，
 * 柱改吃主订阅的帧。
 */

/** 用到的宿主面，类型取自 SDK 的 `fb.audio`。 */
export type SpectrumFeedHost = Pick<typeof fb.audio, 'subscribeSpectrum' | 'getSpectrum'>;

/**
 * 山脊图那份的 FFT 点数：44.1 kHz 下窗长约 0.37 s、频点间隔 2.7 Hz。宿主只接受 256…65536 之间的 2 的幂
 * （`AudioApi.cpp` 的 `kMaxSpectrumFftSize`），越界整个订阅被拒、一帧都不来。
 */
export const SPECTRUM_FFT_SIZE = 16384;
/**
 * 频谱柱那份的 FFT 点数：44.1 kHz 下窗长约 186 ms，是山脊图长窗的一半。频点输出按请求的点数算，
 * 点数定了低频分得出几根柱（横轴低频一个频点一根，`barAxis.ts`）：44.1 kHz 下 8192 点在约 190 Hz 以下给 32 根；
 * 4096 点（约 93 ms）跟鼓点更紧，但一根柱宽 10.8 Hz、这一段要铺到约 450 Hz。
 */
export const BARS_FFT_SIZE = 8192;
/** 订阅本身的推帧率：宿主允许的最低值，推来的帧不用。 */
export const SPECTRUM_KEEPALIVE_FPS = 1;

/** 柱那份在这一拍拉到的帧。 */
export interface BarsPull {
  /** 答失败或不是合格的频点帧时为 `null`。 */
  frame: BinsFrame | null;
}

export interface SpectrumFeedOptions {
  host: SpectrumFeedHost;
  /** 要不要山脊图那份长窗订阅。 */
  terrain: boolean;
  /** 在播时相邻两次拉取的最短间隔（毫秒）。 */
  intervalMs: number;
  /** 拉取循环的帧时钟；缺省 `requestAnimationFrame`。 */
  clock?: FrameClock;
  /**
   * 主订阅每拉到一帧新帧叫一次。`bars` 是同一拍柱那份拉到的帧；柱那份没另订、被拒或还没成立时为 `null`，
   * 柱吃主订阅的帧。
   */
  onFrame: (answer: SpectrumAnswer, bars: BarsPull | null) => void;
  /** 主订阅被拒：两份都已退掉，不会再有帧。 */
  onRefused: () => void;
}

export interface SpectrumFeed {
  /** 停拉并退掉两份订阅，只退一次；之后晚到的结局与应答都不再交。 */
  close(): void;
}

export function openSpectrumFeed(options: SpectrumFeedOptions): SpectrumFeed {
  const { host } = options;
  let open = true;
  let pull: { stop(): void } | undefined;
  const subscribe = (fftSize: number) =>
    host.subscribeSpectrum(() => {}, {
      output: 'bins',
      fftSize,
      fps: SPECTRUM_KEEPALIVE_FPS,
    });
  const main = subscribe(options.terrain ? SPECTRUM_FFT_SIZE : BARS_FFT_SIZE);
  const bars = options.terrain ? subscribe(BARS_FFT_SIZE) : null;
  // SDK 的退订函数每调一次就给宿主发一次退订，柱那份可能先因被拒退过，这里只退一次。
  let barsOpen = bars !== null;
  const closeBars = (): void => {
    if (barsOpen) bars?.();
    barsOpen = false;
  };
  let barsId: string | null = null;
  let barsFrame: BinsFrame | null = null;

  function close(): void {
    if (!open) return;
    open = false;
    pull?.stop();
    pull = undefined;
    main();
    closeBars();
  }

  void bars?.ready.then((outcome) => {
    if (!open) return;
    if (outcome.ok && outcome.output === 'bins') barsId = outcome.subscriptionId;
    else closeBars();
  });
  void main.ready.then((outcome) => {
    if (!open) return;
    if (!outcome.ok || outcome.output !== 'bins') {
      close();
      options.onRefused();
      return;
    }
    const { subscriptionId } = outcome;
    pull = startSpectrumPull({
      // 主订阅那份调用失败由拉取循环按失败放宽间隔；柱那份失败只是这一拍没有柱帧。
      fetch: async () => {
        const id = barsId;
        const [answer, extra] = await Promise.all([
          host.getSpectrum({ subscriptionId }),
          id === null ? null : settle(() => host.getSpectrum({ subscriptionId: id })),
        ]);
        barsFrame = extra?.success === true ? binsFrameOf(extra) : null;
        return answer;
      },
      intervalMs: options.intervalMs,
      onFrame: (answer) => options.onFrame(answer, barsId === null ? null : { frame: barsFrame }),
      clock: options.clock,
    });
  });

  return { close };
}
