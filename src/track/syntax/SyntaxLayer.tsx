import { useMemo, type ReactNode, type Ref } from 'react';
import { diagnose, type Issue } from './queryDiagnose.ts';
import { lexQuery, type Region, type Token } from './queryLexer.ts';
import styles from './SyntaxLayer.module.css';

const CLASS_OF: Readonly<Partial<Record<Token['kind'], string>>> = {
  keyword: styles['kw'],
  field: styles['fd'],
  function: styles['fn'],
  string: styles['str'],
  literal: styles['str'],
  number: styles['dim'],
  paren: styles['dim'],
  bracket: styles['dim'],
};

/** 记号与哪个问题重叠：错误画红波浪线，提示画黄的 */
function flagOf(token: Token, issues: readonly Issue[]): string | undefined {
  const hit = issues.filter((issue) => issue.start < token.end && token.start < issue.end);
  if (hit.some((issue) => issue.level === 'error')) return styles['bad'];
  return hit.length > 0 ? styles['warn'] : undefined;
}

export interface SyntaxLayerProps {
  readonly text: string;
  /** 光标位置：光标所在的记号还在输入，不画它的小问题 */
  readonly caret: number;
  /** 补全浮层要贴着的那个位置（文字里的下标）；没有补全时为 null */
  readonly anchorAt: number | null;
  readonly layer: Ref<HTMLDivElement>;
  readonly anchor: Ref<HTMLSpanElement>;
  /** 整段按哪种区域切：独立的排序框给 `format`，缺省是查询 */
  readonly region?: Region;
  /** 多行：折行显示、纵向由输入元素带着滚；缺省是单行、横向滚 */
  readonly multiline?: boolean;
}

/** 输入框后面的着色层：按记号上色，问题处画波浪线，并在补全位置放一个零宽锚点 */
export function SyntaxLayer({
  text,
  caret,
  anchorAt,
  layer,
  anchor,
  region,
  multiline = false,
}: SyntaxLayerProps) {
  const tokens = useMemo(() => lexQuery(text, region), [text, region]);
  const issues = useMemo(() => diagnose(tokens, caret), [tokens, caret]);
  const marker = <span key="anchor" ref={anchor} className={styles['anchor']} />;
  const pieces: ReactNode[] = [];
  const piece = (token: Token, from: number, to: number) => (
    <span
      key={`${token.start}:${from}`}
      className={
        [CLASS_OF[token.kind], flagOf(token, issues)].filter(Boolean).join(' ') || undefined
      }
    >
      {token.text.slice(from, to)}
    </span>
  );
  for (const token of tokens) {
    if (anchorAt !== null && token.start < anchorAt && anchorAt < token.end) {
      const cut = anchorAt - token.start;
      pieces.push(piece(token, 0, cut), marker, piece(token, cut, token.text.length));
      continue;
    }
    if (anchorAt === token.start) pieces.push(marker);
    pieces.push(piece(token, 0, token.text.length));
  }
  if (anchorAt !== null && anchorAt >= text.length) pieces.push(marker);
  // 末尾是换行时输入元素会多出一个空行，折行的着色层要补一个零宽字符才同高
  if (multiline) pieces.push('\u200b');
  return (
    <div
      ref={layer}
      className={multiline ? `${styles['layer']} ${styles['multi']}` : styles['layer']}
      aria-hidden="true"
      data-syntax-layer
    >
      <span className={styles['text']}>{pieces}</span>
    </div>
  );
}

/** 输入框里放输入元素与着色层的一格：占满输入框内容区，着色层贴着输入元素 */
export function SyntaxFrame({ children }: { readonly children: ReactNode }) {
  return <span className={styles['frame']}>{children}</span>;
}
