import type { MessageKey } from '../i18n/en.ts';

export type CreditId =
  | 'foobar2000'
  | 'webview2'
  | 'react'
  | 'fluentReact'
  | 'fluentIcons'
  | 'jotai'
  | 'tanstackVirtual'
  | 'materialColors'
  | 'amll'
  | 'foobox'
  | 'lyricify'
  | 'opencc';

export interface Credit {
  readonly id: CreditId;
  /** 项目的名字与作者照原文写，不翻译。 */
  readonly name: string;
  readonly author: string;
  /** 它在这个主题里起什么作用。 */
  readonly role: MessageKey;
  /** 许可的 SPDX 标识；不是以开源许可分发的不写。 */
  readonly license?: string;
  readonly url: string;
  /** 对应 package.json 里的哪几个依赖；不是 npm 依赖的为空。依赖增减时靠它发现这张表没跟上。 */
  readonly packages: readonly string[];
}

export interface CreditSection {
  readonly title: MessageKey;
  readonly credits: readonly Credit[];
}

/** 致谢的内容：先是播放器与运行环境，再是打进产物的开源组件，最后是代码有出处的地方。 */
export const CREDIT_SECTIONS: readonly CreditSection[] = [
  {
    title: 'settings.creditsRuntime',
    credits: [
      {
        id: 'foobar2000',
        name: 'foobar2000',
        author: 'Peter Pawłowski',
        role: 'settings.creditRolePlayer',
        url: 'https://www.foobar2000.org/',
        packages: [],
      },
      {
        id: 'webview2',
        name: 'Microsoft Edge WebView2',
        author: 'Microsoft',
        role: 'settings.creditRoleRuntime',
        url: 'https://developer.microsoft.com/microsoft-edge/webview2/',
        packages: [],
      },
    ],
  },
  {
    title: 'settings.creditsLibraries',
    credits: [
      {
        id: 'materialColors',
        name: 'Material Color Utilities',
        author: 'Google',
        role: 'settings.creditRoleColors',
        license: 'Apache-2.0',
        url: 'https://github.com/material-foundation/material-color-utilities',
        packages: ['@material/material-color-utilities'],
      },
      {
        id: 'amll',
        name: 'Apple Music-like Lyrics',
        author: 'Steve-xmh',
        role: 'settings.creditRoleLyrics',
        license: 'AGPL-3.0-only',
        url: 'https://github.com/amll-dev/applemusic-like-lyrics',
        packages: ['@applemusic-like-lyrics/core', '@applemusic-like-lyrics/lyric'],
      },
      {
        id: 'react',
        name: 'React',
        author: 'Meta',
        role: 'settings.creditRoleFramework',
        license: 'MIT',
        url: 'https://react.dev/',
        packages: ['react', 'react-dom'],
      },
      {
        id: 'fluentReact',
        name: 'Fluent UI React',
        author: 'Microsoft',
        role: 'settings.creditRoleControls',
        license: 'MIT',
        url: 'https://react.fluentui.dev/',
        packages: ['@fluentui/react-components'],
      },
      {
        id: 'fluentIcons',
        name: 'Fluent UI System Icons',
        author: 'Microsoft',
        role: 'settings.creditRoleIcons',
        license: 'MIT',
        url: 'https://github.com/microsoft/fluentui-system-icons',
        packages: ['@fluentui/react-icons'],
      },
      {
        id: 'jotai',
        name: 'Jotai',
        author: 'Daishi Kato, Poimandres',
        role: 'settings.creditRoleState',
        license: 'MIT',
        url: 'https://jotai.org/',
        packages: ['jotai'],
      },
      {
        id: 'tanstackVirtual',
        name: 'TanStack Virtual',
        author: 'Tanner Linsley',
        role: 'settings.creditRoleVirtual',
        license: 'MIT',
        url: 'https://tanstack.com/virtual',
        packages: ['@tanstack/react-virtual'],
      },
    ],
  },
  {
    title: 'settings.creditsSources',
    credits: [
      {
        id: 'foobox',
        name: 'foobox',
        author: 'dreamawake',
        role: 'settings.creditRoleVolume',
        license: 'GPL-3.0',
        url: 'https://github.com/dream7180',
        packages: [],
      },
      {
        id: 'lyricify',
        name: 'Lyricify Lyrics Helper',
        author: 'WXRIW',
        role: 'settings.creditRoleLyricsMatch',
        license: 'Apache-2.0',
        url: 'https://github.com/WXRIW/Lyricify-Lyrics-Helper',
        packages: [],
      },
      {
        id: 'opencc',
        name: 'OpenCC',
        author: 'BYVoid',
        role: 'settings.creditRoleChineseVariants',
        license: 'Apache-2.0',
        url: 'https://github.com/BYVoid/OpenCC',
        packages: [],
      },
    ],
  },
];
