# GUC CMS Downloader

[![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)](https://github.com/Sirye8/guc-cms-downloader/releases)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Browser Support](https://img.shields.io/badge/browsers-Firefox%20%7C%20Brave%20%7C%20Chrome-orange.svg)](https://github.com/Sirye8/guc-cms-downloader)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-yellow.svg)](LICENSE)

A browser extension to improve downloading course materials from the German University in Cairo (GUC) Content Management System (CMS).

On the GUC CMS, downloaded files normally have raw server timestamps and hashes (for example `GUC_576_70_73059_2026-10-12T13_26_21.pdf`), requiring students to manually rename every single file across weekly cards. This extension automates renaming, organizes files into course and week folders, and adds bulk download tools.

---

## Features (v3.0)

### Smart File Renaming
- **Clean Titles**: Strips leading index numbers (`1 - `) and keeps the proper extension (`.pdf`, `.pptx`, `.docx`, `.jpg`, etc.).
- **Preserves Full Topics**: Keeps descriptive subtitles instead of cutting everything to `Lecture 1.pdf` (for example, `Lecture 1 - Fundamentals of Layering & Node Connections.pdf`).
- **Distinguishes Materials**: Keeps distinct names for slides, notes, quizzes, and solutions in the same week (for example, `Lecture 5 Slides.pptx` vs `Lecture 5 - Example 1 Detailed Solution.pdf`).
- **Fixes Bad Characters**: Cleans illegal filesystem characters (`< > : " / \ | ? *`) and broken encoding symbols.

### Automatic Folder Hierarchy
- Automatically reads the course code and name (e.g. `NETW903 - Network and Services`) and week date.
- Saves files into organized subdirectories inside your Downloads folder:
  ```text
  Downloads/
  └── GUC CMS/
      ├── NETW903 - Network and Services/
      │   ├── Week 1 (2026-09-07)/
      │   │   ├── Lecture 1 - Network and Services Introduction.pdf
      │   │   └── NETW903 Assessment Workload Distribution.jpg
      │   └── Week 6 (2026-10-12)/
      │       ├── Lecture 6 - RESTful Web Services.pdf
      │       └── Assignment 2.pdf
      └── NETW904 - Linear and Non-Linear Optimization/
          └── Week 5 (2026-10-13)/
              ├── Sheet 5 - Dual Simplex and Post Optimal Analysis.pdf
              └── Sheet 5 Solutions.pdf
  ```
- **Folder Toggle**: A checkbox in the top control panel allows switching between organized folders and flat downloads at any time.

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

### Non-Blocking Progress UI
- Replaced blocking alert dialogs with a bottom-right toast card.
- Displays live download progress and current file name without freezing the page.
- In-session badges mark items that have already been downloaded.

### Throttled Download Queue
- Downloads sequentially with a 350ms delay between items to prevent browser download warnings or network timeouts.

---

## Browser Support & Installation

GUC CMS Downloader v3 runs on Manifest V3 and supports Firefox, Brave, and Google Chrome (as well as Edge and other Chromium-based browsers).

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
3. The control panel will appear above the weeks with buttons to download all files, download selected files, or download by category.
4. Single downloads: clicking the regular "Download Content" button on any item will also automatically use the clean name and course folder.

---

## Privacy & Permissions

- Permissions used: `downloads` (to save files with custom names and folders) and `storage` (to save your folder organization preference).
- Host permission: limited to `https://cms.guc.edu.eg/*`.
- All parsing and downloads run locally inside your browser. No external tracking or telemetry.
- Open source under GPL-3.0.
