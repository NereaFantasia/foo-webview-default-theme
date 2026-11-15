import { describe, expect, it } from 'vitest';
import { QUERY_PRESETS, QUERY_SNIPPETS } from '../../../../src/track/queryPresets.ts';
import { diagnose, pickIssue } from '../../../../src/track/syntax/queryDiagnose.ts';
import { lexQuery } from '../../../../src/track/syntax/queryLexer.ts';

const issuesOf = (text: string, caret?: number) => diagnose(lexQuery(text), caret);
const codes = (text: string, caret?: number) => issuesOf(text, caret).map((issue) => issue.code);

describe('diagnose', () => {
  it('在宿主上核过能用的预设与示例不被误报', () => {
    for (const preset of QUERY_PRESETS) expect(issuesOf(preset.query), preset.query).toEqual([]);
    for (const snippet of QUERY_SNIPPETS) {
      if (snippet.id === 'and' || snippet.id === 'or' || snippet.id === 'not') continue;
      expect(issuesOf(snippet.text), snippet.text).toEqual([]);
    }
    expect(issuesOf('(artist IS a OR artist IS b) AND NOT genre MISSING')).toEqual([]);
  });

  it('括号没闭合时指向那个括号，多出来的右括号也报', () => {
    const [issue] = issuesOf('(artist IS x');
    expect(issue).toMatchObject({ code: 'unclosedParen', level: 'error', start: 0, end: 1 });
    expect(codes('artist IS x)')).toEqual(['unmatchedParen']);
  });

  it('引号里的括号不参与配对', () => {
    expect(issuesOf('"$left(%date%,3)" IS 199')).toEqual([]);
  });

  it('引号没闭合时从引号起到末尾', () => {
    const text = 'artist IS "abc';
    expect(issuesOf(text)[0]).toMatchObject({
      code: 'unclosedString',
      start: 10,
      end: text.length,
    });
  });

  it('小写关键字给提示；光标正在输入的那个词先不提示', () => {
    expect(codes('artist IS x and title IS y')).toEqual(['lowercaseKeyword']);
    expect(codes('artist IS x and', 'artist IS x and'.length)).toEqual([]);
  });

  it('写到一半的结尾只提示，中间缺了操作数才是错误', () => {
    expect(issuesOf('artist IS x AND')[0]).toMatchObject({ code: 'missingOperand', level: 'warn' });
    expect(issuesOf('artist IS AND title IS y')[0]).toMatchObject({
      code: 'missingOperand',
      level: 'error',
    });
    expect(codes('AND artist IS x')).toEqual(['missingOperand']);
  });

  it('说明行先写光标所在的问题，其次第一个错误', () => {
    const text = '(artist IS x AND';
    const issues = issuesOf(text);
    expect(pickIssue(issues, text.length)?.code).toBe('missingOperand');
    expect(pickIssue(issues, 3)?.code).toBe('unclosedParen');
    expect(pickIssue([], 0)).toBeUndefined();
  });
});
