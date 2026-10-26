// content_script.js
// GUC CMS Downloader v3.3.0
console.log("GUC CMS Downloader content script loaded");

const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);

// --- Storage Keys ---
const STORAGE_KEY_DOWNLOADED = 'guc_cms_downloaded_items_v2';
const STORAGE_KEY_FOLDER_SETTINGS = 'guc_cms_folder_settings_v3';
const STORAGE_KEY_GENERAL_SETTINGS = 'guc_cms_general_settings_v1';
const STORAGE_KEY_CATEGORY_FILTERS = 'guc_cms_category_filters_v2';

// --- Folder Organization Settings ---
function getDefaultFolderSettings() {
  return {
    enabled: false,
    mainFolder: "GUC CMS",
    includeWeekFolders: false,
    weekFormat: "week_and_date", // "week_and_date", "week_only", "date_only", "none"
    subjectMappings: {} // courseCode -> custom folder name
  };
}

function getFolderSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FOLDER_SETTINGS);
    if (raw) {
      return Object.assign(getDefaultFolderSettings(), JSON.parse(raw));
    }
    // Check if there are subjectMappings from v2 to migrate cleanly
    const legacyRaw = localStorage.getItem('guc_cms_folder_settings_v2');
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      const migrated = getDefaultFolderSettings();
      if (legacy.subjectMappings) migrated.subjectMappings = legacy.subjectMappings;
      if (legacy.mainFolder) migrated.mainFolder = legacy.mainFolder;
      // enabled and includeWeekFolders remain false per user instruction
      saveFolderSettings(migrated);
      return migrated;
    }
    return getDefaultFolderSettings();
  } catch (e) {
    return getDefaultFolderSettings();
  }
}

function saveFolderSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY_FOLDER_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error("GUC CMS Downloader: Failed to save folder settings", e);
  }
}

// --- General Extension Settings ---
function getDefaultGeneralSettings() {
  return {
    downloadDelayMs: 350,
    conflictAction: 'uniquify', // 'uniquify' | 'overwrite' | 'prompt'
    autoMarkDownloaded: true,
    highlightSelectedCards: true,
    showToasts: true,
    defaultView: 'all' // 'all' | 'undownloaded'
  };
}

function getGeneralSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GENERAL_SETTINGS);
    if (!raw) return getDefaultGeneralSettings();
    return Object.assign(getDefaultGeneralSettings(), JSON.parse(raw));
  } catch (e) {
    return getDefaultGeneralSettings();
  }
}

function saveGeneralSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY_GENERAL_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error("GUC CMS Downloader: Failed to save general settings", e);
  }
}

// --- Download State Tracking ---
function getDownloadedMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DOWNLOADED);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function isItemDownloaded(url) {
  if (!url) return false;
  const map = getDownloadedMap();
  return Boolean(map[url]);
}

function setItemDownloaded(url, isDownloaded, filename) {
  if (!url) return;
  const map = getDownloadedMap();
  if (isDownloaded) {
    map[url] = {
      downloadedAt: Date.now(),
      filename: filename || ""
    };
  } else {
    delete map[url];
  }
  try {
    localStorage.setItem(STORAGE_KEY_DOWNLOADED, JSON.stringify(map));
  } catch (e) {
    console.error("GUC CMS Downloader: Failed to update download state", e);
  }
}

// --- Sanitization & Path Helpers ---
function sanitizeFilename(name) {
  if (!name) return "";
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizePath(pathStr) {
  if (!pathStr) return "";
  return pathStr
    .split('/')
    .map(segment => segment.replace(/[<>:"/\\|?*]/g, '_').trim())
    .filter(Boolean)
    .join('/');
}

function cleanTitle(rawTitle) {
  if (!rawTitle) return "Content";

  // 1. Remove leading numbering (e.g., "1 - ", "02. ", "3: ")
  let title = rawTitle.replace(/^\d+\s*[-.:)]\s*/, '').trim();

  // 2. Replace unicode replacement char or funky dashes/colons/pipes
  title = title
    .replace(/[\uFFFD\u0096\u0097\u2013\u2014]/g, ' - ')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/\s*;\s*/g, ' - ')
    .replace(/\s*\|\s*/g, ' - ')
    .replace(/\s*_\s*/g, ' - ');

  // 3. Separate words glued to digits (e.g., "Lecture5" -> "Lecture 5", "Sheet1" -> "Sheet 1")
  title = title.replace(/\b(Lecture|Lectures|Tutorial|Tutorials|Sheet|Sheets|Lab|Labs|Quiz|Quizzes|Assignment|Assignments|Example|Project|Exam)(\d+)\b/gi, '$1 $2');

  // 4. Fix numbers glued together with ampersand like "9&10" -> "9 & 10"
  title = title.replace(/(\d+)&(\d+)/g, '$1 & $2');

  // 5. Expand PascalCase like "Example1DetailedSolution"
  title = title.replace(/([a-z])([A-Z])/g, '$1 $2');
  title = title.replace(/(\d+)([A-Za-z])/g, '$1 $2');

  // 6. Normalize spaced hyphens (leave intra-word hyphens like In-lab untouched)
  title = title.replace(/\s+-\s*|\s*-\s+/g, ' - ');
  title = title.replace(/(\s*-\s*)+/g, ' - ');

  // 7. Clean up multiple spaces
  title = title.replace(/\s+/g, ' ').trim();

  return title.replace(/^[-\s._]+|[-\s._]+$/g, '');
}

function generateCleanFilename(rawTitle, itemType, downloadUrl) {
  let baseTitle = cleanTitle(rawTitle);
  if (!baseTitle) baseTitle = "Document";

  const urlPath = (downloadUrl || "").split('?')[0];
  const lastSlash = urlPath.lastIndexOf('/');
  const serverFilename = lastSlash !== -1 ? urlPath.substring(lastSlash + 1) : urlPath;
  const lastDot = serverFilename.lastIndexOf('.');

  let extension = lastDot !== -1 ? serverFilename.substring(lastDot).toLowerCase() : "";

  // Fallbacks if no valid extension
  if (!extension || extension === ".file" || extension.length > 5) {
    const it = (itemType || "").toLowerCase();
    const bt = baseTitle.toLowerCase();
    if (it.includes('project') || it.includes('assignment') || it.includes('sheet') || it.includes('exercise')) {
      extension = ".pdf";
    } else if (it.includes('lecture') || it.includes('tutorial')) {
      if (urlPath.toLowerCase().includes('.pptx')) extension = ".pptx";
      else if (urlPath.toLowerCase().includes('.ppt')) extension = ".ppt";
      else extension = ".pdf";
    } else {
      extension = ".pdf";
    }
  }

  const sanitized = sanitizeFilename(baseTitle);
  const maxBaseLen = 200 - extension.length;
  const finalBase = sanitized.length > maxBaseLen ? sanitized.substring(0, maxBaseLen).trim() : sanitized;

  return `${finalBase}${extension}`;
}

function getAbsoluteUrl(hrefOrDataUrl) {
  if (!hrefOrDataUrl) return null;
  if (hrefOrDataUrl.startsWith('http://') || hrefOrDataUrl.startsWith('https://')) {
    return hrefOrDataUrl;
  }
  if (hrefOrDataUrl.startsWith('/')) {
    return `https://cms.guc.edu.eg${hrefOrDataUrl}`;
  }
  return `https://cms.guc.edu.eg/${hrefOrDataUrl}`;
}

// --- Category Classification Engine ---
function isSolutionItem(title, itemType) {
  const t = (title || "").toLowerCase();
  const it = (itemType || "").toLowerCase();
  return (
    t.includes('solution') ||
    t.includes('detailedsolution') ||
    t.includes('model answer') ||
    it.includes('solution') ||
    it.includes('model answer') ||
    it.includes('quiz solution') ||
    it.includes('exam solution')
  );
}

function classifyItemCategory(title, itemType) {
  const t = (title || "").toLowerCase();
  const it = (itemType || "").toLowerCase();

  // 1. Solution (takes precedence over sheet, lecture, or quiz)
  if (isSolutionItem(t, it)) {
    return "Solutions";
  }

  // 2. Projects (explicitly separated from Assignments)
  if (it.includes('project') || t.includes('project')) {
    return "Projects";
  }

  // 3. Assignments
  if ((it.includes('assignment') || t.includes('assignment') || t.includes('in-lab')) &&
      !t.startsWith('lecture') && !t.startsWith('tutorial')) {
    return "Assignments";
  }

  // 4. Lectures
  if ((it.includes('lecture') || t.startsWith('lecture') || t.startsWith('lectures')) &&
      !t.includes('lab') && !t.includes('tutorial')) {
    return "Lectures";
  }

  // 5. Tutorials
  if (it.includes('tutorial') || t.startsWith('tutorial') || t.includes('tut ')) {
    return "Tutorials";
  }

  // 6. Labs & Quizzes
  if (it.includes('lab') || t.includes('lab') || t.includes('quiz') || t.includes('vm installation')) {
    return "Labs & Quizzes";
  }

  // 7. Sheets & Exercises
  if (t.includes('sheet') || it.includes('sheet') || it.includes('exercise') || t.includes('exercise')) {
    return "Sheets & Exercises";
  }

  // 8. Other (research papers, workload distributions, schedules, etc.)
  return "Other";
}

// --- Course & Week Metadata Extraction ---
function extractCourseMetadata() {
  const courseLabel = document.getElementById('ContentPlaceHolderright_ContentPlaceHoldercontent_LabelCourseName');
  const seasonLabel = document.getElementById('ContentPlaceHolderright_ContentPlaceHoldercontent_LabelseasonName');

  let courseCode = "";
  let courseName = "";
  let season = "";

  if (courseLabel && courseLabel.textContent) {
    const rawCourse = courseLabel.textContent.trim();
    const match = rawCourse.match(/\(\|([A-Z0-9]+)\|\)\s*([^(]+)/i);
    if (match) {
      courseCode = match[1].trim();
      courseName = match[2].trim();
    } else {
      courseName = rawCourse.replace(/[()|]/g, '').trim();
    }
  }

  if (seasonLabel && seasonLabel.textContent) {
    season = seasonLabel.textContent.trim();
  }

  let defaultFolderName = "";
  if (courseCode && courseName) {
    defaultFolderName = `${courseCode} - ${courseName}`;
  } else if (courseName) {
    defaultFolderName = courseName;
  } else {
    defaultFolderName = "Course Materials";
  }

  return {
    courseCode: courseCode || "COURSE",
    courseName: courseName || "Course Materials",
    season: season,
    defaultFolder: sanitizeFilename(defaultFolderName)
  };
}

function extractWeekFolder(weekBlock, weekIndex) {
  const weekHeader = weekBlock.querySelector('div.card-header h2.text-big');
  let dateText = "";
  let weekTitle = `Week ${weekIndex + 1}`;
  if (weekHeader && weekHeader.textContent) {
    dateText = weekHeader.textContent.replace(/^Week:\s*/i, '').trim();
    if (dateText) {
      weekTitle = `Week ${weekIndex + 1} (${dateText})`;
    }
  }
  return {
    weekTitle: sanitizeFilename(weekTitle),
    weekDate: sanitizeFilename(dateText),
    weekNumber: weekIndex + 1
  };
}

// --- Build Final Relative Download Path ---
function buildDownloadPath(item) {
  const settings = getFolderSettings();
  if (!settings.enabled) {
    return item.filename;
  }

  const parts = [];

  // Layer 1: Main Root Folder (if specified)
  const mainFolder = sanitizePath(settings.mainFolder);
  if (mainFolder) {
    parts.push(mainFolder);
  }

  // Layer 2: Subject/Course Folder
  const courseKey = item.courseCode || item.courseName || "General";
  let subjectFolder = "";
  if (settings.subjectMappings && settings.subjectMappings[courseKey]) {
    subjectFolder = settings.subjectMappings[courseKey].trim();
  } else {
    subjectFolder = item.courseDefaultFolder || courseKey;
  }
  subjectFolder = sanitizeFilename(subjectFolder);
  if (subjectFolder) {
    parts.push(subjectFolder);
  }

  // Layer 3: Week Subfolder (if enabled)
  if (settings.includeWeekFolders) {
    let weekFolder = "";
    if (settings.weekFormat === "week_only") {
      weekFolder = `Week ${item.weekNumber}`;
    } else if (settings.weekFormat === "date_only") {
      weekFolder = item.weekDate || `Week ${item.weekNumber}`;
    } else if (settings.weekFormat === "none") {
      weekFolder = "";
    } else {
      weekFolder = item.weekTitle || `Week ${item.weekNumber}`;
    }

    weekFolder = sanitizeFilename(weekFolder);
    if (weekFolder) {
      parts.push(weekFolder);
    }
  }

  parts.push(item.filename);
  return parts.join('/');
}

// --- Item Details Extraction ---
function extractItemDetails(itemElement, weekInfo, courseMeta) {
  const titleDiv = itemElement.querySelector('div[id^="content"]');
  const downloadButtonAnchor = itemElement.querySelector('a.btn.btn-primary.contentbtn[id="download"]');
  const watchVideoButtonInput = itemElement.querySelector('input.btn.btn-primary.vodbutton.contentbtn[value="Watch Video"]');

  if (!titleDiv) return null;

  // VoD check (ignored per instructions)
  let isLikelyVoD = false;
  if (watchVideoButtonInput && getComputedStyle(watchVideoButtonInput).display !== 'none') {
    isLikelyVoD = true;
  }
  if (downloadButtonAnchor && getComputedStyle(downloadButtonAnchor).display === 'none' && watchVideoButtonInput) {
    isLikelyVoD = true;
  }

  let itemType = "";
  let rawTitleFromStrong = "";
  const strongTag = titleDiv.querySelector('strong');

  if (strongTag) {
    rawTitleFromStrong = strongTag.textContent.trim();
    let currentNode = strongTag.nextSibling;
    while (currentNode) {
      if (currentNode.nodeType === Node.TEXT_NODE && currentNode.textContent.trim() !== "") {
        const typeMatch = currentNode.textContent.trim().match(/\(([^)]+)\)/);
        if (typeMatch && typeMatch[1]) {
          itemType = typeMatch[1].toLowerCase().trim();
        }
        break;
      }
      currentNode = currentNode.nextSibling;
    }
  } else {
    rawTitleFromStrong = titleDiv.textContent.trim();
  }

  if (itemType.includes("vod")) {
    isLikelyVoD = true;
  }

  if (isLikelyVoD) {
    return null; // Skip VoD items
  }

  if (!downloadButtonAnchor || getComputedStyle(downloadButtonAnchor).display === 'none' || !downloadButtonAnchor.hasAttribute('href')) {
    return null;
  }

  const downloadUrl = getAbsoluteUrl(downloadButtonAnchor.getAttribute('href'));
  if (!downloadUrl) return null;

  const cleanFileBase = generateCleanFilename(rawTitleFromStrong, itemType, downloadUrl);
  const cleanedTitleForFilter = cleanTitle(rawTitleFromStrong).toLowerCase();
  const category = classifyItemCategory(cleanedTitleForFilter, itemType);

  return {
    rawTitle: rawTitleFromStrong,
    cleanedTitleForFilter: cleanedTitleForFilter,
    itemType: itemType,
    category: category,
    url: downloadUrl,
    filename: cleanFileBase,
    courseCode: courseMeta.courseCode,
    courseName: courseMeta.courseName,
    courseDefaultFolder: courseMeta.defaultFolder,
    weekTitle: weekInfo.weekTitle,
    weekDate: weekInfo.weekDate,
    weekNumber: weekInfo.weekNumber,
    domElements: {
      downloadButtonAnchor: downloadButtonAnchor,
      itemRowElement: itemElement,
      titleDiv: titleDiv
    }
  };
}

// --- Modern Non-blocking Toast Notification UI ---
function showToast(title, message, progress = null, isSuccess = false, isError = false) {
  const genSettings = getGeneralSettings();
  if (!genSettings.showToasts && !isError) {
    return;
  }

  let toastContainer = document.getElementById('guc-cms-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'guc-cms-toast-container';
    toastContainer.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 9999999; width: 350px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; pointer-events: none;';
    document.body.appendChild(toastContainer);
  }

  let toast = document.getElementById('guc-cms-active-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'guc-cms-active-toast';
    toast.style.cssText = 'background: #ffffff; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.18); border-left: 5px solid #2563eb; overflow: hidden; padding: 14px 16px; margin-top: 10px; transition: all 0.25s ease; pointer-events: auto;';
    toastContainer.appendChild(toast);
  }

  if (isSuccess) {
    toast.style.borderLeftColor = '#16a34a';
  } else if (isError) {
    toast.style.borderLeftColor = '#dc2626';
  } else {
    toast.style.borderLeftColor = '#2563eb';
  }

  let progressBarHtml = '';
  if (progress !== null && typeof progress === 'number') {
    progressBarHtml = `
      <div style="background: #e2e8f0; border-radius: 4px; height: 6px; width: 100%; margin-top: 10px; overflow: hidden;">
        <div style="background: #2563eb; height: 100%; width: ${Math.min(100, Math.max(0, progress))}%; transition: width 0.2s ease;"></div>
      </div>
    `;
  }

  toast.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
      <strong style="color: #0f172a; font-size: 14px; font-weight: 600;">${title}</strong>
      <button type="button" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #64748b; line-height: 1; padding: 0 0 0 8px;" id="guc-toast-close">&times;</button>
    </div>
    <div style="font-size: 13px; color: #334155; margin-top: 5px; word-break: break-word;">${message}</div>
    ${progressBarHtml}
  `;

  const closeBtn = toast.querySelector('#guc-toast-close');
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.preventDefault();
      toast.remove();
    };
  }

  if (isSuccess || isError) {
    setTimeout(() => {
      if (toast && toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
      }
    }, 4000);
  }
}

// Listen to download progress from background script
if (browserAPI && browserAPI.runtime && browserAPI.runtime.onMessage) {
  browserAPI.runtime.onMessage.addListener((message) => {
    if (message.action === "downloadProgress") {
      const pct = Math.round((message.current / message.total) * 100);
      if (message.done) {
        showToast(
          "Download Complete",
          `Successfully queued all ${message.total} files.`,
          100,
          true,
          false
        );
      } else {
        showToast(
          `Downloading (${message.current}/${message.total})`,
          `${message.filename}`,
          pct,
          false,
          false
        );
      }
    }
  });
}

// --- Single & Bulk Download Handlers ---
async function requestSingleDownload(item) {
  const genSettings = getGeneralSettings();
  const finalPath = buildDownloadPath(item);
  showToast("Starting Download", item.filename, null, false, false);

  if (genSettings.autoMarkDownloaded) {
    setItemDownloaded(item.url, true, item.filename);
    updateItemCardButtons(item);
    refreshFilterCountsAndViews();
  }

  try {
    const response = await browserAPI.runtime.sendMessage({
      action: "downloadFile",
      url: item.url,
      filename: finalPath,
      displayName: item.filename,
      conflictAction: genSettings.conflictAction || 'uniquify'
    });
    if (response && response.success) {
      showToast("Download Started", item.filename, null, true, false);
    } else {
      showToast("Download Failed", response ? response.error : "Unknown error", null, false, true);
    }
  } catch (err) {
    console.error("Error triggering download:", err);
    showToast("Download Error", err.message, null, false, true);
  }
}

async function requestBulkDownload(items, description) {
  if (!items || items.length === 0) {
    showToast("No Files", `No files to download for: ${description}`, null, false, true);
    return;
  }

  const genSettings = getGeneralSettings();

  if (genSettings.autoMarkDownloaded) {
    items.forEach(it => {
      setItemDownloaded(it.url, true, it.filename);
      updateItemCardButtons(it);
    });
    refreshFilterCountsAndViews();
  }

  showToast(
    `Bulk Download Started`,
    `Queuing ${items.length} files for ${description}...`,
    0,
    false,
    false
  );

  const payload = items.map(it => ({
    url: it.url,
    filename: buildDownloadPath(it),
    displayName: it.filename,
    conflictAction: genSettings.conflictAction || 'uniquify'
  }));

  try {
    const response = await browserAPI.runtime.sendMessage({
      action: "bulkDownloadFiles",
      items: payload,
      description: description,
      delayMs: genSettings.downloadDelayMs
    });
    if (!response || !response.success) {
      showToast("Download Failed", "Could not start bulk download.", null, false, true);
    }
  } catch (err) {
    console.error("Error sending bulk download message:", err);
    showToast("Download Error", err.message, null, false, true);
  }
}

// --- Card Buttons: Select Button & Download Status Toggle ---
// Injects the Select button right on the action row to the left of Mark Downloaded
function updateItemCardButtons(item) {
  const row = item.domElements.itemRowElement;
  if (!row) return;

  const dlAnchor = item.domElements.downloadButtonAnchor;
  if (!dlAnchor || !dlAnchor.parentNode) return;
  const parentContainer = dlAnchor.parentNode;
  const genSettings = getGeneralSettings();

  // 1. Select File Button (placed on the action row)
  let selectBtn = parentContainer.querySelector('.guc-select-toggle-btn');
  if (!selectBtn) {
    selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'btn btn-sm guc-select-toggle-btn ml-2';
    selectBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isCurrentlySelected = selectedItemUrls.has(item.url);
      if (isCurrentlySelected) {
        selectedItemUrls.delete(item.url);
        row.classList.remove('guc-item-card-selected');
      } else {
        selectedItemUrls.add(item.url);
        if (getGeneralSettings().highlightSelectedCards) {
          row.classList.add('guc-item-card-selected');
        }
      }
      updateItemCardButtons(item);
      updateSelectedCountUI();
      updateAllWeekSelectButtons();
    });
    parentContainer.appendChild(selectBtn);
  }

  const isSelected = selectedItemUrls.has(item.url);
  if (isSelected) {
    selectBtn.className = 'btn btn-sm btn-primary guc-select-toggle-btn ml-2';
    selectBtn.innerHTML = '<i class="fa fa-check-square mr-1"></i> Selected';
    selectBtn.title = 'Click to deselect';
    if (genSettings.highlightSelectedCards) {
      row.classList.add('guc-item-card-selected');
    } else {
      row.classList.remove('guc-item-card-selected');
    }
  } else {
    selectBtn.className = 'btn btn-sm btn-outline-secondary guc-select-toggle-btn ml-2';
    selectBtn.innerHTML = '<i class="fa fa-square-o mr-1"></i> Select';
    selectBtn.title = 'Select this file';
    row.classList.remove('guc-item-card-selected');
  }

  // 2. Download Status Toggle Button (placed to the right of Select)
  let statusBtn = parentContainer.querySelector('.guc-status-toggle-btn');
  if (!statusBtn) {
    statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.className = 'btn btn-sm guc-status-toggle-btn ml-2';
    statusBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const currentStatus = isItemDownloaded(item.url);
      setItemDownloaded(item.url, !currentStatus, item.filename);
      updateItemCardButtons(item);
      refreshFilterCountsAndViews();
    });
    parentContainer.appendChild(statusBtn);
  }

  const isDownloaded = isItemDownloaded(item.url);
  if (isDownloaded) {
    statusBtn.className = 'btn btn-sm btn-success guc-status-toggle-btn ml-2';
    statusBtn.innerHTML = '<i class="fa fa-check mr-1"></i> Downloaded';
    statusBtn.title = 'Click to unmark as downloaded';
  } else {
    statusBtn.className = 'btn btn-sm btn-outline-secondary guc-status-toggle-btn ml-2';
    statusBtn.innerHTML = '<i class="fa fa-circle-o mr-1"></i> Mark Downloaded';
    statusBtn.title = 'Click to mark as downloaded';
  }
}

// --- State Management ---
let allDiscoveredItems = [];
const selectedItemUrls = new Set();
let currentFilterView = 'all'; // 'all' | 'undownloaded' | 'downloaded'

// Category Visibility Filter State (all ON by default)
const activeCategoryFilters = {
  "Lectures": true,
  "Tutorials": true,
  "Labs & Quizzes": true,
  "Sheets & Exercises": true,
  "Solutions": true,
  "Assignments": true,
  "Projects": true,
  "Other": true
};

function updateSelectedCountUI() {
  const countSpan = document.querySelector('.guc-selected-count');
  const downloadSelectedBtn = document.getElementById('guc-download-selected-btn');
  const count = selectedItemUrls.size;

  if (countSpan) countSpan.textContent = count;
  if (downloadSelectedBtn) {
    downloadSelectedBtn.disabled = count === 0;
    if (count > 0) {
      downloadSelectedBtn.classList.remove('btn-secondary');
      downloadSelectedBtn.classList.add('btn-primary');
    } else {
      downloadSelectedBtn.classList.remove('btn-primary');
      downloadSelectedBtn.classList.add('btn-secondary');
    }
  }
}

function updateAllWeekSelectButtons() {
  document.querySelectorAll('div.card.mb-5.weeksdata').forEach(weekBlock => {
    const weekItems = allDiscoveredItems.filter(it => it.domElements.itemRowElement.closest('.weeksdata') === weekBlock);
    const weekSelectBtn = weekBlock.querySelector('.guc-week-select-btn');
    if (!weekSelectBtn || weekItems.length === 0) return;

    const allSelected = weekItems.every(it => selectedItemUrls.has(it.url));
    if (allSelected) {
      weekSelectBtn.className = 'btn btn-sm btn-primary guc-week-select-btn mr-2';
      weekSelectBtn.innerHTML = '<i class="fa fa-check-square mr-1"></i> Week Selected';
    } else {
      weekSelectBtn.className = 'btn btn-sm btn-outline-secondary guc-week-select-btn mr-2';
      weekSelectBtn.innerHTML = '<i class="fa fa-square-o mr-1"></i> Select Week';
    }
  });
}

// --- Filter Views & Category Toggles ---
function refreshFilterCountsAndViews() {
  const downloadedMap = getDownloadedMap();
  let downloadedCount = 0;
  let undownloadedCount = 0;
  let visibleCount = 0;

  allDiscoveredItems.forEach(item => {
    const isDl = Boolean(downloadedMap[item.url]);
    if (isDl) downloadedCount++;
    else undownloadedCount++;

    const row = item.domElements.itemRowElement;
    if (!row) return;

    // Check 1: Downloaded / Undownloaded filter
    let passesStatus = true;
    if (currentFilterView === 'undownloaded' && isDl) {
      passesStatus = false;
    } else if (currentFilterView === 'downloaded' && !isDl) {
      passesStatus = false;
    }

    // Check 2: Category Visibility filter
    const passesCategory = activeCategoryFilters[item.category] !== false;

    const visible = passesStatus && passesCategory;
    row.style.display = visible ? '' : 'none';
    if (visible) visibleCount++;
  });

  // Check week blocks: if all items inside are hidden, hide the week block
  document.querySelectorAll('div.card.mb-5.weeksdata').forEach(weekBlock => {
    const itemCards = weekBlock.querySelectorAll('div.p-3 > div:last-of-type > div.card.mb-4');
    let hasVisibleItem = false;
    itemCards.forEach(c => {
      if (c.style.display !== 'none') hasVisibleItem = true;
    });
    weekBlock.style.display = hasVisibleItem ? '' : 'none';
  });

  // Update Top Panel Filter Tab Counts
  const countAll = document.querySelector('.guc-count-all');
  const countUndl = document.querySelector('.guc-count-undownloaded');
  const countDl = document.querySelector('.guc-count-downloaded');
  const btnUndlCount = document.querySelector('.guc-undownloaded-btn-count');
  const btnVisibleCount = document.querySelector('.guc-visible-btn-count');

  if (countAll) countAll.textContent = allDiscoveredItems.length;
  if (countUndl) countUndl.textContent = undownloadedCount;
  if (countDl) countDl.textContent = downloadedCount;
  if (btnUndlCount) btnUndlCount.textContent = undownloadedCount;
  if (btnVisibleCount) btnVisibleCount.textContent = visibleCount;

  // Toggle active tab appearance (clean separated pills)
  ['all', 'undownloaded', 'downloaded'].forEach(view => {
    const tab = document.getElementById(`guc-tab-${view}`);
    if (tab) {
      if (currentFilterView === view) {
        tab.className = 'btn btn-sm guc-tab-btn guc-tab-active';
      } else {
        tab.className = 'btn btn-sm guc-tab-btn guc-tab-inactive';
      }
    }
  });

  // Update Category Toggle Chip UI
  document.querySelectorAll('.guc-cat-toggle-chip').forEach(chip => {
    const cat = chip.dataset.cat;
    const isActive = activeCategoryFilters[cat] !== false;
    const catCount = allDiscoveredItems.filter(it => it.category === cat).length;

    if (isActive) {
      chip.className = 'btn btn-sm guc-cat-toggle-chip guc-cat-chip-active mr-2 mb-2';
      chip.innerHTML = `<i class="fa fa-check mr-1"></i> ${cat} <span class="badge badge-light border ml-1">${catCount}</span>`;
      chip.title = `Click to hide ${cat}`;
    } else {
      chip.className = 'btn btn-sm guc-cat-toggle-chip guc-cat-chip-inactive mr-2 mb-2';
      chip.innerHTML = `<i class="fa fa-eye-slash mr-1"></i> ${cat} <span class="badge badge-secondary ml-1">${catCount}</span>`;
      chip.title = `Click to show ${cat}`;
    }
  });

  // Enable/disable Download Undownloaded & Visible buttons
  const undlBtn = document.getElementById('guc-download-undownloaded-btn');
  if (undlBtn) undlBtn.disabled = undownloadedCount === 0;

  const visBtn = document.getElementById('guc-download-visible-btn');
  if (visBtn) visBtn.disabled = visibleCount === 0;
}

function setFilterView(view) {
  currentFilterView = view;
  refreshFilterCountsAndViews();
}

function toggleCategoryFilter(cat) {
  activeCategoryFilters[cat] = !activeCategoryFilters[cat];
  refreshFilterCountsAndViews();
}

// --- Main Page Processor ---
function processWeeks() {
  const weekBlocks = document.querySelectorAll('div.card.mb-5.weeksdata');
  if (weekBlocks.length === 0) {
    console.warn("GUC CMS Downloader: No week blocks found.");
    return;
  }

  injectCustomCSS();
  const courseMeta = extractCourseMetadata();
  const genSettings = getGeneralSettings();
  if (currentFilterView === 'all') {
    currentFilterView = genSettings.defaultView || 'all';
  }
  allDiscoveredItems = [];

  // Remove any legacy header bar checkboxes if previously injected
  document.querySelectorAll('.guc-card-header-bar, .guc-checkbox-wrapper').forEach(el => el.remove());

  weekBlocks.forEach((weekBlock, weekIndex) => {
    const weekInfo = extractWeekFolder(weekBlock, weekIndex);

    const contentItemsElements = weekBlock.querySelectorAll('div.p-3 > div:last-of-type > div.card.mb-4');
    const itemsInThisWeek = [];

    contentItemsElements.forEach(itemElement => {
      const details = extractItemDetails(itemElement, weekInfo, courseMeta);
      if (!details) return;

      allDiscoveredItems.push(details);
      itemsInThisWeek.push(details);

      // Initialize the action row buttons (Select & Mark Downloaded)
      updateItemCardButtons(details);

      // Intercept original download link
      const dlLink = details.domElements.downloadButtonAnchor;
      if (dlLink && !dlLink.dataset.gucDownloaderBound) {
        dlLink.dataset.gucDownloaderBound = "true";
        dlLink.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          requestSingleDownload(details);
        }, true);
      }
    });

    // Inject Week Header Controls with improved location & flex styling
    if (itemsInThisWeek.length > 0) {
      const cardHeader = weekBlock.querySelector('div.card-header');
      if (cardHeader && !cardHeader.querySelector('.guc-week-header-actions')) {
        // Apply flex layout to card-header so title and buttons sit cleanly on opposite sides
        cardHeader.style.cssText = 'height: auto !important; min-height: 54px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 10px 18px;';

        const actionsWrapper = document.createElement('div');
        actionsWrapper.className = 'guc-week-header-actions d-flex align-items-center flex-wrap mt-2 mt-md-0';
        actionsWrapper.style.cssText = 'gap: 8px;';

        // Select Week Button
        const weekSelectBtn = document.createElement('button');
        weekSelectBtn.type = 'button';
        weekSelectBtn.className = 'btn btn-sm btn-outline-secondary guc-week-select-btn mr-2';
        weekSelectBtn.innerHTML = '<i class="fa fa-square-o mr-1"></i> Select Week';
        weekSelectBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const allSelected = itemsInThisWeek.every(it => selectedItemUrls.has(it.url));
          itemsInThisWeek.forEach(it => {
            if (allSelected) {
              selectedItemUrls.delete(it.url);
            } else {
              selectedItemUrls.add(it.url);
            }
            updateItemCardButtons(it);
          });
          updateSelectedCountUI();
          updateAllWeekSelectButtons();
        });
        actionsWrapper.appendChild(weekSelectBtn);

        // Download Week Button
        const bulkWeekButton = document.createElement('button');
        bulkWeekButton.type = 'button';
        bulkWeekButton.className = 'btn btn-sm btn-success guc-download-week-button';
        bulkWeekButton.innerHTML = `<i class="fa fa-download mr-1"></i> Download Week (${itemsInThisWeek.length})`;
        bulkWeekButton.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          requestBulkDownload(itemsInThisWeek, weekInfo.weekTitle);
        });
        actionsWrapper.appendChild(bulkWeekButton);

        // Clear any old buttons in the secondary column and append to card-header
        const oldHost = cardHeader.querySelector('.menu-header-title.text-right');
        if (oldHost) oldHost.innerHTML = '';
        cardHeader.appendChild(actionsWrapper);
      }
    }
  });

  addGlobalBulkPanel(allDiscoveredItems, courseMeta);
  updateSelectedCountUI();
  updateAllWeekSelectButtons();
  refreshFilterCountsAndViews();
}

// --- Global Bulk Download Panel ---
function addGlobalBulkPanel(allItems, courseMeta) {
  if (allItems.length === 0) return;

  const insertionPoint = document.getElementById('ContentPlaceHolderright_ContentPlaceHoldercontent_desc');
  let parent;
  if (insertionPoint) {
    parent = insertionPoint.parentNode;
  } else {
    const fallback = document.querySelector('.app-page-title');
    if (fallback) parent = fallback.parentNode;
    else return;
  }

  // Remove existing panel if re-rendering
  const existing = document.querySelector('.guc-global-bulk-panel');
  if (existing) existing.remove();

  const settings = getFolderSettings();
  const genSettings = getGeneralSettings();
  const courseKey = courseMeta.courseCode || courseMeta.courseName;
  const currentSubjectFolder = (settings.subjectMappings && settings.subjectMappings[courseKey])
    ? settings.subjectMappings[courseKey]
    : courseMeta.defaultFolder;

  // Extract all unique categories present in this course
  const uniqueCategories = [];
  ["Lectures", "Tutorials", "Labs & Quizzes", "Sheets & Exercises", "Solutions", "Assignments", "Projects", "Other"].forEach(cat => {
    if (allItems.some(it => it.category === cat)) {
      uniqueCategories.push(cat);
    }
  });

  const panel = document.createElement('div');
  panel.className = 'card guc-global-bulk-panel';

  panel.innerHTML = `
    <div class="guc-panel-header">
      <div class="guc-panel-title">
        <i class="fa fa-download mr-2"></i> GUC CMS Downloader
        <span class="badge badge-secondary ml-2 font-weight-normal">${courseMeta.courseCode}</span>
      </div>
      <div class="d-flex align-items-center flex-wrap mt-2 mt-md-0" style="gap: 8px;">
        <button type="button" class="btn btn-outline-light btn-sm guc-header-btn" id="guc-toggle-folders-btn">
          <i class="fa fa-folder-open mr-1"></i> Folders
        </button>
        <button type="button" class="btn btn-outline-light btn-sm guc-header-btn" id="guc-toggle-settings-btn">
          <i class="fa fa-sliders mr-1"></i> Settings
        </button>
        <button type="button" class="btn btn-outline-light btn-sm guc-header-btn" id="guc-toggle-info-btn">
          <i class="fa fa-info-circle mr-1"></i> Info
        </button>
      </div>
    </div>

    <!-- Collapsible Folders Drawer -->
    <div id="guc-drawer-folders" class="guc-drawer" style="display: none;">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <strong class="text-dark"><i class="fa fa-folder-open mr-1"></i> Download Folder Organization</strong>
        <span class="small text-muted">All paths are relative to your browser Downloads folder</span>
      </div>

      <div class="row">
        <!-- Master Toggle & Main Folder -->
        <div class="col-md-6 mb-3">
          <div class="custom-control custom-switch mb-2">
            <input type="checkbox" class="custom-control-input" id="guc-setting-enable-folders" ${settings.enabled ? 'checked' : ''}>
            <label class="custom-control-label font-weight-bold" for="guc-setting-enable-folders" style="cursor: pointer;">
              Organize into Folders
            </label>
          </div>
          <small class="text-muted d-block mb-2">When disabled (default), all files save directly to Downloads.</small>

          <label class="small font-weight-bold mb-1">Layer 1: Main Root Folder</label>
          <div class="input-group input-group-sm mb-1">
            <div class="input-group-prepend"><span class="input-group-text"><i class="fa fa-folder"></i></span></div>
            <input type="text" id="guc-main-folder-input" class="form-control" value="${settings.mainFolder || ''}" placeholder="e.g. GUC CMS (leave empty for none)">
          </div>
          <small class="text-muted">Top-level directory where all courses will be placed.</small>
        </div>

        <!-- Subject Folder & Week Option -->
        <div class="col-md-6 mb-3">
          <label class="small font-weight-bold mb-1">Layer 2: Subject Folder (for ${courseMeta.courseCode})</label>
          <div class="input-group input-group-sm mb-1">
            <div class="input-group-prepend"><span class="input-group-text"><i class="fa fa-book"></i></span></div>
            <input type="text" id="guc-subject-folder-input" class="form-control" value="${currentSubjectFolder}" placeholder="Subject folder name">
            <div class="input-group-append">
              <button type="button" class="btn btn-outline-secondary" id="guc-reset-subject-btn" title="Reset to default">Reset</button>
            </div>
          </div>
          <small class="text-muted">Map this specific course to a custom folder name.</small>

          <div class="mt-3">
            <label class="small font-weight-bold mb-1">Layer 3: Week Subfolders</label>
            <div class="d-flex align-items-center">
              <div class="custom-control custom-checkbox mr-3">
                <input type="checkbox" class="custom-control-input" id="guc-setting-week-folders" ${settings.includeWeekFolders ? 'checked' : ''}>
                <label class="custom-control-label small" for="guc-setting-week-folders" style="cursor: pointer;">Create Week folders</label>
              </div>
              <select id="guc-setting-week-format" class="custom-select custom-select-sm" style="max-width: 180px;" ${!settings.includeWeekFolders ? 'disabled' : ''}>
                <option value="week_and_date" ${settings.weekFormat === 'week_and_date' ? 'selected' : ''}>Week 1 (2026-09-07)</option>
                <option value="week_only" ${settings.weekFormat === 'week_only' ? 'selected' : ''}>Week 1</option>
                <option value="date_only" ${settings.weekFormat === 'date_only' ? 'selected' : ''}>2026-09-07</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Live Preview -->
      <div class="mt-2 pt-2 border-top">
        <small class="font-weight-bold text-secondary d-block mb-1">Live Path Preview:</small>
        <div class="guc-live-preview-box" id="guc-path-preview">Downloads/...</div>
      </div>
    </div>

    <!-- Collapsible Settings Drawer -->
    <div id="guc-drawer-settings" class="guc-drawer" style="display: none;">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <strong class="text-dark"><i class="fa fa-sliders mr-1"></i> Extension Settings & Preferences</strong>
        <span class="small text-muted">Preferences are saved locally in your browser</span>
      </div>

      <div class="row">
        <!-- Download Engine -->
        <div class="col-md-6 mb-3">
          <h6 class="font-weight-bold text-dark mb-2" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
            <i class="fa fa-download text-primary mr-1"></i> Download Engine
          </h6>

          <div class="form-group mb-3">
            <label class="small font-weight-bold mb-1" for="guc-setting-delay">Download Queue Throttle (Delay)</label>
            <div class="input-group input-group-sm">
              <input type="number" id="guc-setting-delay" class="form-control" min="50" max="3000" step="50" value="${genSettings.downloadDelayMs}">
              <div class="input-group-append">
                <span class="input-group-text">ms</span>
              </div>
            </div>
            <small class="text-muted">Pause between consecutive downloads (default: 350ms) to prevent browser throttling.</small>
          </div>

          <div class="form-group mb-3">
            <label class="small font-weight-bold mb-1" for="guc-setting-conflict">File Conflict Action</label>
            <select id="guc-setting-conflict" class="custom-select custom-select-sm">
              <option value="uniquify" ${genSettings.conflictAction === 'uniquify' ? 'selected' : ''}>Uniquify (Append (1), (2) - Default)</option>
              <option value="overwrite" ${genSettings.conflictAction === 'overwrite' ? 'selected' : ''}>Overwrite existing file</option>
              <option value="prompt" ${genSettings.conflictAction === 'prompt' ? 'selected' : ''}>Prompt / ask where to save</option>
            </select>
            <small class="text-muted">Action when a file with identical name exists in the folder.</small>
          </div>

          <div class="form-group mb-2">
            <label class="small font-weight-bold mb-1" for="guc-setting-default-view">Default Filter View on Load</label>
            <select id="guc-setting-default-view" class="custom-select custom-select-sm">
              <option value="all" ${genSettings.defaultView === 'all' ? 'selected' : ''}>All Files</option>
              <option value="undownloaded" ${genSettings.defaultView === 'undownloaded' ? 'selected' : ''}>Undownloaded Only</option>
            </select>
            <small class="text-muted">Initial file tab selected when visiting a course page.</small>
          </div>
        </div>

        <!-- UI & Automation Controls -->
        <div class="col-md-6 mb-3">
          <h6 class="font-weight-bold text-dark mb-2" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
            <i class="fa fa-desktop text-primary mr-1"></i> Interface & Behavior
          </h6>

          <div class="custom-control custom-switch mb-3">
            <input type="checkbox" class="custom-control-input" id="guc-setting-auto-mark" ${genSettings.autoMarkDownloaded ? 'checked' : ''}>
            <label class="custom-control-label small font-weight-bold" for="guc-setting-auto-mark" style="cursor: pointer;">
              Auto-mark files as downloaded
            </label>
            <small class="text-muted d-block">Automatically set downloaded status when downloading through extension.</small>
          </div>

          <div class="custom-control custom-switch mb-3">
            <input type="checkbox" class="custom-control-input" id="guc-setting-highlight-cards" ${genSettings.highlightSelectedCards ? 'checked' : ''}>
            <label class="custom-control-label small font-weight-bold" for="guc-setting-highlight-cards" style="cursor: pointer;">
              Highlight selected item cards
            </label>
            <small class="text-muted d-block">Add an active border and soft blue tint to selected course items.</small>
          </div>

          <div class="custom-control custom-switch mb-3">
            <input type="checkbox" class="custom-control-input" id="guc-setting-show-toasts" ${genSettings.showToasts ? 'checked' : ''}>
            <label class="custom-control-label small font-weight-bold" for="guc-setting-show-toasts" style="cursor: pointer;">
              Show toast notifications
            </label>
            <small class="text-muted d-block">Display floating progress cards in bottom right corner during downloads.</small>
          </div>

          <div class="pt-2 border-top mt-3">
            <label class="small font-weight-bold text-danger mb-1">Storage & Reset Actions</label>
            <div class="d-flex flex-wrap" style="gap: 8px;">
              <button type="button" class="btn btn-outline-danger btn-sm" id="guc-clear-history-btn">
                <i class="fa fa-trash mr-1"></i> Clear Download History
              </button>
              <button type="button" class="btn btn-outline-secondary btn-sm" id="guc-reset-defaults-btn">
                <i class="fa fa-undo mr-1"></i> Reset All Settings
              </button>
            </div>
            <small class="text-muted d-block mt-1">Clearing history resets downloaded checkmarks. Reset restores original defaults.</small>
          </div>
        </div>
      </div>
    </div>

    <!-- Collapsible Info Drawer -->
    <div id="guc-drawer-info" class="guc-drawer" style="display: none;">
      <div class="d-flex justify-content-between align-items-center flex-wrap pb-2 mb-3 border-bottom">
        <div class="d-flex align-items-center flex-wrap">
          <h5 class="mb-0 font-weight-bold text-dark mr-2" style="font-size: 15px;">GUC CMS Downloader</h5>
          <span class="badge badge-primary mr-2" style="font-size: 11px; padding: 4px 8px;">v3.3.0</span>
          <span class="badge badge-secondary mr-2" style="font-size: 11px;">Manifest V3</span>
          <span class="badge badge-light border text-muted" style="font-size: 11px;">Firefox &bull; Brave &bull; Chrome</span>
        </div>
        <div class="text-muted small mt-1 mt-md-0">
          <a href="https://github.com/Sirye8/guc-cms-downloader" target="_blank" rel="noopener noreferrer" class="text-primary font-weight-bold" style="text-decoration: none;">
            <i class="fa fa-github mr-1"></i> GitHub Repository
          </a>
        </div>
      </div>

      <div class="row">
        <!-- What it does & How it works -->
        <div class="col-md-7 mb-3">
          <h6 class="font-weight-bold text-dark mb-2" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
            <i class="fa fa-bullseye text-primary mr-1"></i> What It Does
          </h6>
          <p class="small text-muted mb-3" style="line-height: 1.5;">
            GUC CMS Downloader is an open-source browser extension designed for students at the German University in Cairo. Material links on the CMS typically download with long server hashes (e.g. <code>GUC_576_70_73059_2026-10-12T13_26_21.pdf</code>), requiring tedious manual renaming across weekly cards. This extension automates clean renaming, categorizes all materials, and offers bulk downloading with optional folder organization.
          </p>

          <h6 class="font-weight-bold text-dark mb-2" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
            <i class="fa fa-cogs text-primary mr-1"></i> How It Works
          </h6>
          <ul class="small text-muted pl-3 mb-0" style="line-height: 1.6;">
            <li><strong>Smart Categorization:</strong> Automatically sorts course items into Lectures, Tutorials, Labs, Sheets, Solutions, Assignments, and Projects.</li>
            <li><strong>Topic-Preserving Renaming:</strong> Strips leading index prefixes while retaining the complete lecture or sheet subtitle and correct file extension.</li>
            <li><strong>Multi-Layer Routing:</strong> Optionally arranges files into custom root, course, and week subfolders inside your Downloads folder.</li>
            <li><strong>Persistent Download Tracking:</strong> Remembers which files you already downloaded across sessions using local storage.</li>
          </ul>
        </div>

        <!-- Quick Tips & Credits -->
        <div class="col-md-5 mb-3">
          <div class="p-3 rounded mb-3" style="background: #ffffff; border: 1px solid #e2e8f0;">
            <h6 class="font-weight-bold text-dark mb-2" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">
              <i class="fa fa-lightbulb-o text-warning mr-1"></i> Quick Tips
            </h6>
            <ul class="small text-muted pl-3 mb-0" style="line-height: 1.5;">
              <li>Use <strong>Category Chips</strong> to show or hide specific content types.</li>
              <li>Click <strong>Download Undownloaded</strong> to get newly posted files quickly.</li>
              <li>Use <strong>Select Week</strong> in any week header to batch download that week.</li>
              <li>Configure queue delays and conflict options in the <strong>Settings</strong> menu.</li>
            </ul>
          </div>

          <div class="p-3 rounded" style="background: #ffffff; border: 1px solid #e2e8f0;">
            <h6 class="font-weight-bold text-dark mb-1" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">
              <i class="fa fa-code-fork text-success mr-1"></i> Credits & License
            </h6>
            <div class="small text-muted" style="line-height: 1.5;">
              Created by <strong>Sirye8</strong> for GUC students.<br>
              Open source under the <strong>GPL-3.0 License</strong>.<br>
              Contributions and issues welcome on GitHub.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Panel Content -->
    <div class="card-body" style="padding: 16px 20px;">
      <!-- Segmented View Tabs (All / Undownloaded / Downloaded) & Selection Tools -->
      <div class="d-flex justify-content-between align-items-center flex-wrap mb-3">
        <div class="d-flex align-items-center flex-wrap guc-tabs-container mb-2 mb-md-0" style="gap: 8px;">
          <button type="button" class="btn btn-sm guc-tab-btn guc-tab-active" id="guc-tab-all">
            All Files (<span class="guc-count-all">${allItems.length}</span>)
          </button>
          <button type="button" class="btn btn-sm guc-tab-btn guc-tab-inactive" id="guc-tab-undownloaded">
            Undownloaded (<span class="guc-count-undownloaded">0</span>)
          </button>
          <button type="button" class="btn btn-sm guc-tab-btn guc-tab-inactive" id="guc-tab-downloaded">
            Downloaded (<span class="guc-count-downloaded">0</span>)
          </button>
        </div>

        <!-- Unified Selection & Batch Actions Toolbar -->
        <div class="d-flex align-items-center flex-wrap guc-selection-tools" style="gap: 8px;">
          <div class="btn-group btn-group-sm mr-1" role="group">
            <button type="button" class="btn btn-outline-secondary btn-sm" id="guc-select-all-btn" title="Select all visible files in current view">
              <i class="fa fa-check-square mr-1"></i> Select All
            </button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="guc-deselect-all-btn" title="Clear all selections">
              <i class="fa fa-square-o mr-1"></i> Deselect All
            </button>
          </div>
          <div class="btn-group btn-group-sm" role="group">
            <button type="button" class="btn btn-outline-success btn-sm" id="guc-mark-selected-btn" title="Mark selected files as downloaded">
              <i class="fa fa-check-circle mr-1"></i> Mark Selected
            </button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="guc-unmark-selected-btn" title="Unmark selected files">
              <i class="fa fa-circle-o mr-1"></i> Unmark Selected
            </button>
          </div>
        </div>
      </div>

      <!-- Category Visibility Filters (On/Off Toggles) -->
      <div class="guc-category-filters-section mb-3 p-2 rounded" style="background: #f8fafc; border: 1px solid #e2e8f0;">
        <div class="d-flex justify-content-between align-items-center flex-wrap mb-2">
          <small class="font-weight-bold text-secondary text-uppercase" style="letter-spacing: 0.5px; font-size: 11px;">
            <i class="fa fa-filter mr-1"></i> Category Visibility Filters (Click to Toggle On/Off):
          </small>
          <div>
            <button type="button" class="btn btn-link btn-sm p-0 mr-3 text-primary" id="guc-cat-show-all" style="font-size: 11px; text-decoration: none;">Show All</button>
            <button type="button" class="btn btn-link btn-sm p-0 text-secondary" id="guc-cat-hide-all" style="font-size: 11px; text-decoration: none;">Hide All</button>
          </div>
        </div>
        <div class="d-flex flex-wrap guc-category-chips-row" style="gap: 8px;">
          ${uniqueCategories.map(cat => `
            <button type="button" class="btn btn-sm guc-cat-toggle-chip guc-cat-chip-active" data-cat="${cat}">
              <i class="fa fa-check mr-1"></i> ${cat}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Primary Action Buttons Row with clean spacing -->
      <div class="d-flex align-items-center flex-wrap mb-3" style="gap: 10px;">
        <button type="button" class="btn btn-success btn-sm font-weight-bold shadow-sm" id="guc-download-undownloaded-btn">
          <i class="fa fa-arrow-circle-down mr-1"></i> Download Undownloaded (<span class="guc-undownloaded-btn-count">0</span>)
        </button>
        <button type="button" class="btn btn-info btn-sm font-weight-bold shadow-sm" id="guc-download-visible-btn">
          <i class="fa fa-filter mr-1"></i> Download Visible (<span class="guc-visible-btn-count">${allItems.length}</span>)
        </button>
        <button type="button" class="btn btn-outline-info btn-sm font-weight-bold shadow-sm" id="guc-download-all-btn">
          <i class="fa fa-download mr-1"></i> Download All (<span class="guc-total-count">${allItems.length}</span>)
        </button>
        <button type="button" class="btn btn-secondary btn-sm font-weight-bold shadow-sm" id="guc-download-selected-btn" disabled>
          <i class="fa fa-check-square-o mr-1"></i> Download Selected (<span class="guc-selected-count">${selectedItemUrls.size}</span>)
        </button>
      </div>

      <!-- Quick Bulk Category Download Buttons -->
      <div class="guc-category-buttons-container pt-2 border-top">
        <small class="text-muted d-block mb-2 font-weight-bold">Download Full Category:</small>
        <div class="guc-categories-row d-flex flex-wrap" style="gap: 8px;"></div>
      </div>
    </div>
  `;

  // --- Drawer Accordion Controller ---
  const drawers = {
    folders: { el: panel.querySelector('#guc-drawer-folders'), btn: panel.querySelector('#guc-toggle-folders-btn') },
    settings: { el: panel.querySelector('#guc-drawer-settings'), btn: panel.querySelector('#guc-toggle-settings-btn') },
    info: { el: panel.querySelector('#guc-drawer-info'), btn: panel.querySelector('#guc-toggle-info-btn') }
  };

  function toggleDrawer(drawerName) {
    const target = drawers[drawerName];
    if (!target || !target.el) return;

    const isCurrentlyOpen = target.el.style.display !== 'none';

    // Close all drawers
    Object.values(drawers).forEach(d => {
      if (d.el) d.el.style.display = 'none';
      if (d.btn) d.btn.classList.remove('active');
    });

    // If it was closed, open it now
    if (!isCurrentlyOpen) {
      target.el.style.display = 'block';
      target.btn.classList.add('active');
      if (drawerName === 'folders') {
        updatePreview();
      }
    }
  }

  drawers.folders.btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDrawer('folders');
  });

  drawers.settings.btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDrawer('settings');
  });

  drawers.info.btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDrawer('info');
  });

  // --- Folder Settings Event Handlers ---
  const mainFolderInput = panel.querySelector('#guc-main-folder-input');
  const subjectFolderInput = panel.querySelector('#guc-subject-folder-input');
  const resetSubjectBtn = panel.querySelector('#guc-reset-subject-btn');
  const enableFoldersCb = panel.querySelector('#guc-setting-enable-folders');
  const weekFoldersCb = panel.querySelector('#guc-setting-week-folders');
  const weekFormatSelect = panel.querySelector('#guc-setting-week-format');
  const previewBox = panel.querySelector('#guc-path-preview');

  function updatePreview() {
    const curSettings = getFolderSettings();
    const mockItem = allItems[0] || {
      filename: "Lecture 1.pdf",
      weekNumber: 1,
      weekDate: "2026-09-07",
      weekTitle: "Week 1 (2026-09-07)"
    };
    if (!curSettings.enabled) {
      previewBox.textContent = `Downloads / ${mockItem.filename} (Flat - folder organization disabled)`;
    } else {
      const path = buildDownloadPath(mockItem);
      previewBox.textContent = `Downloads / ${path}`;
    }
  }

  enableFoldersCb.addEventListener('change', () => {
    const cur = getFolderSettings();
    cur.enabled = enableFoldersCb.checked;
    saveFolderSettings(cur);
    updatePreview();
  });

  mainFolderInput.addEventListener('input', () => {
    const cur = getFolderSettings();
    cur.mainFolder = mainFolderInput.value;
    saveFolderSettings(cur);
    updatePreview();
  });

  subjectFolderInput.addEventListener('input', () => {
    const cur = getFolderSettings();
    if (!cur.subjectMappings) cur.subjectMappings = {};
    cur.subjectMappings[courseKey] = subjectFolderInput.value;
    saveFolderSettings(cur);
    updatePreview();
  });

  resetSubjectBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    subjectFolderInput.value = courseMeta.defaultFolder;
    const cur = getFolderSettings();
    if (cur.subjectMappings) delete cur.subjectMappings[courseKey];
    saveFolderSettings(cur);
    updatePreview();
    showToast("Folder Mapping Reset", `Reset to ${courseMeta.defaultFolder}`, null, true, false);
  });

  weekFoldersCb.addEventListener('change', () => {
    const cur = getFolderSettings();
    cur.includeWeekFolders = weekFoldersCb.checked;
    weekFormatSelect.disabled = !cur.includeWeekFolders;
    saveFolderSettings(cur);
    updatePreview();
  });

  weekFormatSelect.addEventListener('change', () => {
    const cur = getFolderSettings();
    cur.weekFormat = weekFormatSelect.value;
    saveFolderSettings(cur);
    updatePreview();
  });

  updatePreview();

  // --- General Settings Event Handlers ---
  const delayInput = panel.querySelector('#guc-setting-delay');
  if (delayInput) {
    delayInput.addEventListener('change', () => {
      let val = parseInt(delayInput.value, 10);
      if (isNaN(val) || val < 0) val = 0;
      if (val > 10000) val = 10000;
      delayInput.value = val;
      const cur = getGeneralSettings();
      cur.downloadDelayMs = val;
      saveGeneralSettings(cur);
    });
  }

  const conflictSelect = panel.querySelector('#guc-setting-conflict');
  if (conflictSelect) {
    conflictSelect.addEventListener('change', () => {
      const cur = getGeneralSettings();
      cur.conflictAction = conflictSelect.value;
      saveGeneralSettings(cur);
    });
  }

  const defaultViewSelect = panel.querySelector('#guc-setting-default-view');
  if (defaultViewSelect) {
    defaultViewSelect.addEventListener('change', () => {
      const cur = getGeneralSettings();
      cur.defaultView = defaultViewSelect.value;
      saveGeneralSettings(cur);
    });
  }

  const autoMarkCb = panel.querySelector('#guc-setting-auto-mark');
  if (autoMarkCb) {
    autoMarkCb.addEventListener('change', () => {
      const cur = getGeneralSettings();
      cur.autoMarkDownloaded = autoMarkCb.checked;
      saveGeneralSettings(cur);
    });
  }

  const highlightCardsCb = panel.querySelector('#guc-setting-highlight-cards');
  if (highlightCardsCb) {
    highlightCardsCb.addEventListener('change', () => {
      const cur = getGeneralSettings();
      cur.highlightSelectedCards = highlightCardsCb.checked;
      saveGeneralSettings(cur);
      allItems.forEach(it => updateItemCardButtons(it));
    });
  }

  const showToastsCb = panel.querySelector('#guc-setting-show-toasts');
  if (showToastsCb) {
    showToastsCb.addEventListener('change', () => {
      const cur = getGeneralSettings();
      cur.showToasts = showToastsCb.checked;
      saveGeneralSettings(cur);
    });
  }

  const clearHistoryBtn = panel.querySelector('#guc-clear-history-btn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm("Are you sure you want to clear all download history records? This cannot be undone.")) {
        localStorage.removeItem(STORAGE_KEY_DOWNLOADED);
        allItems.forEach(it => updateItemCardButtons(it));
        refreshFilterCountsAndViews();
        showToast("History Cleared", "Cleared all download history records.", null, true, false);
      }
    });
  }

  const resetDefaultsBtn = panel.querySelector('#guc-reset-defaults-btn');
  if (resetDefaultsBtn) {
    resetDefaultsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm("Reset all folder settings and preferences to default?")) {
        localStorage.removeItem(STORAGE_KEY_FOLDER_SETTINGS);
        localStorage.removeItem(STORAGE_KEY_GENERAL_SETTINGS);

        const newFold = getFolderSettings();
        const newGen = getGeneralSettings();

        // Update Folders UI
        enableFoldersCb.checked = newFold.enabled;
        mainFolderInput.value = newFold.mainFolder;
        subjectFolderInput.value = courseMeta.defaultFolder;
        weekFoldersCb.checked = newFold.includeWeekFolders;
        weekFormatSelect.value = newFold.weekFormat;
        weekFormatSelect.disabled = !newFold.includeWeekFolders;
        updatePreview();

        // Update Settings UI
        delayInput.value = newGen.downloadDelayMs;
        conflictSelect.value = newGen.conflictAction;
        defaultViewSelect.value = newGen.defaultView;
        autoMarkCb.checked = newGen.autoMarkDownloaded;
        highlightCardsCb.checked = newGen.highlightSelectedCards;
        showToastsCb.checked = newGen.showToasts;

        allItems.forEach(it => updateItemCardButtons(it));
        refreshFilterCountsAndViews();
        showToast("Settings Reset", "Restored all settings to default.", null, true, false);
      }
    });
  }

  // --- Filter View Tabs ---
  panel.querySelector('#guc-tab-all').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setFilterView('all');
  });

  panel.querySelector('#guc-tab-undownloaded').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setFilterView('undownloaded');
  });

  panel.querySelector('#guc-tab-downloaded').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setFilterView('downloaded');
  });

  // --- Category Toggle Chips ---
  panel.querySelectorAll('.guc-cat-toggle-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCategoryFilter(chip.dataset.cat);
    });
  });

  panel.querySelector('#guc-cat-show-all').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uniqueCategories.forEach(cat => { activeCategoryFilters[cat] = true; });
    refreshFilterCountsAndViews();
  });

  panel.querySelector('#guc-cat-hide-all').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uniqueCategories.forEach(cat => { activeCategoryFilters[cat] = false; });
    refreshFilterCountsAndViews();
  });

  // --- Select / Deselect All ---
  panel.querySelector('#guc-select-all-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    let count = 0;
    allItems.forEach(it => {
      // Only select visible items based on current filters
      if (it.domElements.itemRowElement.style.display !== 'none') {
        selectedItemUrls.add(it.url);
        updateItemCardButtons(it);
        count++;
      }
    });
    updateSelectedCountUI();
    updateAllWeekSelectButtons();
    if (count > 0) {
      showToast("Selected All Visible", `Selected ${count} visible files.`, null, true, false);
    }
  });

  panel.querySelector('#guc-deselect-all-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const prevCount = selectedItemUrls.size;
    selectedItemUrls.clear();
    allItems.forEach(it => {
      updateItemCardButtons(it);
    });
    updateSelectedCountUI();
    updateAllWeekSelectButtons();
    if (prevCount > 0) {
      showToast("Cleared Selection", "Deselected all files.", null, false, false);
    }
  });

  // --- Mark / Unmark Selected ---
  panel.querySelector('#guc-mark-selected-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedItemUrls.size === 0) {
      showToast("No Selection", "Please select files to mark as downloaded.", null, false, true);
      return;
    }
    allItems.forEach(it => {
      if (selectedItemUrls.has(it.url)) {
        setItemDownloaded(it.url, true, it.filename);
        updateItemCardButtons(it);
      }
    });
    refreshFilterCountsAndViews();
    showToast("Updated", `Marked ${selectedItemUrls.size} files as downloaded.`, null, true, false);
  });

  panel.querySelector('#guc-unmark-selected-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedItemUrls.size === 0) {
      showToast("No Selection", "Please select files to unmark.", null, false, true);
      return;
    }
    allItems.forEach(it => {
      if (selectedItemUrls.has(it.url)) {
        setItemDownloaded(it.url, false, it.filename);
        updateItemCardButtons(it);
      }
    });
    refreshFilterCountsAndViews();
    showToast("Updated", `Unmarked ${selectedItemUrls.size} files.`, null, true, false);
  });

  // --- Download Undownloaded ---
  panel.querySelector('#guc-download-undownloaded-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const undownloaded = allItems.filter(it => !isItemDownloaded(it.url));
    requestBulkDownload(undownloaded, `Undownloaded Files`);
  });

  // --- Download Visible ---
  panel.querySelector('#guc-download-visible-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const visibleItems = allItems.filter(it => it.domElements.itemRowElement.style.display !== 'none');
    requestBulkDownload(visibleItems, `Visible Filtered Files (${visibleItems.length})`);
  });

  // --- Download All ---
  panel.querySelector('#guc-download-all-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    requestBulkDownload(allItems, `${courseMeta.courseName || 'All Course'} Files`);
  });

  // --- Download Selected ---
  panel.querySelector('#guc-download-selected-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const selected = allItems.filter(it => selectedItemUrls.has(it.url));
    requestBulkDownload(selected, `Selected Files (${selected.length})`);
  });

  // --- Quick Category Download Buttons ---
  const catContainer = panel.querySelector('.guc-categories-row');
  uniqueCategories.forEach(cat => {
    const filtered = allItems.filter(it => it.category === cat);
    if (filtered.length > 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline-primary btn-sm font-weight-normal shadow-sm';
      btn.innerHTML = `${cat} <span class="badge badge-light border ml-1">${filtered.length}</span>`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        requestBulkDownload(filtered, cat);
      });
      catContainer.appendChild(btn);
    }
  });

  if (insertionPoint) {
    parent.insertBefore(panel, insertionPoint.nextSibling);
  } else if (document.querySelector('.app-page-title')) {
    const heading = document.querySelector('.app-page-title');
    heading.parentNode.insertBefore(panel, heading.nextSibling);
  }
}

// --- Custom Scoped CSS Injection ---
function injectCustomCSS() {
  if (document.getElementById('guc-cms-custom-styles')) return;

  const style = document.createElement('style');
  style.id = 'guc-cms-custom-styles';
  style.textContent = `
    .guc-global-bulk-panel {
      border: 1px solid #cbd5e1 !important;
      border-radius: 12px !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05) !important;
      background: #ffffff !important;
      overflow: hidden !important;
      margin-top: 15px;
      margin-bottom: 24px;
    }
    .guc-panel-header {
      background: #1e293b !important;
      color: #ffffff !important;
      padding: 12px 20px !important;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
    }
    .guc-panel-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.3px;
      display: flex;
      align-items: center;
      color: #ffffff !important;
    }
    .guc-badge-ver {
      background: #2563eb;
      color: #ffffff;
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 10px;
      margin-left: 8px;
      font-weight: 600;
    }
    /* Tab Buttons with distinct spacing and border */
    .guc-tab-btn {
      font-size: 13px !important;
      font-weight: 600 !important;
      padding: 6px 14px !important;
      border-radius: 8px !important;
      transition: all 0.2s ease !important;
      cursor: pointer;
    }
    .guc-tab-active {
      background: #2563eb !important;
      color: #ffffff !important;
      border: 1px solid #2563eb !important;
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25) !important;
    }
    .guc-tab-inactive {
      background: #f1f5f9 !important;
      color: #475569 !important;
      border: 1px solid #cbd5e1 !important;
    }
    .guc-tab-inactive:hover {
      background: #e2e8f0 !important;
      color: #1e293b !important;
    }
    /* Category Toggle Chips */
    .guc-cat-toggle-chip {
      font-size: 12px !important;
      font-weight: 500 !important;
      padding: 4px 11px !important;
      border-radius: 20px !important;
      cursor: pointer;
      transition: all 0.15s ease !important;
    }
    .guc-cat-chip-active {
      background: #eff6ff !important;
      color: #1d4ed8 !important;
      border: 1.5px solid #3b82f6 !important;
    }
    .guc-cat-chip-active:hover {
      background: #dbeafe !important;
    }
    .guc-cat-chip-inactive {
      background: #f1f5f9 !important;
      color: #94a3b8 !important;
      border: 1.5px dashed #cbd5e1 !important;
      text-decoration: line-through;
    }
    .guc-cat-chip-inactive:hover {
      background: #e2e8f0 !important;
      color: #64748b !important;
    }
    /* Action Row Buttons */
    .guc-select-toggle-btn {
      font-size: 11px !important;
      font-weight: 600 !important;
      padding: 4px 10px !important;
      border-radius: 6px !important;
      cursor: pointer;
      transition: all 0.15s ease !important;
      vertical-align: middle;
    }
    .guc-status-toggle-btn {
      font-size: 11px !important;
      font-weight: 600 !important;
      padding: 4px 10px !important;
      border-radius: 6px !important;
      cursor: pointer;
      transition: all 0.15s ease !important;
      vertical-align: middle;
    }
    .guc-item-card-selected {
      border: 1.5px solid #2563eb !important;
      background-color: #f8faff !important;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.1) !important;
    }
    .guc-header-btn {
      font-size: 12px !important;
      font-weight: 500 !important;
      border-color: rgba(255, 255, 255, 0.35) !important;
      color: #f1f5f9 !important;
      border-radius: 6px !important;
      transition: all 0.15s ease !important;
    }
    .guc-header-btn:hover {
      background: rgba(255, 255, 255, 0.18) !important;
      border-color: rgba(255, 255, 255, 0.7) !important;
      color: #ffffff !important;
    }
    .guc-header-btn.active {
      background: #ffffff !important;
      color: #0f172a !important;
      border-color: #ffffff !important;
      font-weight: 600 !important;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15) !important;
    }
    .guc-drawer {
      background: #f8fafc !important;
      border-top: 1px solid #e2e8f0 !important;
      padding: 16px 20px !important;
      animation: gucDrawerFadeIn 0.2s ease-in-out;
    }
    @keyframes gucDrawerFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .guc-live-preview-box {
      background: #0f172a;
      color: #38bdf8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      padding: 10px 14px;
      border-radius: 6px;
      word-break: break-all;
    }
  `;
  document.head.appendChild(style);
}

// --- Initialization & MutationObserver ---
let initTimeout = null;
function debouncedInit() {
  if (initTimeout) clearTimeout(initTimeout);
  initTimeout = setTimeout(processWeeks, 350);
}

const observer = new MutationObserver((mutationsList) => {
  for (const mutation of mutationsList) {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      let isRelevant = false;
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList.contains('weeksdata') || node.querySelector('.weeksdata')) {
            isRelevant = true;
          }
        }
      });
      if (isRelevant) {
        debouncedInit();
        break;
      }
    }
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    processWeeks();
    const target = document.querySelector('.app-main__inner') || document.body;
    observer.observe(target, { childList: true, subtree: true });
  });
} else {
  processWeeks();
  const target = document.querySelector('.app-main__inner') || document.body;
  observer.observe(target, { childList: true, subtree: true });
}
