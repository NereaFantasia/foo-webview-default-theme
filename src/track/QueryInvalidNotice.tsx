import { Link } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import styles from './QueryInvalidNotice.module.css';

export interface QueryInvalidNoticeProps {
  /** 一句话：查询有误、现在显示的是什么 */
  readonly detail: string;
  /** 「语法参考」键：直接打开参考面板 */
  onHelp(): void;
}

/** 高级查询被宿主认不出时命令栏下面的一条提示，写明留着上一次的结果，并给出语法参考的入口 */
export function QueryInvalidNotice({ detail, onHelp }: QueryInvalidNoticeProps) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <div className={styles.notice} role="status" data-query-invalid>
      <span>{detail}</span>
      <Link as="button" onClick={onHelp}>
        {t('query.syntax.reference')}
      </Link>
    </div>
  );
}
