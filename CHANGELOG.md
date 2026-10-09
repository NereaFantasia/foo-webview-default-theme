# 更新内容

foo-webview-default-theme 每个版本的变化。主题里显示的更新日志和发行页正文都由这份文件生成，写法见 `src/update/changelogSource.ts` 开头的说明。

## 0.2.0

### zh-CN

#### 背景、歌词与窄窗布局

加入流动背景、歌词候选预览与时间校正，拖动进度条时可查看目标位置的歌词。窄窗口的侧栏与右侧视图使用统一的布局和展开收起动效。

- [palette] **背景与磨砂** 流动背景随封面配色，深浅模式分别调节亮度、饱和度与磨砂效果；主题色背景可跟随强调色。
- [search] **先预览，再选词** 搜索结果补充歌词信息，并在来源提供时显示封面；支持预览候选歌词，将选中的结果设为曲目的默认歌词。
- [lyrics] **歌词显示与校正** 支持提前或延后歌词、重播当前句；可调整字体、译文和音译显示，以及本地、在线逐字、逐行歌词的优先级。
- [player] **进度条歌词预览** 有时间轴歌词时，悬停或拖动可查看目标时间附近的歌词；跳转与切歌时的进度反馈保持连贯。
- [window] **窄窗侧栏与返回** 统一左右浮层和媒体库侧栏的布局、留白与开合动效；右侧视图拥有独立的前进、后退历史。
- [update] **本地服务** 自动准备所需运行环境，已安装内容可离线复用；设置中可查看状态并重试，服务未就绪时仍可播放音乐和使用主题。

##### 改进与修复

- 补充界面缩放、动效和沉浸视图设置入口，歌词设置按功能分组。
- Windows 10 或窗口材质不可用时使用主题色背景，并提示材质应用失败。
- 修正切歌、停止播放、缺少封面及退出沉浸视图时的背景闪烁与残留。
- 修正歌词搜索的部分来源查询与候选信息，修正返回搜索页面时状态和时间校正丢失的问题。
- 修正窄窗侧栏中右键菜单、重命名与 Esc 关闭的交互。
- 更新日志跟随当前界面语言；播放统计部分读取失败时保留其他可用内容。
- 修正从托盘恢复后再次收起窗口的问题；窗口不可见时暂停相关背景和可视化任务。

### en

#### Backgrounds, lyrics and compact layouts

Flowing backgrounds, lyric candidate previews and timing adjustments. See lyrics at the target position while seeking, with consistent sidebar layouts and transitions in narrow windows.

- [palette] **Backgrounds and frosted surfaces** Flowing backgrounds use cover colors. Adjust brightness, saturation and frosted effects separately for light and dark modes, or use a background tinted by your accent color.
- [search] **Preview before choosing** Search results include more lyric details and cover art when supplied by the source. Preview a candidate and save your choice as the default lyrics for the track.
- [lyrics] **Display and timing** Move lyrics earlier or later and replay the current line. Adjust fonts, translations and romanization, and set the priority of local, word-synced and line-synced lyrics.
- [player] **Lyrics while seeking** When timed lyrics are available, hover over or drag the progress bar to see lyrics near the target time, with continuous progress feedback when seeking or changing tracks.
- [window] **Sidebars and navigation** Side overlays and library sidebars share consistent spacing and transitions in narrow windows. The right pane has its own back and forward history.
- [update] **Local service** Required runtime files are prepared automatically and reused offline once installed. Check its status or retry in Settings; music playback and the theme remain available if the service is not ready.

##### Improvements and fixes

- Added settings for interface scaling, motion and the immersive view, and grouped lyric settings by function.
- Use an accent-tinted background on Windows 10 or when window materials are unavailable, with feedback when a material fails to apply.
- Fixed background flashes and lingering images when changing tracks, stopping playback, displaying tracks without covers or leaving the immersive view.
- Fixed queries to some lyric sources and candidate details. Fixed search state and timing adjustments being lost when returning to lyrics.
- Fixed context menus, renaming and Escape handling in narrow sidebars.
- Release notes follow the current interface language. A failed playback-statistics request no longer hides other available content.
- Fixed the window hiding again after restoration from the tray. Related background and visualization tasks pause while the window is hidden.

## 0.1.0

### zh-CN

#### 第一个公开版本

Default Theme 首次公开发布，为 foobar2000 提供 WinUI 3 风格的界面。需要 foo_ui_webview2 2.0.0 或更高版本，并以独立窗口运行。

- [palette] **封面取色** 配色随封面而变；强调色也可使用 Windows 强调色或自定义颜色。
- [library] **媒体库** 按专辑、艺人、流派、歌曲与文件夹浏览，支持全局搜索。
- [lyrics] **歌词** 支持逐字高亮与双语对照，可读取本地歌词或搜索在线歌词。
- [sparkle] **沉浸视图** 封面、频谱、声场、整轨波形与歌词集中呈现。
- [window] **迷你播放器** 紧凑与封面两种形态，可始终置顶。
- [update] **在线更新** 在主题内检查、下载和安装新版，校验签名与哈希；新版启动失败时可自动回退。

### en

#### First public release

Default Theme brings a WinUI 3 style interface to foobar2000. Requires foo_ui_webview2 2.0.0 or later in standalone window mode.

- [palette] **Cover colors** Colors follow the playing cover; the accent can also use the Windows accent or a custom color.
- [library] **Library** Browse by album, artist, genre, song or folder, with global search.
- [lyrics] **Lyrics** Word-synced highlighting and translations, with local lyrics and online search.
- [sparkle] **Immersive view** Album art, spectrum, stereo field, full-track waveform and lyrics in one view.
- [window] **Mini player** Compact and cover layouts, with an option to stay on top.
- [update] **Online updates** Check, download and install updates in the theme, with signature and hash checks and automatic rollback if a new version fails to start.
