# GUC CMS Downloader

[![Version](https://img.shields.io/badge/version-3.3.0-blue.svg)](https://github.com/Sirye8/guc-cms-downloader/releases)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Browser Support](https://img.shields.io/badge/browsers-Firefox%20%7C%20Brave%20%7C%20Chrome-orange.svg)](https://github.com/Sirye8/guc-cms-downloader)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-yellow.svg)](LICENSE)

A browser extension to improve downloading course materials from the German University in Cairo (GUC) Content Management System (CMS).

On the GUC CMS, downloaded files normally have raw server timestamps and hashes (for example `GUC_576_70_73059_2026-10-12T13_26_21.pdf`), requiring students to manually rename every single file across weekly cards. This extension automates renaming, organizes files into customizable course and week folders, and adds bulk download tools.

---

## Features (v3.3)

### Expanding Accordion Drawers
The top bar features three collapsible drawers that open smoothly without cluttering the page:
- **Folders Drawer**: Configure multi-layer folder organization, set a root folder (e.g. `GUC CMS`), map each subject to a custom folder name, enable week subfolders, and check the live path preview.
- **Settings Drawer**: Complete control over extension behavior:
  - Download queue throttle delay (customizable ms between downloads).
  - File conflict handling (uniquify, overwrite, prompt).
  - Default view on page load (All Files vs Undownloaded).
  - Toggle auto-mark as downloaded on download.
  - Toggle visual card selection highlight.
  - Toggle floating toast notifications.
  - Clear download history or reset settings to default.
- **Info Drawer**: Displays the version number, overview of what the extension does, how it works, quick tips, and credits.

### Flat Downloads by Default
- "Organize into subfolders" and "Create week folders" are **off by default**, saving files straight into your default Downloads folder with clean, topic-preserving titles.
- When enabled, files can be organized into your choice of root folders, course folders, and week subfolders.

### Unified Selection & Batch Toolbar
- **Relocated Select All & Deselect All**: Moved directly into the selection actions toolbar right next to the view tabs.
- **Select All Visible**: Selects all currently visible files according to active category and status filters.
- **Deselect All**: Clears all current selections in one click.
- **Batch Mark Actions**: Mark or unmark all selected files as downloaded.

### Clean Action Row Selection
- **Select Button on Action Row**: Sits right next to the Mark Downloaded button on each card, removing awkward checkboxes above file titles.
- **Visual Card Highlighting**: Selected items receive an active border and soft blue card highlight (can be toggled in Settings).
- **Week Selector**: Injected into each week header opposite the title to select or download entire weeks.

### Category Visibility Filters (On/Off Toggles)
- Toggle any category on or off to dynamically show or hide materials as needed:
  - **Lectures**
  - **Tutorials**
  - **Labs & Quizzes**
  - **Sheets & Exercises**
  - **Solutions** (Solution sheets, detailed solutions, model answers)
  - **Assignments** (Course assignments and in-lab submissions)
  - **Projects** (Course projects and project specifications, cleanly separated from assignments)
  - **Other** (Supplementary notes and research articles)
- **Quick Controls**: Includes "Show All" and "Hide All" category toggles.
- **Download Visible**: Dedicated button to download only the currently visible files matching your active filters.

### Downloaded vs Undownloaded Filtering
- **Segmented Filter Tabs**: Filter course view between **All Files**, **Undownloaded**, and **Downloaded** with real-time counts.
- **Download Undownloaded**: One-click bulk download for only the files you have not downloaded yet.
- **Interactive Status Toggle**: Click the status button on any card to mark or unmark it as downloaded.
- **Persistent Memory**: Download state persists across browser sessions using local storage.

### Smart File Renaming
- **Clean Titles**: Strips leading index numbers (`1 - `) and keeps the proper extension (`.pdf`, `.pptx`, `.docx`, `.xlsx`, `.zip`, `.rar`, etc.).
- **Preserves Full Topics**: Keeps descriptive subtitles instead of cutting everything to `Lecture 1.pdf` (for example, `Lecture 1 - Fundamentals of Layering & Node Connections.pdf`).
- **Distinguishes Materials**: Keeps distinct names for slides, notes, quizzes, and solutions in the same week (for example, `Lecture 5 Slides.pptx` vs `Lecture 5 - Example 1 Detailed Solution.pdf`).
- **Fixes Bad Characters**: Cleans illegal filesystem characters (`< > : " / \ | ? *`) and broken encoding symbols.

### Non-Blocking Progress UI
- Bottom-right floating progress toast card with live completion percentages and auto-fade.
- Displays live download progress and current file name without freezing the page.
- Downloads sequentially with a customizable throttle delay to prevent browser download warnings or network rate limits.

---

## Browser Support & Installation

GUC CMS Downloader v3.3 runs on Manifest V3 and supports Firefox, Brave, and Google Chrome (as well as Edge and other Chromium-based browsers).

### Mozilla Firefox

#### Option 1: File Installation
1. Download `guc-cms-downloader.xpi` from the [Releases](https://github.com/Sirye8/guc-cms-downloader/releases/latest) page.
2. In Firefox, open `about:addons` (or press `Ctrl+Shift+A`).
3. Click the gear icon in the top right.
4. Click **Install Add-on From File...**.
5. Select `guc-cms-downloader.xpi` and confirm.

#### Option 2: Temporary Load (for Development)
1. Clone or download this repo.
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**.
4. Select `manifest.json` inside the repository.

---

### Brave Browser

1. Download `guc-cms-downloader.zip` from [Releases](https://github.com/Sirye8/guc-cms-downloader/releases/latest) and unzip it.
2. Open Brave and go to `brave://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** (top-left button).
5. Select the unzipped folder containing `manifest.json`.

---

### Google Chrome & Other Chromium Browsers (Edge, Opera, etc.)

1. Download `guc-cms-downloader.zip` from [Releases](https://github.com/Sirye8/guc-cms-downloader/releases/latest) and unzip it.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the unzipped folder containing `manifest.json`.

---

## How to Use

1. Log into the GUC CMS: `https://cms.guc.edu.eg`
2. Open any course page (`CourseViewStn`).
3. The control panel will appear above the weeks:
   - Use the **All / Undownloaded / Downloaded** tabs to view only the files you need.
   - Use the **Category Visibility Filters** to show or hide lectures, tutorials, assignments, projects, sheets, or solutions.
   - Use the **Select All / Deselect All** and **Mark Selected / Unmark Selected** tools in the selection toolbar.
   - Click **Download Undownloaded** or **Download Visible** to grab your filtered files in one click.
   - Click **Folders** to configure course and week folder organization with live preview.
   - Click **Settings** to adjust queue delays, default views, and notification preferences.
   - Click **Info** to view version information, instructions, and tips.
4. Single downloads: clicking the regular "Download Content" button on any item will automatically use the clean name and update download status.

---

## Privacy & Permissions

- Permissions used: `downloads` (to save files with custom names and folders) and `storage` (to save your folder organization and downloaded state).
- Host permission: limited to `https://cms.guc.edu.eg/*`.
- All parsing and downloads run locally inside your browser. No external tracking or telemetry.
- Open source under GPL-3.0.
