# FixYouTube

A crude Chromium extension for making some tweaks to YouTube.

Optional/Configurable:
- Automatically play all videos at 2x speed by default.
- Automatically play all videos at a specific quality/resolution by default.
- Implement the _Return YouTube Dislike_ API to show an estimated dislike count.
- Force the use of standard frame rates (24, 25, or 30fps) instead of high frame rates (48, 50, or 60fps). This will often result in the available resolutions being limited to 720p and below.
- Increase the number of video cards to 4, 5, or 6 per row in grid-based views.

Not Optional/Configurable:
- Disables autoplay and hides the control.
- Automatically loads videos in "Theater Mode."
- Hides the video player's "Settings" menu, replacing it with the "Playback Speed" and "Quality/Resolution" menus, implemented separately. All other options from the "Settings" menu are hidden.
- Removes the "Pull up for precise seeking" feature.
- Hides the "action" button panel that sits atop the regular controls in the fullscreen video player.
- Removes the miniplayer.
- Removes video overlays (info cards, end screens, etc.).
- Hides the "action" buttons that appear atop video cards on hover.
- Hides all left sidebar sections except for "Subscriptions" and "You."
- Hides all shorts.
- Automatically loads channels to the "Videos" tab.
- Reduces the ridiculous size of thumbnails to fit more of the title in cards/rows.
- Moves all of the "action" buttons that trail the "Like"/"Dislike" buttons (except the "Save to Playlist" button) into the ellipsis overflow menu.
- Hides the filter chips above the recommended videos column.
- Hides channel banners.
- Hides the "New" badge from thumbnails.
- Hides the "Search by Voice" button.

## Installation

Unzip the extension and place the folder somewhere permanent. Navigate to chrome://extensions, enable the "Developer Mode" toggle, click the "Load Unpacked" button, and select the FixYouTube folder in the filesystem dialog.

## Support

If you find a bug, please report it here on GitHub and I will try to fix it. Please be as thorough in your reporting as you can.

You're welcome to request features or changes if you're so-inclined, and I will give such requests due consideration, but just know that this extension was built first and foremost for an audience of one and I consider it feature-complete at this time.

FixYouTube is available in English only, by design.

## Note

I am not a software engineer; all of the code for this project was written by Anthropic's Claude models. That said, I use all of the applications under this account regularly in my daily life, so while they're not perfect, I'm confident in their efficacy and general reliability.

## License

FixYouTube is free software, licensed under the GNU General Public License, version 3 only (GPL-3.0-only). Copyright © 2026 avenged110. The full license text is in `COPYING`.
