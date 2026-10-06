import { Button } from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import { openLibraryPreferences } from '../host/libraryContract.ts';
import { translateAtom } from '../i18n/locale.ts';
import styles from './AddFoldersAction.module.css';
import { libraryEmptyAtom } from './albums.ts';

/**
 * 地点空态里的「添加文件夹」：打开 foobar2000 首选项的媒体库页，与新人引导第 1 步作用相同。媒体库里有
 * 东西时什么也不画，空态由所在地点自己写。打开失败时在按钮下面写出来，播报区常驻，读屏才念得到。
 */
export function AddFoldersAction() {
  const t = useAtomValueRawSync(translateAtom);
  const empty = useAtomValueRawSync(libraryEmptyAtom);
  const [failed, setFailed] = useState(false);
  // 首选项的应答可能在离开这一页之后才回来，那时不再改状态。
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (!empty) return null;
  const open = async () => {
    setFailed(false);
    const done = await openLibraryPreferences();
    if (alive.current) setFailed(!done);
  };
  return (
    <div className={styles.root}>
      <Button
        appearance="primary"
        icon={<Open16Regular />}
        iconPosition="after"
        onClick={() => void open()}
      >
        {t('onboarding.addFolders')}
      </Button>
      <span className={styles.error} role="status">
        {failed ? t('settings.openFailed') : ''}
      </span>
    </div>
  );
}
