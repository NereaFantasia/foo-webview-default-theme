import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { volumeDbAtom } from '../../../playback/playback.ts';
import { playbackConnectedAtom, playbackMutedAtom } from '../../../playback/playerAtoms.ts';
import {
  createVolumeSender,
  stepBase,
  steppedPosition,
  volumeLevel,
  type VolumeLevel,
  type VolumeSender,
} from './volumeControl.ts';
import {
  dbOf,
  positionOf,
  volumeScaleAtom,
  type VolumeScale,
} from '../../../playback/volumeScale.ts';
import { createWheelStepper, type WheelInput } from './wheelSteps.ts';
import { useService } from '../../../kit/useService.ts';
import { playbackKey } from '../../../playback/playbackContract.ts';

export interface VolumeControl {
  readonly connected: boolean;
  /** 音量条此刻的刻度，换了刻度跟着变。 */
  readonly scale: VolumeScale;
  /** 这一处的键与滑条共用的提交入口与短时目标记忆。 */
  readonly sender: VolumeSender;
  /** 宿主报的音量在音量条上的位置，0–100。 */
  readonly position: number;
  /** 图标该画哪一档。 */
  readonly level: VolumeLevel;
  /**
   * 一次滚轮事件：按 `wheelSteps.ts` 换成步数，往上滚加、往下减，实时提交；不满一格的先攒着。答调到的位置
   * （0–100），这一下没挪（没连上、不满一格）时答 null。
   */
  wheel(event: WheelInput): number | null;
}

/**
 * 一处音量件的状态与发送：标题栏的方块键与它展开的滑条、胶囊或窄窗通栏的音量键与它的浮层、宽窗通栏的
 * 常驻滑条，各用一份。
 */
export function useVolumeControl(): VolumeControl {
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const volumeDb = useAtomValueRawSync(volumeDbAtom);
  const muted = useAtomValueRawSync(playbackMutedAtom);
  const playback = useService(playbackKey);
  const scale = useAtomValueRawSync(volumeScaleAtom);
  const [sender] = useState(() => createVolumeSender(playback));
  const [stepper] = useState(createWheelStepper);
  const position = positionOf(volumeDb, scale);
  return {
    connected,
    scale,
    sender,
    position,
    level: volumeLevel(position, muted),
    wheel(event) {
      if (!connected) return null;
      const steps = stepper(event);
      if (steps === 0) return null;
      const next = steppedPosition(positionOf(stepBase(sender, volumeDb), scale), steps);
      sender.live(dbOf(next, scale));
      return next;
    },
  };
}
