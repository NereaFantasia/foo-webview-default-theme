import { describe, expect, it } from 'vitest';
import { readBackendManifest, readRuntimeManifest } from '../../../src/update/backendManifest.ts';

const FILE = { url: 'https://example.com/file', size: 20, sha256: 'a'.repeat(64) };
const BACKEND = { format: 1, version: '0.1.5', protocol: 1, backend: FILE, runtime: FILE };
const RUNTIME = {
  format: 1,
  name: 'node',
  version: '24.16.0',
  platform: 'win32',
  arch: 'x64',
  compression: 'deflate-raw',
  size: 40,
  sha256: 'b'.repeat(64),
  parts: [
    { ...FILE, url: 'https://example.com/part0', unpackedSize: 20, unpackedSha256: 'c'.repeat(64) },
    { ...FILE, url: 'https://example.com/part1', unpackedSize: 20, unpackedSha256: 'd'.repeat(64) },
  ],
  license: FILE,
  source: { ...FILE, size: 40, sha256: 'b'.repeat(64) },
};

describe('后端发行描述', () => {
  it('只接受同版本、支持的协议与有完整校验信息的附件', () => {
    expect(readBackendManifest(JSON.stringify(BACKEND), '0.1.5')).toEqual(BACKEND);
    expect(readBackendManifest(JSON.stringify(BACKEND), '0.2.0')).toBeNull();
    for (const fields of [
      { protocol: 2 },
      { format: 2 },
      { backend: { ...FILE, url: 'http://example.com/file' } },
      { runtime: { ...FILE, size: 0 } },
      { backend: { ...FILE, sha256: '无效' } },
    ])
      expect(readBackendManifest(JSON.stringify({ ...BACKEND, ...fields }), '0.1.5')).toBeNull();
  });
});

describe('Node 运行时描述', () => {
  it('保留经过校验的块顺序和许可来源', () => {
    expect(readRuntimeManifest(JSON.stringify(RUNTIME))).toEqual(RUNTIME);
  });

  it('拒绝总长度不符、重复附件、无许可和不支持的平台', () => {
    for (const fields of [
      { size: 39 },
      { parts: [RUNTIME.parts[0], RUNTIME.parts[0]] },
      { parts: [] },
      { parts: [{ ...RUNTIME.parts[0], unpackedSize: 40, unpackedSha256: '' }] },
      { license: null },
      { source: { ...FILE, url: 'file:///node.exe' } },
      { arch: 'ia32' },
      { platform: 'linux' },
    ])
      expect(readRuntimeManifest(JSON.stringify({ ...RUNTIME, ...fields }))).toBeNull();
  });
});
