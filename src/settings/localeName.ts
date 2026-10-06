/**
 * 语言的本名，如 English、中文（中国）、日本語：各语言的用户在列表里找的是自己语言写的名字，所以不进
 * 语言包、不随界面语言翻译。标签不合法或环境取不出名字时退回标签本身。
 */
export function localeName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
