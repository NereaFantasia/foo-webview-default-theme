import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArtistHero } from '../../../../src/library/detail/ArtistHero.tsx';

/** 头部「照片」键写的状态：转圈、可打开、禁用；不给 `onOpenPhotos` 时没有这枚键 */
function photosKey(props: {
  readonly photosLoading?: boolean;
  readonly canOpenPhotos: boolean;
  readonly withKey?: boolean;
}) {
  const html = renderToStaticMarkup(
    <ArtistHero
      name="Aimer"
      narrow={false}
      wide={false}
      loading={false}
      playable
      canOpenPhotos={props.canOpenPhotos}
      {...(props.photosLoading === undefined ? {} : { photosLoading: props.photosLoading })}
      {...(props.withKey === false ? {} : { onOpenPhotos: () => {} })}
      onPlay={() => {}}
      onShuffle={() => {}}
      onMenu={() => {}}
    />,
  );
  const tag = /<button[^>]*data-artist-photos="(\w+)"[^>]*>/.exec(html);
  return {
    state: tag?.[1] ?? null,
    disabled: tag ? /\sdisabled(=|\s|>)/.test(tag[0]) : null,
    spinner: html.includes('fui-Spinner'),
  };
}

describe('头部的「照片」键', () => {
  it('来源还在拉时键的位置转圈，拉完换回图标；没有照片时禁用', () => {
    expect(photosKey({ photosLoading: true, canOpenPhotos: false })).toEqual({
      state: 'loading',
      disabled: true,
      spinner: true,
    });
    expect(photosKey({ photosLoading: false, canOpenPhotos: false })).toEqual({
      state: 'empty',
      disabled: true,
      spinner: false,
    });
    expect(photosKey({ photosLoading: false, canOpenPhotos: true })).toEqual({
      state: 'ready',
      disabled: false,
      spinner: false,
    });
  });

  it('已经有照片可看时来源还在拉就仍转圈，但不禁用、可以点开', () => {
    expect(photosKey({ photosLoading: true, canOpenPhotos: true })).toEqual({
      state: 'loading',
      disabled: false,
      spinner: true,
    });
  });

  it('不给 onOpenPhotos 就没有这枚键', () => {
    expect(photosKey({ canOpenPhotos: false, withKey: false })).toEqual({
      state: null,
      disabled: null,
      spinner: false,
    });
  });
});
