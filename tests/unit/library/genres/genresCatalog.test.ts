import { expect, it, vi } from 'vitest';
import { EMPTY_GENRE } from '../../../../src/library/genres/genresModel.ts';
import { GENRES_VALUES_PATTERN } from '../../../../src/library/genres/genresCatalog.ts';
import { libraryTracksAtom } from '../../../../src/library/libraryTracks.ts';
import { genreTracksAnswer, genresLibrary } from '../../../fixtures/genresLibrary.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';

const track = trackRow('One', 'Multi', { genre: 'Rock, Soul' });
const valuesAnswer = (value: string) => ({
  success: true as const,
  pattern: GENRES_VALUES_PATTERN,
  total: 1,
  successCount: 1,
  errorCount: 0,
  results: [{ path: track.path, success: true as const, result: value, infoAvailable: true }],
});

it('整库先在别处读取失败，首次进入流派直接显示可重试的失败状态', async () => {
  const env = genresLibrary();
  env.host.answer('library.getAll', hostFailure('OPERATION_FAILED'));
  env.library.want();
  await vi.waitFor(() => expect(env.store.get(libraryTracksAtom).status).toBe('failed'));
  env.catalog.want();
  expect(env.state().status).toBe('failed');
});

it('显示为逗号分隔的标签补读真多值，单个逗号名字不误拆，失败保持旧目录且不会渲染重试', async () => {
  const env = genresLibrary([track]);
  env.host.answer('titleformat.evalBatch', valuesAnswer('Rock, Soul'));
  await env.ready();
  expect(env.state().entries.map((entry) => entry.key)).toEqual(['Rock, Soul']);
  expect(env.host.callsTo('titleformat.evalBatch')[0]).toMatchObject({
    pattern: GENRES_VALUES_PATTERN,
  });
  env.host.answer('titleformat.evalBatch', hostFailure('OPERATION_FAILED'));
  await env.library.retry();
  await vi.waitFor(() => expect(env.state().status).toBe('failed'));
  expect(env.state().entries[0]?.key).toBe('Rock, Soul');
  const asked = env.host.callsTo('titleformat.evalBatch').length;
  env.catalog.want();
  expect(env.host.callsTo('titleformat.evalBatch')).toHaveLength(asked);
  env.host.answer('titleformat.evalBatch', valuesAnswer('Rock\u001fSoul\u001fRock'));
  await env.catalog.retry();
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  expect(env.state().entries.map((entry) => [entry.key, entry.tracks.length])).toEqual([
    ['Rock', 1],
    ['Soul', 1],
  ]);
});

it('补读期间媒体库换代，晚来的旧标签不能覆盖新目录；释放后也不落盘', async () => {
  const env = genresLibrary([track]);
  const held = env.host.hold('titleformat.evalBatch');
  env.catalog.want();
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  env.host.answer('library.getAll', genreTracksAnswer([trackRow('Two', 'New', { genre: 'Jazz' })]));
  await env.library.retry();
  expect(env.state().entries.map((entry) => entry.key)).toEqual(['Jazz']);
  held.respond(0, valuesAnswer('Old\u001fGenre'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(env.state().entries.map((entry) => entry.key)).toEqual(['Jazz']);
  env.host.answer('library.getAll', genreTracksAnswer([track]));
  await env.library.retry();
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  env.catalog.dispose();
  held.respond(0, valuesAnswer('Late'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(env.state().entries.map((entry) => entry.key)).toEqual(['Jazz']);
});

it('部分读取没有文件信息时按失败处理，不把它当缺失流派', async () => {
  const env = genresLibrary([track]);
  env.host.answer('titleformat.evalBatch', {
    success: true,
    pattern: GENRES_VALUES_PATTERN,
    total: 1,
    successCount: 1,
    errorCount: 0,
    results: [{ path: track.path, success: true, result: '', infoAvailable: false }],
  });
  env.catalog.want();
  await vi.waitFor(() => expect(env.state().status).toBe('failed'));
  expect(env.state().entries.some((entry) => entry.key === EMPTY_GENRE)).toBe(false);
});

it('标签补读在途时整库重取失败，晚到标签不能把失败改成就绪', async () => {
  const env = genresLibrary([track]);
  env.host.answer('titleformat.evalBatch', valuesAnswer('Rock\u001fSoul'));
  const held = env.host.hold('titleformat.evalBatch');
  env.catalog.want();
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  env.host.answer('library.getAll', hostFailure('OPERATION_FAILED'));
  await env.library.retry();
  expect(env.state().status).toBe('failed');
  held.release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(env.state().status).toBe('failed');
  expect(env.state().entries).toEqual([]);
});
