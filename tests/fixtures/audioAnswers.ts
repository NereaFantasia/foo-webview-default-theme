import type {
  ApiFailure,
  AudioGetSpectrumSuccess,
  AudioGetWaveformSuccess,
  ApiErrorCode,
} from 'foo-webview-sdk';

/**
 * 单测里宿主 `audio.getSpectrum` / `audio.getWaveform` 的应答，照 SDK 声明的形状：缺省是一帧在播、
 * 不带频点的频点应答和一窗不带样本的立体声短窗，用例只盖关心的字段。失败是只有 `success / error / code`
 * 的信封，与宿主一样。
 */
export function spectrumAnswer(
  overrides: Partial<AudioGetSpectrumSuccess> = {},
): AudioGetSpectrumSuccess {
  return {
    success: true,
    output: 'bins',
    fftSize: 1024,
    scale: 'db',
    sampleRate: 44100,
    minFrequency: 20,
    maxFrequency: 20000,
    state: 'playing',
    streamTime: 0,
    hostTime: 0,
    ...overrides,
  };
}

export function spectrumFailure(error: string, code: ApiErrorCode = 'INTERNAL_ERROR'): ApiFailure {
  return { success: false, error, code };
}

export function waveformAnswer(
  overrides: Partial<AudioGetWaveformSuccess> = {},
): AudioGetWaveformSuccess {
  return {
    success: true,
    duration: 0.03,
    signed: true,
    channels: 'stereo',
    sampleRate: 48000,
    channelCount: 2,
    ...overrides,
  };
}

export function waveformFailure(error: string, code: ApiErrorCode = 'INTERNAL_ERROR'): ApiFailure {
  return { success: false, error, code };
}
