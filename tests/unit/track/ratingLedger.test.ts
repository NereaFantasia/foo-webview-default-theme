import { describe, expect, it } from 'vitest';
import { fileKeyOf, RatingLedger } from '../../../src/track/ratingLedger.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

const TRACK = makeTrack({ rating: 2 });
const FILE = fileKeyOf(TRACK);
const CUE_1 = makeTrack({ path: 'file://E:/Music/Live.flac', subsong: 1, rating: 1 });
const CUE_2 = makeTrack({ path: 'file://E:/Music/Live.flac', subsong: 2, rating: 3 });

describe('自己写的值', () => {
  it('确认之前压过戳更新的行', () => {
    const ledger = new RatingLedger();
    const write = ledger.begin(TRACK, 5);
    const later = ledger.tick();
    expect(ledger.ratingOf({ ...TRACK, rating: 1 }, later)).toBe(5);
    expect(ledger.finish(TRACK, write, 5, true)).toBe('accepted');
    expect(ledger.ratingOf({ ...TRACK, rating: 1 }, ledger.tick())).toBe(5);
  });

  it('确认之后按先后比：之前取的行让位，之后取的行为准', () => {
    const ledger = new RatingLedger();
    ledger.finish(TRACK, ledger.begin(TRACK, 5), 5, true);
    const before = ledger.tick();
    expect(ledger.confirm(TRACK.handle)).toBe(true);
    expect(ledger.ratingOf({ ...TRACK, rating: 1 }, before)).toBe(5);
    expect(ledger.ratingOf({ ...TRACK, rating: 1 }, ledger.tick())).toBe(1);
  });

  it('两次写入都失败：回到写之前的样子，不回到第一次没写成的值', () => {
    const ledger = new RatingLedger();
    const first = ledger.begin(TRACK, 3);
    const second = ledger.begin(TRACK, 4);
    expect(ledger.finish(TRACK, first, 3, false)).toBe('superseded');
    expect(ledger.finish(TRACK, second, 4, false)).toBe('rolledBack');
    expect(ledger.ratingOf(TRACK, 0)).toBe(2);
  });

  it('被顶掉的那次成功了、后来那次失败：回到被顶掉那次写成的值', () => {
    const ledger = new RatingLedger();
    const first = ledger.begin(TRACK, 3);
    const second = ledger.begin(TRACK, 4);
    ledger.finish(TRACK, first, 3, true);
    ledger.finish(TRACK, second, 4, false);
    expect(ledger.ratingOf(TRACK, ledger.tick())).toBe(3);
    expect(ledger.awaitingConfirm(TRACK.handle)).toBe(true);
  });

  it('回滚回到上一次确认过的值', () => {
    const ledger = new RatingLedger();
    ledger.finish(TRACK, ledger.begin(TRACK, 3), 3, true);
    ledger.confirm(TRACK.handle);
    ledger.finish(TRACK, ledger.begin(TRACK, 5), 5, false);
    expect(ledger.ratingOf(TRACK, 0)).toBe(3);
  });

  it('别处写成的值顶掉在途的写入', () => {
    const ledger = new RatingLedger();
    const write = ledger.begin(TRACK, 3);
    ledger.assume(TRACK, 1);
    expect(ledger.finish(TRACK, write, 3, false)).toBe('superseded');
    expect(ledger.ratingOf(TRACK, 0)).toBe(1);
  });

  it('回声比应答先到：写成时直接算确认；在途时又报了别的值，就不算', () => {
    const ledger = new RatingLedger();
    const write = ledger.begin(TRACK, 4);
    ledger.fromEvent(FILE, 4);
    expect(ledger.finish(TRACK, write, 4, true)).toBe('accepted');
    expect(ledger.awaitingConfirm(TRACK.handle)).toBe(false);
    expect(ledger.ratingOf({ ...TRACK, rating: 1 }, ledger.tick())).toBe(1);
    const again = ledger.begin(TRACK, 5);
    ledger.fromEvent(FILE, 5);
    ledger.fromEvent(FILE, 3);
    ledger.finish(TRACK, again, 5, true);
    expect(ledger.awaitingConfirm(TRACK.handle)).toBe(true);
  });

  it('到时限：等的时候宿主报来过不同的值，以宿主的为准；没报过就按确认处理', () => {
    const ledger = new RatingLedger();
    ledger.finish(TRACK, ledger.begin(TRACK, 5), 5, true);
    const stamp = ledger.tick();
    ledger.fromEvent(FILE, 3);
    expect(ledger.ratingOf(TRACK, stamp)).toBe(5);
    ledger.expire(TRACK.handle);
    expect(ledger.ratingOf(TRACK, stamp)).toBe(3);
    const other = makeTrack({ path: 'file://E:/Music/Other.flac', rating: 1 });
    ledger.finish(other, ledger.begin(other, 4), 4, true);
    ledger.expire(other.handle);
    expect(ledger.awaitingConfirm(other.handle)).toBe(false);
    expect(ledger.ratingOf(other, 0)).toBe(4);
  });

  it('写入在途时不确认', () => {
    const ledger = new RatingLedger();
    ledger.begin(TRACK, 3);
    expect(ledger.awaitingConfirm(TRACK.handle)).toBe(false);
    expect(ledger.confirm(TRACK.handle)).toBe(false);
  });
});

describe('事件与补读', () => {
  it('整文件的曲目取事件报的值', () => {
    const ledger = new RatingLedger();
    const stamp = ledger.tick();
    ledger.fromEvent(FILE, 4);
    expect(ledger.ratingOf(TRACK, stamp)).toBe(4);
  });

  it('同一个值再报也记新的先后：重取行之后宿主改回上一次报过的值，盖得过行里的值', () => {
    const ledger = new RatingLedger();
    ledger.fromEvent(FILE, 4);
    const refetched = ledger.tick();
    const row = { ...TRACK, rating: 1 };
    expect(ledger.ratingOf(row, refetched)).toBe(1);
    ledger.fromEvent(FILE, 4);
    expect(ledger.ratingOf(row, refetched)).toBe(4);
  });

  it('报出与自己等确认的值相同就算确认；报的不同时自己的值仍为准', () => {
    const ledger = new RatingLedger();
    ledger.finish(TRACK, ledger.begin(TRACK, 0), 0, true);
    ledger.fromEvent(FILE, 3);
    expect(ledger.ratingOf(TRACK, ledger.tick())).toBe(0);
    expect(ledger.awaitingConfirm(TRACK.handle)).toBe(true);
    ledger.fromEvent(FILE, 0);
    expect(ledger.awaitingConfirm(TRACK.handle)).toBe(false);
  });

  it('一个文件里有好几首：事件报的值不套给其中任何一首，已确认的偏离丢掉，等确认的留着', () => {
    const ledger = new RatingLedger();
    ledger.markMultiTrack(fileKeyOf(CUE_1));
    ledger.assume(CUE_1, 5);
    ledger.confirm(CUE_1.handle);
    ledger.assume(CUE_2, 4);
    expect(ledger.isWholeFile(makeTrack({ path: CUE_1.path, subsong: 0 }))).toBe(false);
    ledger.fromEvent(fileKeyOf(CUE_1), 2);
    expect(ledger.ratingOf(CUE_1, 0)).toBe(1);
    expect(ledger.ratingOf(CUE_2, 0)).toBe(4);
  });

  it('一个文件里有好几首：报的值与已确认的自写值相同时留着它', () => {
    const ledger = new RatingLedger();
    ledger.markMultiTrack(fileKeyOf(CUE_1));
    ledger.assume(CUE_1, 5);
    ledger.confirm(CUE_1.handle);
    ledger.fromEvent(fileKeyOf(CUE_1), 5);
    expect(ledger.ratingOf(CUE_1, 0)).toBe(5);
  });

  it('登记时记下不止一首的文件：带 subsong 的，或同一个文件出现了几次', () => {
    const ledger = new RatingLedger();
    const twice = makeTrack({ path: 'file://E:/Music/Twice.flac', subsong: 0 });
    ledger.register([TRACK, twice, { ...twice, handle: 'twice#2' }], ledger.tick());
    expect(ledger.isWholeFile(TRACK)).toBe(true);
    expect(ledger.isWholeFile(twice)).toBe(false);
    ledger.register([CUE_1], ledger.tick());
    expect(ledger.isWholeFile(makeTrack({ path: CUE_1.path, subsong: 0 }))).toBe(false);
  });

  it('登记时答出错过事件的多首文件曲目：事件晚于取行、也晚于补读与自己写的值', () => {
    const ledger = new RatingLedger();
    const stamp = ledger.tick();
    ledger.register([CUE_1, CUE_2], stamp);
    ledger.fromEvent(fileKeyOf(CUE_1), 4);
    // 整文件一首的曲目直接取事件报的值，不用补读。
    ledger.fromEvent(FILE, 1);
    ledger.fromRead(CUE_1.handle, 4);
    expect(ledger.register([CUE_1, CUE_2, TRACK], stamp)).toEqual([CUE_2]);
    expect(ledger.register([CUE_2], ledger.tick())).toEqual([]);
    ledger.fromEvent(fileKeyOf(CUE_1), 2);
    ledger.assume(CUE_2, 5);
    expect(ledger.register([CUE_1, CUE_2], stamp)).toEqual([CUE_1]);
  });

  it('按行给戳：每首按自己那一页的戳比事件，缺戳的按 0 算', () => {
    const ledger = new RatingLedger();
    ledger.markMultiTrack(fileKeyOf(CUE_1));
    const early = ledger.tick();
    ledger.fromEvent(fileKeyOf(CUE_1), 4);
    const late = ledger.tick();
    // CUE_1 那一页在事件之前取的，要补读；CUE_2 那一页在事件之后取的，行里的值已经新了。
    expect(ledger.register([CUE_1, CUE_2], [early, late])).toEqual([CUE_1]);
    expect(ledger.register([CUE_1, CUE_2], [late])).toEqual([CUE_2]);
  });

  it('按行给戳时，同一个文件落在两页里也记成不止一首', () => {
    const ledger = new RatingLedger();
    const twice = makeTrack({ path: 'file://E:/Music/Twice.flac', subsong: 0 });
    const first = ledger.tick();
    const second = ledger.tick();
    ledger.register([twice, TRACK, { ...twice, handle: 'twice#2' }], [first, first, second]);
    expect(ledger.isWholeFile(twice)).toBe(false);
    expect(ledger.isWholeFile(TRACK)).toBe(true);
  });

  it('补读回来的值比此前取的行新', () => {
    const ledger = new RatingLedger();
    const stamp = ledger.tick();
    ledger.fromRead(CUE_2.handle, 5);
    expect(ledger.ratingOf(CUE_2, stamp)).toBe(5);
    expect(ledger.ratingOf({ ...CUE_2, rating: 1 }, ledger.tick())).toBe(1);
  });
});
