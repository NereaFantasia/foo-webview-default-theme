English | [中文](./GUIDE.zh-CN.md)

# Default Theme User Guide

Default Theme is the default theme for [foo_ui_webview2](https://github.com/NereaFantasia/foo_ui_webview2), providing a standalone window interface for foobar2000. This guide covers theme version 0.1.0.

## Installation

### Install the plugin

Requires foo_ui_webview2 **2.0.0 or later**. Older plugin versions cannot run this theme. Follow the [plugin installation guide](https://nereafantasia.github.io/foo_ui_webview2/how-to/install).

After installing the plugin, select `Webview2 UI` as the user interface in foobar2000's display preferences. The theme cannot run inside Default UI (DUI) or Columns UI (CUI) panels.

### Install the theme

1. Download `foo-webview-default-theme-0.1.0.zip` from [GitHub Releases](https://github.com/NereaFantasia/foo-webview-default-theme/releases) or the [CNB mirror](https://cnb.cool/foo-ui-webview2/default-theme/-/releases).
2. Open `File > Preferences > Display > WebView2 UI`. Use template management to create a new template for the theme, then open its folder.
3. Extract the installation package into that folder, replacing the new template's placeholder page. Keep `index.html` directly inside the template folder, not an extra subfolder.
4. Select that template in preferences, apply the settings and restart foobar2000.

Template folders are stored under `<profile>\webview-ui\<template>\`. Opening the folder from the plugin preferences helps avoid placing files in another foobar2000 installation's profile.

`fe-0.1.0.zip` is an update package, not a first-install package. GitHub's `Source code` archives are not installable themes either.

## First Launch

The setup dialog has four steps:

| Step | Contents |
| --- | --- |
| Library | Open foobar2000 preferences to add music folders |
| Appearance | Choose the player bar position, color mode and whether to follow cover colors |
| System tray | Choose whether minimizing or closing the window sends it to the tray |
| Updates and online content | Choose the update mode and whether to enable online artist biographies |

You can skip setup and change these options later in Settings. Online lyrics are enabled separately on the lyrics page, not by the online biographies switch.

## Finding Your Way Around

| Area | Common controls |
| --- | --- |
| Navigation area | Main menu, back, forward, sidebar toggle, lyrics and queue |
| Sidebar | Global search, Home, library pages, playlists and Settings |
| Right panel | Queue, lyrics, track information and artist biography |
| Player bar | Playback, progress, volume, output device, mini player and immersive view |

Navigation and right-panel controls may appear in the title bar or in a row above the content, depending on the player bar position and window width. In a narrow window, open the queue first to access the other right-panel tabs.

Mouse side buttons navigate back and forward. See **Settings > Shortcuts** for the keyboard and mouse controls.

## Browsing and Playback

Choose Albums, Artists, Genres, Songs or Folders in the sidebar, or enter keywords in the search box to search the whole library.

Right-click an album to play it next or add it to the queue. A track's context menu includes ratings, navigation to its album and commands provided by foobar2000.

To add or manage music folders, open **Settings > General > Media library folders**. This opens foobar2000's own media library preferences. After adding a folder, allow the scan to finish so its tracks can appear in the theme.

## Appearance and Player Bar

Open **Settings > Appearance**:

- **Color mode**: Follow the system, or choose Light or Dark.
- **Accent color**: Expand this section and enable **Follow the playing cover color**. When it is off, **Base accent color** supplies the color, with Default teal, Windows accent and Custom color options.
- **Window background**: Choose **Playing cover** to follow the current cover, or use Mica, Acrylic, Flowing palette or Image.
- **Player bar position**: Choose Bottom of the window, Title bar or Capsule.

Cover-based accent colors and the window background are independent. When no cover color is available, the accent uses your selected base color.

## Lyrics

### Local lyrics

Open **Lyrics** from the navigation area or select the right panel's lyrics tab. The theme reads local lyrics first, including embedded lyrics and lyrics files.

- Word-timed lyrics support word-by-word highlighting.
- Line-timed lyrics follow the current line. Translations are shown when included in the lyrics.
- Lyrics without timestamps are displayed as plain text, without playback highlighting.

### Online search

**Online lyrics** is off by default. Enable it to search automatically when no local lyrics are found.

To choose a result manually, click the magnifying-glass **Search lyrics** button at the bottom of the lyrics page. Enable online lyrics, enter keywords and select **Use lyrics** on a result. The **Search online lyrics** button shown when local lyrics are missing enables online search; it does not open the manual results list.

Online sources include NetEase Music, Kugou Music, AMLL TTML DB, LRCLIB and lrcmux. Searches use information such as the track title, artist, album and duration, not local file paths. Third-party services can see your IP address.

### Display and seeking

For timed lyrics, switch to **Full text** to see the complete lyrics. When the track supports seeking, click a line to jump to its time. This is not available for lyrics without timestamps.

Font size, AMLL / WinUI 3 / Custom motion presets and lyric processing options are under **Settings > Lyrics**.

## Immersive View

Click **Immersive view** in the player bar to show album art, spectrum, stereo field, the full-track waveform and lyrics across the window. Use Back to return.

The immersive view and right panel share the current track's lyrics, the online lyrics switch and lyric settings.

## Mini Player

Click **Mini player** in the player bar or open it from the main menu.

- **Expand album cover** switches to the cover layout; **Collapse album cover** returns to the compact layout.
- **Keep on top** keeps the mini player above other windows.
- **Return to full window** restores the main window.
- The More menu lets you change playback order and output device.

## Artist Biographies

The right panel's **Biography** tab shows artist information. Online biographies are off by default. Enable them under **Settings > Online content**; this is separate from online lyrics.

If several artists have the same name, confirm the artist when prompted. Use **Change linked artist** to correct a wrong match.

Data comes from MusicBrainz, Last.fm and its image CDN. Requests include the artist name, MusicBrainz ID or image identifier, not track titles, album names or local paths. These services can see your IP address.

A Last.fm API key is not required to read biographies from web pages. You can enter your own key in the online content settings; leaving it blank uses Last.fm web pages.

## Online Updates

Open **Settings > About** and choose an update mode:

| Mode | Behavior |
| --- | --- |
| Check manually | The default. No automatic checks; click **Check for updates**, then choose whether to download and install an available version |
| Notify only | Check automatically and notify you about new versions, without downloading them |
| Install automatically | Check, download and install new versions in the background |

A prepared update takes effect the next time foobar2000 starts. You can also click **Restart now**. The theme does not restart foobar2000 automatically and does not update foo_ui_webview2 or foobar2000 itself.

Downloads are checked using signatures and hashes. If a new version fails to confirm startup three times in a row, the next launch tries an available older version. Rollback handles startup failures; it is not triggered by ordinary interface problems or a preference for the older version.

Do not share one theme folder between multiple foobar2000 instances. Automatic updates pause when sharing is detected.

## Troubleshooting

### The plugin version is too old

Install foo_ui_webview2 2.0.0 or later and restart foobar2000. If 2.0.0 is not yet available on the plugin's release page, wait for it instead of trying to load the theme with an older version.

### A message says panels are not supported

Select `Webview2 UI` as foobar2000's standalone interface. Do not place this theme inside a DUI or CUI panel.

### Switching templates still shows the old page

Check whether the development server is enabled on the plugin's Developer preferences page. When enabled, its address takes priority over the selected template. Disable it, apply the settings and reload the theme.

### The theme will not start after an update

After three unconfirmed starts, the next launch tries other available versions. If the startup page reports that all versions failed, click **Reset startup counts and retry**.

If that does not help, extract a complete installation package into a new template folder and select it in the plugin preferences. Keep the old folder; do not delete it as a recovery step.

### foobar2000 keeps running after closing the window

Check **Close to tray** under **Settings > General > System tray**. When enabled, closing the window does not exit the player.

### Lyrics are missing or do not highlight word by word

Check that local lyrics can be read. If none are available, enable **Online lyrics** or search manually for another result. Word-by-word highlighting requires word timestamps; line-timed or plain-text lyrics cannot provide the same effect.
