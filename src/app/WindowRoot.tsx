import { Activity, useEffect, useRef, type ReactNode } from 'react';
import { Button, MessageBar, MessageBarActions, MessageBarBody } from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { miniWindowAtom, miniWindowKey } from '../host/miniWindow.ts';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import { commandsKey } from '../nav/commandRegistry.ts';
import { startReservedKeys } from '../nav/reservedKeys.ts';
import { useCommand } from '../nav/useCommand.ts';
import { MiniPlayer } from '../shell/miniplayer/MiniPlayer.tsx';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import styles from './WindowRoot.module.css';

export function WindowRoot({ children }: { readonly children: ReactNode }) {
  const state = useAtomValueRawSync(miniWindowAtom);
  const mini = useService(miniWindowKey);
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const store = useStore();
  const commands = useService(commandsKey);
  // 登记处里的按键告知宿主：页面有焦点时留给主题，不被 foobar2000 里绑定过同一个键的命令抢先
  useEffect(() => startReservedKeys(store, commands), [store, commands]);
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasMini = useRef(state.active);
  useEffect(() => {
    if (wasMini.current && !state.active && previousFocus.current?.isConnected)
      previousFocus.current.focus({ preventScroll: true });
    wasMini.current = state.active;
  }, [state.active]);
  useCommand({
    id: 'mini.suspend-navigation',
    layer: 'overlay',
    keys: [{ key: 'F11' }, { key: 'ArrowLeft', alt: true }, { key: 'ArrowRight', alt: true }],
    buttons: [3, 4],
    enabled: () => state.active,
    run: () => {},
  });
  return (
    <>
      <Activity mode={state.active ? 'hidden' : 'visible'}>
        <div
          className={styles['full-window']}
          data-full-window
          onFocusCapture={(event) => {
            previousFocus.current = event.target;
          }}
        >
          {children}
        </div>
      </Activity>
      {state.active && <MiniPlayer />}
      {state.failure && (
        <div className={styles.failure}>
          <MessageBar intent="error">
            <MessageBarBody>{t(`mini.failure.${state.failure}`)}</MessageBarBody>
            <MessageBarActions
              containerAction={
                <Button
                  appearance="transparent"
                  icon={<Dismiss20Regular />}
                  aria-label={t('window.close')}
                  onClick={mini.dismissFailure}
                />
              }
            >
              {state.active && (
                <Button
                  className={viewControls.field}
                  disabled={state.busy}
                  onClick={() => void mini.leave()}
                >
                  {t('mini.restore')}
                </Button>
              )}
            </MessageBarActions>
          </MessageBar>
        </div>
      )}
    </>
  );
}
