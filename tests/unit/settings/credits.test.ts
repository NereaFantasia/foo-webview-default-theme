import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import { CREDIT_SECTIONS } from '../../../src/settings/credits.ts';
import { isRecord } from '../../fixtures/hostAnswers.ts';

const CREDITS = CREDIT_SECTIONS.flatMap((section) => section.credits);

function readManifest(path: string): Readonly<Record<string, unknown>> {
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(manifest)) throw new Error(`${path} 不是对象`);
  return manifest;
}

/** 打进产物的依赖。SDK 是组件自己的，不在致谢里。 */
function runtimeDependencies(): string[] {
  const dependencies = readManifest('package.json')['dependencies'];
  return Object.keys(isRecord(dependencies) ? dependencies : {}).filter(
    (name) => name !== 'foo-webview-sdk',
  );
}

describe('CREDIT_SECTIONS', () => {
  it('package.json 里打进产物的每个依赖都在致谢里', () => {
    const covered = new Set(CREDITS.flatMap((credit) => credit.packages));
    expect(runtimeDependencies().filter((name) => !covered.has(name))).toEqual([]);
  });

  it('致谢里写的包都还是依赖，许可与各包自己 package.json 写的一致', () => {
    const dependencies = new Set(runtimeDependencies());
    for (const credit of CREDITS) {
      for (const name of credit.packages) {
        expect(dependencies.has(name), name).toBe(true);
        expect(readManifest(`node_modules/${name}/package.json`)['license'], name).toBe(
          credit.license,
        );
      }
    }
  });

  it('每一项的编号不重复，网址是 https，作用的文案在语言包里', () => {
    expect(new Set(CREDITS.map((credit) => credit.id)).size).toBe(CREDITS.length);
    for (const credit of CREDITS) {
      expect(new URL(credit.url).protocol, credit.id).toBe('https:');
      expect(en[credit.role], credit.id).not.toBe('');
    }
  });

  it('foobox 只作为音量曲线的出处列出', () => {
    const foobox = CREDITS.filter((credit) => credit.name === 'foobox');
    expect(foobox.map((credit) => credit.role)).toEqual(['settings.creditRoleVolume']);
  });
});
