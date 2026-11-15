import { describe, expect, it } from 'vitest';
import { en } from '../../../../src/i18n/en.ts';
import { createTranslate } from '../../../../src/i18n/translate.ts';
import { zhCN } from '../../../../src/i18n/zhCN.ts';
import { entryAt, hintAt } from '../../../../src/track/syntax/syntaxHint.ts';
import { lexQuery } from '../../../../src/track/syntax/queryLexer.ts';

const t = createTranslate(zhCN, {});
const tEn = createTranslate(en, {});

describe('hintAt', () => {
  it('光标在关键字上时写它的签名与一句说明', () => {
    const text = 'artist IS "x" AND %rating% GREATER 3';
    expect(hintAt(text, text.indexOf('GREATER') + 3, t)).toEqual({
      level: 'info',
      signature: '<field> GREATER <number>',
      text: '数值大于',
    });
  });

  it('光标在字段与引号里的函数上同样给说明', () => {
    expect(hintAt('%rating%', 4, tEn)?.text).toBe('Rating');
    const quoted = '"$left(%date%,3)" IS 199';
    expect(hintAt(quoted, 4, tEn)).toMatchObject({ signature: '$left(X,Y)' });
  });

  it('有问题时先写问题，哪怕光标压着有说明的记号', () => {
    const text = 'artist IS x AND AND title IS y';
    const hint = hintAt(text, text.indexOf('AND') + 1, tEn);
    expect(hint?.level).toBe('error');
    expect(hint?.text).toContain('AND');
  });

  it('普通文字与不认识的字段没有说明', () => {
    expect(hintAt('comment HAS foo', 3, t)).toBeNull();
    expect(entryAt(lexQuery('comment HAS foo'), 3)).toBeUndefined();
  });

  it('DURING LAST 里的 LAST 认成 DURING LAST', () => {
    const text = '%added% DURING LAST 2 WEEKS';
    expect(entryAt(lexQuery(text), text.indexOf('LAST') + 2)?.id).toBe('duringLast');
  });
});

describe('hintAt 的排序框', () => {
  it('整段按 Title Formatting 读：光标在字段上给字段说明，裸词不当查询关键字', () => {
    expect(hintAt('%artist%', 4, tEn, 'format')?.text).toBe('Artist');
    expect(hintAt('and', 3, tEn, 'format')).toBeNull();
  });
});
