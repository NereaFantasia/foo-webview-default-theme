# 更新内容

foo-webview-default-theme 每个版本的变化。主题里显示的更新日志和发行页正文都由这份文件生成，写法见 `src/update/changelogSource.ts` 开头的说明。

## 0.3.0 - 2026-10-28

### zh-CN

#### 在线音乐、沉浸歌词与统一的页面工具栏

加入网易云音乐在线搜索与直接播放，沉浸视图新增歌词样式与 Coverflow，支持独立桌面歌词。媒体库各页提供统一的工具栏与筛选，艺人与专辑名称支持随处点击跳转。

- [search] **在线音乐** 搜索网易云音乐的曲目、专辑、歌单和艺人并直接播放，在播放栏查看并切换音质。支持按可播放、无损、高解析及艺人专辑等条件二次筛选结果，支持扫码登录以享受账号权益。
- [search] **其他平台** 支持通过自定义音源扩展更多平台，可搜索并播放 QQ 音乐、酷我、酷狗和咪咕的曲目。支持播放故障时自动切换备用音源，并在设置中提供音源可用性检测。（主题不内置任何音源）
- [player] **沉浸歌词视图与 Coverflow** 沉浸视图新增以歌词为核心的「歌词」样式，整合曲目信息、播放队列与历史，并与原有「图纸」样式保持互通。新增 Coverflow 封面流模式，支持通过封面快速浏览并选播曲目。
- [lyrics] **桌面歌词** 新增置顶独立窗口的桌面歌词，支持锁定窗口、单行/多行切换与样式预设。可通过播放栏、标题栏或托盘菜单快速开关，并支持录制全局快捷键。
- [library] **统一的页面工具栏** 歌曲、播放列表、专辑、流派和文件夹页的页头统一采用标题行与命令栏布局，集中搜索、筛选、排序和分组操作。选中多首曲目后，命令栏自动切换为批量操作。
- [window] **随处可点的艺人与专辑** 播放栏、曲目表、侧栏及详情页中的艺人、专辑和流派名称均支持直接点击跳转，多位艺人时支持弹出菜单选择。

##### 改进与修复

- 自动更新模式支持后台预先下载并校验组件，关闭 foobar2000 替换文件前仍需手动点击「重启安装」确认。
- 菜单统一为 Windows 11 风格，级联菜单支持展开动效，长菜单滚动条保持一致。
- 全局搜索新增艺人类别，最佳匹配支持显示艺人，并覆盖全部标签、技术信息与路径。
- 歌曲、专辑、文件夹和流派列表支持关闭分组，未分组时每行显示缩略图；播放列表补齐曲目列，支持双向排序。
- 播放队列精简「下一轮」分段，行内封面随行高自适应缩放。
- 播放进度条在宿主两次更新之间逐帧平滑推进，拖动进度时按 Esc 可取消。
- 滚动条按需显示并在闲置后自动隐藏。
- 专辑墙与首页专辑卡封面加载后淡入显示，悬停按钮支持平滑淡入淡出。
- 颜色模式、播放按钮、窗口背景、沉浸视图样式、歌词对齐及桌面歌词等设置项改为带缩略图的卡片单选。
- 歌词支持自定义文字对齐方式（左对齐、居中或右对齐）。
- 侧边栏新增「视频」入口，支持浏览本地视频并定位所在文件夹；文件夹中的视频右键支持直接播放。
- 托盘菜单歌曲卡适配在线曲目，正常显示封面、曲名与艺人。
- 修正返回搜索结果页时意外触发的过渡动画，以及搜索浮层中 Tab 键循环切换焦点的问题。
- 修正手动切歌或新曲目时长未知时进度条未平滑归零的问题。
- 修正托盘菜单歌曲卡封面裁剪仅显示左上角的问题。

### en

#### Online music, immersive lyrics and consistent toolbars

Search and play NetEase Cloud Music online. The immersive view gains a lyrics style and Coverflow, with support for floating desktop lyrics. Library pages share a consistent toolbar and filters, and artist and album names are clickable throughout the app.

- [search] **Online music** Search NetEase Cloud Music for tracks, albums, playlists and artists and play them directly. Check and switch audio quality from the player bar, filter loaded results by quality or metadata, and sign in via QR code to access your account's benefits.
- [search] **Other platforms** Expand online search to QQ Music, Kuwo, Kugou and Migu by importing trusted sources. Features automatic fallback to alternate sources during playback and source health checks in Settings. (The theme ships no sources)
- [player] **Immersive lyrics view and Coverflow** The immersive view gains a Lyrics style focused on lyrics, alongside track details, the queue and history. Adds Coverflow mode to browse and play tracks visually.
- [lyrics] **Desktop lyrics** Show lyrics in a separate, lockable always-on-top window with single- or multi-line display and style presets. Toggle from the player bar, menus or tray, with customizable global shortcuts.
- [library] **Consistent page toolbars** Songs, playlists, albums, genres and folders pages share a consistent header layout with a title row and command bar for search, filters, sorting and grouping. Switches to batch actions when multiple tracks are selected.
- [window] **Clickable artists and albums** Artist, album and genre names across the player bar, track tables, right pane and detail pages now open their corresponding pages directly.

##### Improvements and fixes

- Automatic update mode downloads and verifies new component files in the background, waiting for you to click "Restart and install" before replacing files.
- Menus follow the Windows 11 style with smooth cascading transitions and consistent scrollbars.
- Global search adds an Artists category, supports artists as the best match, and searches across all tags, technical info and paths.
- Songs, albums, folders and genres lists can disable grouping, showing thumbnails on each row; playlists gain track columns and two-way sorting.
- The play queue removes the "Next round" separator, and row covers scale with row height.
- The progress bar eases smoothly frame-by-frame between host updates, and Escape cancels a seek drag.
- Scrollbars appear on demand and hide automatically when inactive.
- Album covers fade in smoothly upon loading, with faded hover action buttons.
- Settings for color mode, play button, window materials, immersive view style, lyric alignment and desktop lyrics now use visual single-choice cards with thumbnails.
- Lyrics now support text alignment options (left, center or right).
- The sidebar gains a Video section to browse videos and open their folders; right-click videos in Folders to play directly.
- Tray menu song cards now support online tracks with cover art, title and artist.
- Fixed a stray transition animation when returning to search results, and Tab cycling between scope tabs in the search flyout.
- Fixed the progress bar not easing back to zero when switching tracks manually or when track length is unknown.
- Fixed the tray song card cover only showing its top-left corner.

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
