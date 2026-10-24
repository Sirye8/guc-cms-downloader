# GUC CMS Downloader

[![Version](https://img.shields.io/badge/version-3.1.0-blue.svg)](https://github.com/Sirye8/guc-cms-downloader/releases)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Browser Support](https://img.shields.io/badge/browsers-Firefox%20%7C%20Brave%20%7C%20Chrome-orange.svg)](https://github.com/Sirye8/guc-cms-downloader)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-yellow.svg)](LICENSE)

A browser extension to improve downloading course materials from the German University in Cairo (GUC) Content Management System (CMS).

On the GUC CMS, downloaded files normally have raw server timestamps and hashes (for example `GUC_576_70_73059_2026-10-12T13_26_21.pdf`), requiring students to manually rename every single file across weekly cards. This extension automates renaming, organizes files into customizable course and week folders, and adds bulk download tools.

---

## Features (v3.1)

### Smart File Renaming
- **Clean Titles**: Strips leading index numbers (`1 - `) and keeps the proper extension (`.pdf`, `.pptx`, `.docx`, `.jpg`, etc.).
- **Preserves Full Topics**: Keeps descriptive subtitles instead of cutting everything to `Lecture 1.pdf` (for example, `Lecture 1 - Fundamentals of Layering & Node Connections.pdf`).
- **Distinguishes Materials**: Keeps distinct names for slides, notes, quizzes, and solutions in the same week (for example, `Lecture 5 Slides.pptx` vs `Lecture 5 - Example 1 Detailed Solution.pdf`).
- **Fixes Bad Characters**: Cleans illegal filesystem characters (`< > : " / \ | ? *`) and broken encoding symbols.

### Multi-Layer Folder Organization & Custom Mapping
- Automatically reads the course code and name (e.g. `NETW903 - Network and Services`) and week date.
- **Layer 1 (Main Root Folder)**: Customize the top-level folder where all subjects lie (default: `GUC CMS`, or custom like `Uni/Semester 9`, or empty for direct downloads).
- **Layer 2 (Per-Subject Mapping)**: Map each subject to a custom folder name (e.g. `NETW903` -> `Networks`), or use the auto-generated course name.
- **Layer 3 (Week Subfolders)**: Choose whether to create week subfolders, and select the format:
  - `Week N (Date)` (e.g. `Week 1 (2026-09-07)`)
  - `Week N only` (e.g. `Week 1`)
  - `Date only` (e.g. `2026-09-07`)
  - `Flat` (all subject files stored directly in the subject folder)
- **Live Path Preview**: Shows a real-time preview of the exact folder path as you adjust settings.
- **Folder Toggle**: Switch between organized folders and flat downloads with one click.

### Downloaded vs Undownloaded Filtering
- **Segmented Filter Tabs**: Filter course view between **All Files**, **Undownloaded**, and **Downloaded** with real-time counts.
- **Download Undownloaded**: One-click bulk download for only the files you have not downloaded yet.
- **Interactive Status Toggle**: Click the status badge on any card to mark or unmark it as downloaded.
- **Batch Mark Actions**: Mark or unmark all selected files in one click.
- **Persistent Memory**: Download state persists across browser sessions using local storage.

### Category Filters
Filters course materials into dedicated bulk download groups, even if the CMS tagging is inconsistent:
- **Lectures** (Slides and lecture notes)
- **Tutorials** (Tutorial notes and slides)
- **Labs & Quizzes** (Lab manuals, guides, review quizzes)
- **Sheets & Exercises** (Exercise and practice sheets)
- **Solutions** (Solution sheets and detailed solutions)
- **Assignments & Projects** (Coursework and project files)

### Checkboxes and Batch Selection
- **Item Checkboxes**: Pick specific files across weeks to download only what you need.
- **Select Week**: Check an entire week at once from the week header.
- **Batch Controls**: Quick "Select All", "Deselect All", and "Download Selected" buttons.
- **ASP.NET Form Protection**: Explicit button types prevent unwanted page reloads when making selections.

### Non-Blocking Progress UI
- Bottom-right floating progress toast card with live completion percentages and auto-fade.
- Displays live download progress and current file name without freezing the page.

### Throttled Download Queue
- Downloads sequentially with a 350ms delay between items to prevent browser download warnings or network timeouts.

---

## Browser Support & Installation

GUC CMS Downloader v3.1 runs on Manifest V3 and supports Firefox, Brave, and Google Chrome (as well as Edge and other Chromium-based browsers).

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
   - Click **Download Undownloaded** to grab all new files in one click.
   - Click **Folder Options** to configure your main folder or subject-specific folder mappings with live preview.
   - Mark or unmark files with the status toggle buttons or batch mark buttons.
4. Single downloads: clicking the regular "Download Content" button on any item will automatically use the clean name, course folder, and mark the file as downloaded.

---

## Privacy & Permissions

- Permissions used: `downloads` (to save files with custom names and folders) and `storage` (to save your folder organization and downloaded state).
- Host permission: limited to `https://cms.guc.edu.eg/*`.
- All parsing and downloads run locally inside your browser. No external tracking or telemetry.
- Open source under GPL-3.0.
