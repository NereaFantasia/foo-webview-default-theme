import { useMemo, useSyncExternalStore } from 'react';
import { useViewServices } from '../page/viewServices.ts';
import { EMPTY_READINGS, stereoReadouts, type StereoReadouts } from './stereoField.ts';

// 页面的服务还没起来时按没有读数画。
const subscribeNothing = (): (() => void) => () => {};
const noReadings = () => EMPTY_READINGS;

/** 声场格要显示的三个读数与相关游标；随声场取数每窗一换（最多 60 次每秒），调用的格子跟着重画。 */
export function useStereoReadouts(): StereoReadouts {
  const { stereo } = useViewServices();
  const readings = useSyncExternalStore(
    stereo?.subscribe ?? subscribeNothing,
    stereo?.readings ?? noReadings,
  );
  return useMemo(() => stereoReadouts(readings), [readings]);
}
