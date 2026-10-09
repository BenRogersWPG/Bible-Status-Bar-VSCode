# Bible Verse Status Bar

This extension adds a configurable status bar item that shows a Bible verse and exposes the full verse in a tooltip.

## Features

- Displays a Bible verse in the VS Code status bar.
- Shows the full verse in the tooltip when you hover over the status bar item.
- Supports settings for:
  - `bibleVerse.displayFullVerse` (default: `true`)
  - `bibleVerse.statusBarWidth` (default: `200`)
  - `bibleVerse.shrinkToFit` (default: `true`), which avoids reserving unused space when a verse is shorter than the configured width. The width still limits long verses.
  - `bibleVerse.clickAction` (default: `showVerse`): choose between displaying the full verse in a notification or showing a new random verse when the status bar item is clicked.
  - `bibleVerse.refreshMode` (default: `onVSCodeOpen`): choose whether the verse changes only when VS Code opens or periodically on a schedule.
  - `bibleVerse.refreshFrequency` (default: `60`): minutes between scheduled changes; used only when `bibleVerse.refreshMode` is `schedule`.
  - `bibleVerse.randomOrSequential` (default: `random`)
  - `bibleVerse.bibleId` (default: `3034`, Berean Standard Bible): enter a YouVersion Bible ID from the [YouVersion API documentation](https://developers.youversion.com/docs). If the ID is invalid or unavailable, the extension tries Bible ID `3034` (Berean Standard Bible) before using bundled sample verses.
  - `bibleVerse.showBibleVersionInTooltip` (default: `true`): include the Bible version abbreviation in parentheses after the verse reference in the status bar hover tooltip.

## Configuration

Open Settings and search for `Bible Verse Status Bar` to change the behavior.

Run the command `Bible Verse: Store YouVersion App Key` from the Command Palette to save your YouVersion app key securely in VS Code. If the key is empty or the request fails, the extension falls back to the bundled sample verses.

## Notes

The extension now uses the YouVersion Bible API when an app key is provided, and it will fall back to the bundled verses otherwise.

## VS Code API

### `vscode` module

- [`window.createStatusBarItem`](https://code.visualstudio.com/api/references/vscode-api#window.createStatusBarItem)
