import { Checkmark16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { moveRowFocus } from '../../../kit/rowFocus.ts';
import styles from './OutputDeviceList.module.css';
import {
  deviceKeyOf,
  outputDevicesAtom,
  outputGroupsOf,
  outputDevicesKey,
} from '../../../playback/outputDevices.ts';
import { useService } from '../../../kit/useService.ts';

export interface OutputDeviceListProps {
  /** 切换成功后调用：宿主已接受并回读，勾已移到新设备上，外部据此收起列表。切换没有成功时不调用，列表保留，并在其中显示原因 */
  onPicked?(): void;
}

const ROW = '[data-output-device]';

/**
 * 输出设备的完整列表：按输出模块分组，组名只是标题，不能折叠。当前设备打勾并铺选中底。最高 384（约 12 行），
 * 超出部分在列表里滚动，当前设备滚到中间，用户操作过列表后不再自动滚动。
 * 挂上时读取一次清单（插拔设备时宿主不发事件），并清除上一次切换留下的失败提示。名字过长时截断，悬停显示全名
 *
 * 只有一行接受 Tab：当前设备那一行，没有当前设备时是第一行。弹出层打开时自动聚焦的也是它，不会把列表滚回顶部。
 * 行与行之间用上下键、Home、End 移动。选一行就发起切换，不做乐观更新：宿主回读之后，勾才移动。
 * 切换失败时列表保持不变，顶部显示一行原因
 */
export function OutputDeviceList({ onPicked }: OutputDeviceListProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { status, devices, current, selectFailed } = useAtomValueRawSync(outputDevicesAtom);
  const outputDevices = useService(outputDevicesKey);
  const store = useStore();
  const list = useRef<HTMLDivElement>(null);
  // 用户操作过列表（滚动、按键、按下指针）之后不再自动居中
  const touched = useRef(false);
  // 焦点是否在列表里。持有焦点的那一行被重新读回的清单换掉时，焦点会落到 body，据此把焦点接回来
  const focusedInside = useRef(false);
  const mounted = useRef(true);
  const prefix = useId();
  const currentKey = current ? deviceKeyOf(current) : null;
  const entryKey = currentKey ?? (devices[0] ? deviceKeyOf(devices[0]) : null);

  useEffect(() => {
    mounted.current = true;
    outputDevices.dismissFailure();
    outputDevices.refresh();
    return () => {
      mounted.current = false;
    };
  }, [outputDevices]);
  // 打开时手上的清单可能是旧的，重新读回后当前设备换了位置，也要再居中一次。
  // 行的位置按列表自身量取：列表外面还有别的内容（浮层里的音量栏、设备栏），offsetTop 会把它们算进去
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const focused = document.activeElement;
    if (focusedInside.current && (focused === null || focused === document.body)) {
      element.querySelector<HTMLElement>(`${ROW}[tabindex="0"]`)?.focus({ preventScroll: true });
    }
    const row = element.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row || touched.current) return;
    const offset = row.getBoundingClientRect().top - element.getBoundingClientRect().top;
    element.scrollTop += offset - (element.clientHeight - row.offsetHeight) / 2;
  }, [currentKey, entryKey]);

  const pick = (outputId: string, deviceId: string) => {
    void outputDevices.select(outputId, deviceId).then(() => {
      if (mounted.current && !store.get(outputDevicesAtom).selectFailed) onPicked?.();
    });
  };

  let notice: string | null = null;
  if (devices.length === 0) {
    if (status === 'loading') notice = t('player.devicesLoading');
    else notice = status === 'ready' ? t('player.devicesEmpty') : t('player.devicesFailed');
  }
  return (
    <div
      ref={list}
      className={styles.root}
      role="group"
      aria-label={t('player.outputDevice')}
      onKeyDown={(event) => {
        touched.current = true;
        moveRowFocus(event, ROW);
      }}
      onWheel={() => (touched.current = true)}
      onPointerDown={() => (touched.current = true)}
      onFocus={() => (focusedInside.current = true)}
      onBlur={(event) => {
        // 焦点去了别处才算离开。持有焦点的行被卸掉时，焦点去向为空，不算离开
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) {
          focusedInside.current = false;
        }
      }}
    >
      {selectFailed && (
        <p className={styles.error} role="alert">
          {t('player.deviceSwitchFailed')}
        </p>
      )}
      {notice !== null && <p className={styles.notice}>{notice}</p>}
      {outputGroupsOf(devices).map((group, index) => (
        <div key={group.outputId} role="group" aria-labelledby={`${prefix}-${index}`}>
          <div id={`${prefix}-${index}`} className={styles.group}>
            {group.outputName || t('player.outputUnknown')}
          </div>
          {group.devices.map((device) => {
            const key = deviceKeyOf(device);
            return (
              <button
                key={key}
                type="button"
                className={styles.device}
                title={device.name}
                tabIndex={key === entryKey ? 0 : -1}
                aria-current={key === currentKey || undefined}
                data-output-device={key}
                onClick={() => pick(device.outputId, device.deviceId)}
              >
                <Checkmark16Regular className={styles.check} aria-hidden />
                <span className={styles.name}>{device.name}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
