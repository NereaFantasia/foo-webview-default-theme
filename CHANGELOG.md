# 更新内容

foo-webview-default-theme 每个版本的变化。主题里显示的更新日志和发行页正文都由这份文件生成，写法见 `src/update/changelogSource.ts` 开头的说明。

## 0.4.1 - 2026-11-16

### zh-CN

#### Hi-Res 标记、分视图歌词设置与视频页快捷键

高解析度无损曲目支持显示金色 Hi-Res 标识，主视图与沉浸视图提供独立的歌词外观设置，视频页补上快捷键与画面操作。

- [player] **Hi-Res 标记** 对位深高于 16 位或采样率高于 48 kHz 的无损曲目，音质标记内新增金色 Hi-Res 标识，编码边框同步呈现金色。沉浸视图中音质标记固定于曲名行右端，不随曲名长度位移；窗口底部的播放栏与胶囊播放条也显示本地曲目的音质标记。
- [lyrics] **歌词分视图设置** 「设置 > 歌词」为主视图与沉浸视图分别提供独立的设置卡片，字号、字体、对齐、译文与音译显示、动效及当前行位置均可按视图单独调整；升级后自动沿用既有配置，显示效果保持不变。
- [player] **视频页快捷键与画面操作** 新增静音、回到开头、数字键 0-9 跳到 0%-90% 处、前后跳转 10 秒、Shift+P/N 切上一首下一首等键位；画面上单击播放或暂停、双击全屏、滚轮调音量。完整键位见「设置 > 快捷键」的「视频页」。
- [library] **首页统计缓存** 首页播放统计在初次生成后缓存至本地，后续打开仅增量读取有变动的曲目，打开更快；若在常规设置中停用媒体库缓存，本缓存机制不使用。

##### 改进与修复

- 沉浸视图歌词字号调整为相对于基准大小的缩放比例（50% 至 225%），工具栏与设置页读数保持一致。
- 高采样率曲目的频谱不再缩在左侧：横轴右端最高到 24 kHz。
- 沉浸视图背景优先读取当前播放曲目的现有封面，避免等待远端下载延迟，亦不再残留上一首曲目的封面。
- 沉浸视图的大封面超过 0.2 秒未取到时，先显示当前曲目封面，大图到了再换成大图。
- 修复 Coverflow 切换选中封面时先变糊再变清的问题。
- 修复长按空格键导致视频反复切换播放与暂停状态的问题。
- 修复标题栏视频按钮点击无响应的问题；视频页内嵌时让出阅读面的细边框，不再盖住它。
- 非本地文件（如网络流）时，视频页的「打开所在文件夹」置灰。
- 「关于」页运行日志新增整轨分析、DR 与响度量表的失败和过慢记录（耗时达到 30 秒起记），记录不含曲目路径与标题。

### en

#### Hi-Res badge, per-view lyrics settings and video page shortcuts

High-resolution lossless tracks feature a gold Hi-Res badge, the main and immersive views provide independent lyrics settings, and the video page gains keyboard shortcuts and mouse controls.

- [player] **Hi-Res badge** Lossless tracks with bit depth exceeding 16 bits or sample rates above 48 kHz now display a gold Hi-Res tag inside the format badge, with a matching gold codec border. In immersive views, the badge is anchored to the right end of the title row regardless of title length; the bottom bar and capsule player also display the format badge for local tracks.
- [lyrics] **Lyrics settings per view** Settings > Lyrics now offers dedicated cards for the main view and the immersive view, allowing independent configuration of font size, font family, alignment, translations and romanization, motion effects, and current-line positioning; existing preferences are preserved across upgrades.
- [player] **Video page shortcuts and mouse controls** Adds mute, seeking to start (Home), digit keys 0–9 seeking to 0%–90%, 10-second jumps (J, L), and Shift+P/N for previous and next tracks. On the video surface, a click plays or pauses, a double click toggles full screen, and the wheel changes the volume. See Video page under Settings > Shortcuts.
- [library] **Home statistics cache** Home play statistics are cached locally, and later opens read only the tracks that changed, making the page open faster. The cache is not used when the library cache is off in General settings.

##### Improvements and fixes

- The immersive lyrics font size is now represented as a scale percentage (50% to 225%), matching in the floating toolbar and in settings.
- Refined the spectrum display at high sample rates: the axis now ends at 24 kHz at most.
- The immersive background now prioritizes the current track's cached cover, eliminating download delays and preventing covers from previous tracks from lingering.
- When the large cover in the immersive view takes longer than 0.2 seconds, the track's current cover shows first and is replaced once the large image arrives.
- Fixed an issue where selected Coverflow artwork temporarily blurred before regaining sharpness.
- Fixed repeated play/pause toggling when holding down the Space key during video playback.
- Fixed an issue where the title bar video button did not respond to clicks; the embedded video page now leaves room for the thin border of the reading surface without overlapping it.
- Open containing folder on the video page is dimmed for non-local tracks (such as network streams).
- The runtime log in About records failed or slow whole-track analysis and DR and loudness meter runs (taking 30 seconds or longer), without track paths or titles.

## 0.4.0 - 2026-11-15

### zh-CN

#### 首页、艺人页与沉浸视图的新样式

首页改成门户，艺人页重做并接入 Apple Music 简介。沉浸视图新增满幅封面与流动色场，自动播放列表可以创建和编辑。

- [library] **门户式首页** 首页集中快捷入口、本地统计与推荐，以及网易云的横幅、新歌、榜单、歌单和新碟。进入编辑模式后，可以调整各行的次序和显示。
- [library] **重做的艺人页** 艺人页改成圆形头像的封面墙，点开进入整页详情，有宽幅头图、热门曲目和专辑。简介默认来自 Apple Music，也可以在设置里改用 Last.fm。
- [player] **沉浸视图的新样式** 新增「满幅封面」样式和「流动色场」背景，钛金属与网格渐变背景可以随音乐律动。版式直接在画面上编辑，沉浸视图里按 Ctrl+B 打开浏览面板。
- [library] **自动播放列表** 在歌曲页按当前条件创建自动播放列表，在播放列表页或侧边栏右键菜单里编辑。查询框带语法着色、补全和语法参考，专辑页与播放列表页的搜索框也支持高级查询。
- [search] **在线曲目收藏** 网易云的曲目可以收藏到本地，在「收藏」页查看。在线曲目表、播放栏、页头和菜单里都有收藏键。
- [library] **媒体库缓存与歌词缓存** 歌曲、专辑和整库曲目优先从本地缓存读取，缓存读不到时仍向 foobar2000 取。可以在「常规」的「数据」里关闭缓存、查看占用和重建。歌词的查询结果也会缓存在本地。
- [palette] **设置与外观** 设置页改成一次显示一个分区。界面字体、中日韩字体和歌词字体可以自定义，字重也可调。曲目表新增碟号、文件名、文件夹、作曲等十个可选列。
- [log] **运行日志** 「关于」页新增运行日志，可以复制版本、窗口状态和最近的记录，用于反馈问题。启动失败页也能复制，记录在写入时已脱敏。

##### 改进与修复

- 新人引导的第 4 步加入在线歌词开关，并显示本地服务的准备状态，失败时可以重试。
- 启动时缺省打开首页。
- 播放设置里可以调整 ReplayGain、DSP 预设与输出缓冲。
- 在线曲目播放时预取下一首，切歌时更快接上。在线曲目也支持整轨分析，可选预载整首、按需分段或关闭。
- 桌面歌词新增自定义字号、译文字号和多行自定义动效。
- 本地动图封面可以在信息页的展开封面和沉浸大封面里播放。
- 右侧卡的页面入口改成队列、歌词、信息、简介四个键，去掉卡内的分页栏。
- 文本框的右键菜单提供剪切、复制、粘贴和全选。
- 快捷键一览新增沉浸视图一节。
- 主题与 foobar2000 绑定了相同的快捷键时，以主题为准。桌面歌词的全局快捷键只接受带 Ctrl、Alt 或 Win 的组合。
- 空格在普通页面也能播放或暂停。
- 键盘焦点环不再被滚动区、截断行和列头裁切。
- 修正 125% 缩放下滚动后曲目表文字发虚的问题。
- 修正署名放不下时艺人与专辑的显示：两者均分宽度，各自截断，名字仍可点击。
- 修正下拉与菜单被标题栏遮住的问题，长下拉固定在触发控件下方。
- 英文界面下，认定与搜索艺人时使用英文曲风名，英文简介里不再带 `<i>` 标记。
- 流派整理时，单个流派（如 R&B）不再被判成多个。

### en

#### New home, artist pages and immersive styles

The home page becomes a portal, and artist pages are rebuilt with Apple Music biographies. The immersive view adds a full-bleed cover style and a flowing color field, and autoplaylists can be created and edited.

- [library] **Portal home page** Home gathers quick entries, local statistics and recommendations, plus NetEase banners, new songs, charts, playlists and new albums. Enter edit mode to reorder rows or hide them.
- [library] **Rebuilt artist pages** Artists now appear as a wall of round portraits that opens a full page with a wide header image, top tracks and albums. Biographies come from Apple Music by default and can be switched to Last.fm in Settings.
- [player] **New immersive styles** Adds a Full-bleed cover style and a Flowing color field background; the titanium and mesh gradient backgrounds can follow the music. Edit the layout directly on screen, and press Ctrl+B in the immersive view to open the browse panel.
- [library] **Autoplaylists** Create an autoplaylist from the current conditions on the Songs page, and edit it on the playlist page or from the sidebar context menu. The query box offers syntax coloring, completion and a syntax reference, and the Albums and playlist page search boxes accept advanced queries too.
- [search] **Online track favorites** Save NetEase tracks to a local Favorites page. Favorite buttons appear in online track tables, the player bar, page headers and menus.
- [library] **Library cache and lyrics cache** Songs, albums and the whole-library track list are read from a local cache first, and fall back to foobar2000 when the cache cannot answer. Under General > Data you can turn the cache off, see its size and rebuild it. Lyrics lookups are cached locally as well.
- [palette] **Settings and appearance** Settings shows one section at a time. The interface font, the CJK font and the lyrics fonts can be customized, including font weight. The track table adds ten optional columns, such as disc number, file name, folder and composer.
- [log] **Runtime log** About gains a runtime log that copies the version, window state and recent entries for bug reports. The startup failure page can copy it too, and entries are redacted when written.

##### Improvements and fixes

- Step 4 of the first-run guide adds an online lyrics switch and shows the local service status, with retry on failure.
- The app opens on Home at startup by default.
- Playback settings can adjust ReplayGain, DSP presets and the output buffer.
- Online tracks prefetch the next track, so switching connects faster. Online tracks also support whole-track analysis, with preload, on-demand segments or off.
- Desktop lyrics add a custom font size, a translation font size and custom multi-line animations.
- Local animated covers play in the expanded cover on the info page and in the large immersive cover.
- The right card's page entries become four buttons for Queue, Lyrics, Info and Biography, and the in-card tab bar is gone.
- Text boxes offer a context menu with Cut, Copy, Paste and Select All.
- The shortcut list gains an immersive view section.
- When the theme and foobar2000 bind the same shortcut, the theme takes priority. Desktop lyrics global shortcuts accept only combinations with Ctrl, Alt or Win.
- Space plays or pauses on ordinary pages too.
- The keyboard focus ring is no longer clipped by scroll areas, truncated rows and column headers.
- Fixed blurry text in the track table after scrolling at 125% scaling.
- Fixed artist and album bylines that do not fit: they now share the width, truncate separately and stay clickable.
- Fixed dropdowns and menus hidden behind the title bar, and long dropdowns now stay under their trigger.
- In the English interface, artists are identified and searched with English genre names, and English biographies no longer contain `<i>` markup.
- Genre tidy-up no longer splits a single genre such as R&B into several.

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
