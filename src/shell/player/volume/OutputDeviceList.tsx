import { Checkmark16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import styles from './OutputDeviceList.module.css';
import {
  deviceKeyOf,
  outputDevicesAtom,
  outputGroupsOf,
  outputDevicesKey,
} from './outputDevices.ts';
import { useService } from '../../../kit/useService.ts';

export interface OutputDeviceListProps {
  /** 切换成了：宿主收下并已回读，勾已经挪到新设备上；外面据此收起列表。没成时不调，列表留着写原因。 */
  onPicked?(): void;
}

const ROW = '[data-output-device]';

/** 上下键、Home、End 在各行之间挪焦点；到头停住，不绕回。 */
function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(ROW)];
  const at = rows.findIndex((row) => row === document.activeElement);
  let next = -1;
  if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, at + 1);
  else if (event.key === 'ArrowUp') next = Math.max(0, at - 1);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = rows.length - 1;
  if (next < 0 || at < 0) return;
  event.preventDefault();
  rows[next]?.focus();
}

/**
 * 输出设备的完整列表：按输出模块分组，组名只是标题、不能折叠；当前设备打勾、铺选中底。最高 384（约 12 行），
 * 超出在列表里滚动，当前设备滚到中间，用户动过列表就不再替他滚。挂上时现读一次清单（插拔设备时宿主不发
 * 事件），并收起上一次切换留下的失败。名字过长截断，悬停出全名。
 *
 * 只有一行接 Tab：当前设备那一行，没有当前设备时是第一行；弹出层打开时自动聚焦的也就是它，不会把列表滚回
 * 顶上。行与行之间用上下键、Home、End 挪。选一行就发切换，不乐观更新：宿主回读之后勾才挪；切换没成时列表
 * 留着，顶上写一行原因。
 */
export function OutputDeviceList({ onPicked }: OutputDeviceListProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { status, devices, current, selectFailed } = useAtomValueRawSync(outputDevicesAtom);
  const outputDevices = useService(outputDevicesKey);
  const store = useStore();
  const list = useRef<HTMLDivElement>(null);
  // 用户动过列表（滚、按键、按下指针）之后不再替他居中。
  const touched = useRef(false);
  // 焦点在列表里。拿着焦点的那一行被现读回来的清单换掉时，焦点落到 body，据此接回来。
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
  // 打开时手上的清单可能是旧的，现读回来当前设备换了位置，照样再居中一次。行的位置按列表自己量：列表外面
  // 还有别的东西（浮层里的音量栏、设备栏），offsetTop 会把它们算进去。
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
        moveFocus(event);
      }}
      onWheel={() => (touched.current = true)}
      onPointerDown={() => (touched.current = true)}
      onFocus={() => (focusedInside.current = true)}
      onBlur={(event) => {
        // 焦点去了别处才算离开；拿着焦点的行被卸掉时去向为空，不算。
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
