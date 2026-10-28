import { Link, makeStyles, mergeClasses } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import type { MouseEvent } from 'react';
import { useService } from '../kit/useService.ts';
import { historyAtom } from './navHistory.ts';
import { objectOpenerKey, type ObjectOpener } from './objectOpener.ts';
import type { ObjectRef } from './objectRef.ts';

/**
 * 继承宿主排版样式的对象链接样式
 * 字体、字重与颜色全量继承父级容器（如单元格、卡头、选中行高亮色），悬停与激活时展示下划线反馈
 */
export const useObjectLinkStyles = makeStyles({
  link: {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'inherit',
    lineHeight: 'inherit',
    color: 'inherit',
    ':hover': { color: 'inherit' },
    ':active': { color: 'inherit' },
  },
});

/**
 * 获取对象打开服务，并同步订阅对象注册代次与当前导航地点
 * 目标实体的可用性与激活状态随地点或目录变动自动更新
 */
export function useObjectOpener(): ObjectOpener {
  const opener = useService(objectOpenerKey);
  useAtomValueRawSync(opener.revision);
  useAtomValueRawSync(historyAtom);
  return opener;
}

/** 判定是否为未按修饰键的常规单击，避免拦截多选操作 */
export function isPlainClick(event: MouseEvent): boolean {
  return !(event.ctrlKey || event.shiftKey || event.metaKey);
}

export interface ObjectLinkProps {
  /** 目标实体引用；为 null 或未就绪时降级渲染为纯文本 */
  readonly to: ObjectRef | null;
  readonly children: string;
  readonly className?: string;
  readonly title?: string;
  /** 表格行内传 -1，由整行键盘焦点与快捷菜单接管 */
  readonly tabIndex?: number;
  /** 触发来源标识，用于多处同源入口时定位加载反馈 */
  readonly origin?: string;
}

/**
 * 领域实体对象跳转链接组件
 * 点击时委托对象打开服务处理路由与异常反馈；阻止双击与指针按下事件冒泡，避免误触发列表行播放或拖拽
 */
export function ObjectLink({ to, children, className, title, tabIndex, origin }: ObjectLinkProps) {
  const opener = useObjectOpener();
  const styles = useObjectLinkStyles();
  if (!to || opener.availability(to) !== 'ready') {
    return (
      <span className={className} title={title}>
        {children}
      </span>
    );
  }
  return (
    <Link
      // Link 采用 span 行内元素语义，配合外层容器实现逐字省略，避免内联块级节点整体溢出截断
      as="span"
      appearance="subtle"
      className={mergeClasses(styles.link, className)}
      title={title}
      tabIndex={tabIndex}
      aria-current={opener.isHere(to) ? 'page' : undefined}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.stopPropagation();
        void opener.open(to, { origin });
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </Link>
  );
}
