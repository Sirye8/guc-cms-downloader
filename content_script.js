// content_script.js
// GUC CMS Downloader v3.1.0
console.log("GUC CMS Downloader content script loaded");

const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);

// --- Storage Keys ---
const STORAGE_KEY_DOWNLOADED = 'guc_cms_downloaded_items_v2';
const STORAGE_KEY_FOLDER_SETTINGS = 'guc_cms_folder_settings_v2';

// --- Folder Organization Settings ---
function getDefaultFolderSettings() {
  return {
    enabled: true,
    mainFolder: "GUC CMS",
    includeWeekFolders: true,
    weekFormat: "week_and_date", // "week_and_date", "week_only", "date_only", "none"
    subjectMappings: {} // courseCode -> custom folder name
  };
}

function getFolderSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FOLDER_SETTINGS);
    if (!raw) return getDefaultFolderSettings();
    const parsed = JSON.parse(raw);
    return Object.assign(getDefaultFolderSettings(), parsed);
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
    .map(segment => segment.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim())
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
  title = title.replace(/\b(Lecture|Lectures|Tutorial|Tutorials|Sheet|Sheets|Lab|Labs|Quiz|Quizzes|Assignment|Assignments|Example)(\d+)\b/gi, '$1 $2');

  // 4. Fix numbers glued together with ampersand like "9&10" -> "9 & 10"
  title = title.replace(/(\d+)&(\d+)/g, '$1 & $2');

  // 5. Expand PascalCase like "Example1DetailedSolution"
  title = title.replace(/([a-z])([A-Z])/g, '$1 $2');
  title = title.replace(/(\d+)([A-Za-z])/g, '$1 $2');

  // 6. Normalize spaced hyphens (leave intra-word hyphens like In-Lecture untouched)
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

// --- Course & Week Metadata Extraction ---
function extractCourseMetadata() {
  const courseLabel = document.getElementById('ContentPlaceHolderright_ContentPlaceHoldercontent_LabelCourseName');
  const seasonLabel = document.getElementById('ContentPlaceHolderright_ContentPlaceHoldercontent_LabelseasonName');

  let courseCode = "";
  let courseName = "";
  let season = "";

  if (courseLabel && courseLabel.textContent) {
    const rawCourse = courseLabel.textContent.trim();
    // Pattern: "(|NETW903|) Network and Services (576)"
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
      // Default: "week_and_date"
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

  return {
    rawTitle: rawTitleFromStrong,
    cleanedTitleForFilter: cleanedTitleForFilter,
    itemType: itemType,
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
  const finalPath = buildDownloadPath(item);
  showToast("Starting Download", item.filename, null, false, false);
  setItemDownloaded(item.url, true, item.filename);
  updateItemStatusUI(item);
  refreshFilterCountsAndViews();

  try {
    const response = await browserAPI.runtime.sendMessage({
      action: "downloadFile",
      url: item.url,
      filename: finalPath,
      displayName: item.filename
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

  // Mark all as downloaded in local storage
  items.forEach(it => {
    setItemDownloaded(it.url, true, it.filename);
    updateItemStatusUI(it);
  });
  refreshFilterCountsAndViews();

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
    displayName: it.filename
  }));

  try {
    const response = await browserAPI.runtime.sendMessage({
      action: "bulkDownloadFiles",
      items: payload,
      description: description
    });
    if (!response || !response.success) {
      showToast("Download Failed", "Could not start bulk download.", null, false, true);
    }
  } catch (err) {
    console.error("Error sending bulk download message:", err);
    showToast("Download Error", err.message, null, false, true);
  }
}

// --- Item UI: Status Badge & Checkbox ---
function updateItemStatusUI(item) {
  const row = item.domElements.itemRowElement;
  if (!row) return;

  const isDownloaded = isItemDownloaded(item.url);
  let statusBtn = row.querySelector('.guc-status-toggle-btn');

  if (!statusBtn) {
    statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.className = 'btn btn-sm guc-status-toggle-btn ml-2';
    statusBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const currentStatus = isItemDownloaded(item.url);
      setItemDownloaded(item.url, !currentStatus, item.filename);
      updateItemStatusUI(item);
      refreshFilterCountsAndViews();
    });

    const dlAnchor = item.domElements.downloadButtonAnchor;
    if (dlAnchor && dlAnchor.parentNode) {
      dlAnchor.parentNode.appendChild(statusBtn);
    }
  }

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

function onItemCheckboxChanged(item, isChecked) {
  const card = item.domElements.itemRowElement;
  if (isChecked) {
    selectedItemUrls.add(item.url);
    if (card) card.classList.add('guc-item-card-selected');
  } else {
    selectedItemUrls.delete(item.url);
    if (card) card.classList.remove('guc-item-card-selected');
  }
  updateSelectedCountUI();
}

// --- Filter Views (All / Undownloaded / Downloaded) ---
function refreshFilterCountsAndViews() {
  const downloadedMap = getDownloadedMap();
  let downloadedCount = 0;
  let undownloadedCount = 0;

  allDiscoveredItems.forEach(item => {
    const isDl = Boolean(downloadedMap[item.url]);
    if (isDl) downloadedCount++;
    else undownloadedCount++;

    const row = item.domElements.itemRowElement;
    if (!row) return;

    let visible = true;
    if (currentFilterView === 'undownloaded' && isDl) {
      visible = false;
    } else if (currentFilterView === 'downloaded' && !isDl) {
      visible = false;
    }
    row.style.display = visible ? '' : 'none';
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

  if (countAll) countAll.textContent = allDiscoveredItems.length;
  if (countUndl) countUndl.textContent = undownloadedCount;
  if (countDl) countDl.textContent = downloadedCount;
  if (btnUndlCount) btnUndlCount.textContent = undownloadedCount;

  // Toggle active tab appearance
  ['all', 'undownloaded', 'downloaded'].forEach(view => {
    const tab = document.getElementById(`guc-tab-${view}`);
    if (tab) {
      if (currentFilterView === view) {
        tab.className = 'btn btn-primary btn-sm font-weight-bold guc-tab-btn';
      } else {
        tab.className = 'btn btn-outline-secondary btn-sm guc-tab-btn';
      }
    }
  });

  // Enable/disable Download Undownloaded button
  const undlBtn = document.getElementById('guc-download-undownloaded-btn');
  if (undlBtn) {
    undlBtn.disabled = undownloadedCount === 0;
  }
}

function setFilterView(view) {
  currentFilterView = view;
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
  allDiscoveredItems = [];

  weekBlocks.forEach((weekBlock, weekIndex) => {
    const weekInfo = extractWeekFolder(weekBlock, weekIndex);

    const contentItemsElements = weekBlock.querySelectorAll('div.p-3 > div:last-of-type > div.card.mb-4');
    const itemsInThisWeek = [];

    contentItemsElements.forEach(itemElement => {
      const details = extractItemDetails(itemElement, weekInfo, courseMeta);
      if (!details) return;

      allDiscoveredItems.push(details);
      itemsInThisWeek.push(details);

      // Initialize status badge
      updateItemStatusUI(details);

      // Inject clean card header bar with checkbox
      const body = itemElement.querySelector('.card-body');
      if (body && !body.querySelector('.guc-card-header-bar')) {
        const headerBar = document.createElement('div');
        headerBar.className = 'guc-card-header-bar d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom';
        headerBar.innerHTML = `
          <label class="guc-checkbox-custom-label d-flex align-items-center mb-0" style="cursor: pointer; user-select: none;">
            <input type="checkbox" class="guc-item-select-checkbox mr-2">
            <span class="small font-weight-bold text-secondary">Select File</span>
          </label>
          <span class="badge badge-light border text-muted" style="font-size: 11px;">${details.itemType || 'Material'}</span>
        `;
        const cb = headerBar.querySelector('input');
        cb.checked = selectedItemUrls.has(details.url);
        if (cb.checked) {
          itemElement.classList.add('guc-item-card-selected');
        }

        cb.addEventListener('change', (e) => {
          onItemCheckboxChanged(details, e.target.checked);
        });

        // Insert neatly at top of card body
        body.insertBefore(headerBar, body.firstChild);
      }

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

    // Inject Week Header Controls
    if (itemsInThisWeek.length > 0) {
      const weekHeader = weekBlock.querySelector('div.card-header h2.text-big');
      if (weekHeader) {
        const buttonHost = weekHeader.closest('.card-header').querySelector('.col-lg-6.col-md-6.col-sm-12:last-child .menu-header-title.text-right');
        if (buttonHost && !buttonHost.querySelector('.guc-week-controls-wrapper')) {
          const wrapper = document.createElement('div');
          wrapper.className = 'guc-week-controls-wrapper d-inline-flex align-items-center';

          // Select Week Checkbox
          const weekCbLabel = document.createElement('label');
          weekCbLabel.className = 'mb-0 mr-3 small text-muted font-weight-normal';
          weekCbLabel.style.cursor = 'pointer';
          weekCbLabel.innerHTML = `<input type="checkbox" class="guc-week-select-all mr-1" style="vertical-align: middle;"> Select Week`;
          const weekCb = weekCbLabel.querySelector('input');
          weekCb.addEventListener('change', (e) => {
            const checked = e.target.checked;
            itemsInThisWeek.forEach(it => {
              const rowCb = it.domElements.itemRowElement.querySelector('.guc-item-select-checkbox');
              if (rowCb) rowCb.checked = checked;
              onItemCheckboxChanged(it, checked);
            });
          });
          wrapper.appendChild(weekCbLabel);

          // Download Week Button
          const bulkWeekButton = document.createElement('button');
          bulkWeekButton.type = 'button';
          bulkWeekButton.textContent = `Download Week Files (${itemsInThisWeek.length})`;
          bulkWeekButton.className = 'btn btn-success btn-sm mb-2 guc-download-week-button';
          bulkWeekButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            requestBulkDownload(itemsInThisWeek, weekInfo.weekTitle);
          });
          wrapper.appendChild(bulkWeekButton);

          buttonHost.innerHTML = '';
          buttonHost.appendChild(wrapper);
        }
      }
    }
  });

  addGlobalBulkPanel(allDiscoveredItems, courseMeta);
  updateSelectedCountUI();
  refreshFilterCountsAndViews();
}

// --- Global Bulk Download Panel with Multi-Layer Folder Mapping ---
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
  const courseKey = courseMeta.courseCode || courseMeta.courseName;
  const currentSubjectFolder = (settings.subjectMappings && settings.subjectMappings[courseKey])
    ? settings.subjectMappings[courseKey]
    : courseMeta.defaultFolder;

  const panel = document.createElement('div');
  panel.className = 'card guc-global-bulk-panel';

  panel.innerHTML = `
    <div class="guc-panel-header">
      <div class="guc-panel-title">
        <i class="fa fa-download mr-2"></i> GUC CMS Downloader
        <span class="guc-badge-ver">v3.1</span>
        <span class="badge badge-secondary ml-2 font-weight-normal">${courseMeta.courseCode}</span>
      </div>
      <div class="d-flex align-items-center flex-wrap mt-2 mt-md-0">
        <button type="button" class="btn btn-outline-light btn-sm mr-2 py-1 px-2" id="guc-toggle-settings-btn" style="font-size: 12px;">
          <i class="fa fa-folder-open mr-1"></i> Folder Options
        </button>
        <button type="button" class="btn btn-outline-light btn-sm mr-2 py-1 px-2" id="guc-select-all-btn" style="font-size: 12px;">
          Select All
        </button>
        <button type="button" class="btn btn-outline-light btn-sm py-1 px-2" id="guc-deselect-all-btn" style="font-size: 12px;">
          Deselect All
        </button>
      </div>
    </div>

    <!-- Collapsible Folder Settings Drawer -->
    <div id="guc-settings-drawer" class="guc-settings-drawer" style="display: none;">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <strong class="text-dark"><i class="fa fa-sliders mr-1"></i> Download Folder Organization</strong>
        <span class="small text-muted">All paths are relative to your browser's Downloads folder</span>
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
          <small class="text-muted d-block mb-2">When disabled, all files save directly to Downloads.</small>

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

    <!-- Main Panel Content -->
    <div class="card-body" style="padding: 16px 20px;">
      <!-- Segmented View Tabs (All / Undownloaded / Downloaded) -->
      <div class="d-flex justify-content-between align-items-center flex-wrap mb-3">
        <div class="btn-group btn-group-sm mb-2 mb-md-0" role="group">
          <button type="button" class="btn btn-primary btn-sm font-weight-bold guc-tab-btn" id="guc-tab-all">
            All Files (<span class="guc-count-all">${allItems.length}</span>)
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm guc-tab-btn" id="guc-tab-undownloaded">
            Undownloaded (<span class="guc-count-undownloaded">0</span>)
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm guc-tab-btn" id="guc-tab-downloaded">
            Downloaded (<span class="guc-count-downloaded">0</span>)
          </button>
        </div>

        <!-- Batch Selection Actions -->
        <div class="d-flex align-items-center">
          <button type="button" class="btn btn-outline-success btn-sm mr-2" id="guc-mark-selected-btn">
            <i class="fa fa-check-circle mr-1"></i> Mark Selected
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="guc-unmark-selected-btn">
            <i class="fa fa-circle-o mr-1"></i> Unmark Selected
          </button>
        </div>
      </div>

      <!-- Primary Action Buttons Row -->
      <div class="d-flex align-items-center flex-wrap mb-3">
        <button type="button" class="btn btn-success btn-sm mr-2 mb-2 font-weight-bold shadow-sm" id="guc-download-undownloaded-btn">
          <i class="fa fa-arrow-circle-down mr-1"></i> Download Undownloaded (<span class="guc-undownloaded-btn-count">0</span>)
        </button>
        <button type="button" class="btn btn-info btn-sm mr-2 mb-2 font-weight-bold shadow-sm" id="guc-download-all-btn">
          <i class="fa fa-download mr-1"></i> Download All (<span class="guc-total-count">${allItems.length}</span>)
        </button>
        <button type="button" class="btn btn-secondary btn-sm mr-2 mb-2 font-weight-bold shadow-sm" id="guc-download-selected-btn" disabled>
          <i class="fa fa-check-square-o mr-1"></i> Download Selected (<span class="guc-selected-count">${selectedItemUrls.size}</span>)
        </button>
      </div>

      <!-- Categories Section -->
      <div class="guc-category-buttons-container pt-2 border-top">
        <small class="text-muted d-block mb-2 font-weight-bold">Download by Category:</small>
        <div class="guc-categories-row d-flex flex-wrap"></div>
      </div>
    </div>
  `;

  // --- Folder Settings Event Handlers ---
  const drawer = panel.querySelector('#guc-settings-drawer');
  const toggleSettingsBtn = panel.querySelector('#guc-toggle-settings-btn');
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
    const path = buildDownloadPath(mockItem);
    previewBox.textContent = `Downloads / ${path}`;
  }

  toggleSettingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isHidden = drawer.style.display === 'none';
    drawer.style.display = isHidden ? 'block' : 'none';
    toggleSettingsBtn.classList.toggle('active', isHidden);
    if (isHidden) updatePreview();
  });

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

  // --- Select / Deselect All ---
  panel.querySelector('#guc-select-all-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    allItems.forEach(it => {
      // Only select visible items if filtered
      if (it.domElements.itemRowElement.style.display !== 'none') {
        selectedItemUrls.add(it.url);
        const cb = it.domElements.itemRowElement.querySelector('.guc-item-select-checkbox');
        if (cb) cb.checked = true;
        it.domElements.itemRowElement.classList.add('guc-item-card-selected');
      }
    });
    document.querySelectorAll('.guc-week-select-all').forEach(cb => cb.checked = true);
    updateSelectedCountUI();
  });

  panel.querySelector('#guc-deselect-all-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectedItemUrls.clear();
    allItems.forEach(it => {
      const cb = it.domElements.itemRowElement.querySelector('.guc-item-select-checkbox');
      if (cb) cb.checked = false;
      it.domElements.itemRowElement.classList.remove('guc-item-card-selected');
    });
    document.querySelectorAll('.guc-week-select-all').forEach(cb => cb.checked = false);
    updateSelectedCountUI();
  });

  // --- Mark / Unmark Selected ---
  panel.querySelector('#guc-mark-selected-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedItemUrls.size === 0) {
      showToast("No Selection", "Please check files to mark as downloaded.", null, false, true);
      return;
    }
    allItems.forEach(it => {
      if (selectedItemUrls.has(it.url)) {
        setItemDownloaded(it.url, true, it.filename);
        updateItemStatusUI(it);
      }
    });
    refreshFilterCountsAndViews();
    showToast("Updated", `Marked ${selectedItemUrls.size} files as downloaded.`, null, true, false);
  });

  panel.querySelector('#guc-unmark-selected-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedItemUrls.size === 0) {
      showToast("No Selection", "Please check files to unmark.", null, false, true);
      return;
    }
    allItems.forEach(it => {
      if (selectedItemUrls.has(it.url)) {
        setItemDownloaded(it.url, false, it.filename);
        updateItemStatusUI(it);
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

  // Helper to test if item is a solution
  const isSolutionItem = (item) => {
    const t = item.cleanedTitleForFilter;
    const it = item.itemType;
    return t.includes('solution') || t.includes('detailedsolution') || it.includes('solution');
  };

  // Define Category Filters
  const categories = [
    {
      label: 'Lectures',
      filter: it => (it.itemType.includes('lecture') || it.cleanedTitleForFilter.startsWith('lecture') || it.cleanedTitleForFilter.startsWith('lectures')) && !isSolutionItem(it)
    },
    {
      label: 'Tutorials',
      filter: it => it.itemType.includes('tutorial') || it.cleanedTitleForFilter.startsWith('tutorial')
    },
    {
      label: 'Labs & Quizzes',
      filter: it => it.itemType.includes('lab') || it.cleanedTitleForFilter.includes('lab') || it.cleanedTitleForFilter.includes('quiz')
    },
    {
      label: 'Sheets & Exercises',
      filter: it => (it.cleanedTitleForFilter.includes('sheet') || it.itemType.includes('sheet') || it.itemType.includes('exercise')) && !isSolutionItem(it) && !it.cleanedTitleForFilter.startsWith('lecture') && !it.cleanedTitleForFilter.startsWith('tutorial') && !it.cleanedTitleForFilter.includes('lab')
    },
    {
      label: 'Solutions',
      filter: it => isSolutionItem(it)
    },
    {
      label: 'Assignments & Projects',
      filter: it => (it.itemType.includes('assignment') || it.cleanedTitleForFilter.includes('assignment') || it.itemType.includes('project') || it.cleanedTitleForFilter.includes('project')) && !it.cleanedTitleForFilter.startsWith('lecture') && !it.cleanedTitleForFilter.startsWith('tutorial') && !it.cleanedTitleForFilter.includes('lab')
    }
  ];

  const catContainer = panel.querySelector('.guc-categories-row');
  categories.forEach(cat => {
    const filtered = allItems.filter(cat.filter);
    if (filtered.length > 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline-primary btn-sm mr-2 mb-2 font-weight-normal shadow-sm';
      btn.innerHTML = `${cat.label} <span class="badge badge-light border ml-1">${filtered.length}</span>`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        requestBulkDownload(filtered, cat.label);
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
    .guc-tab-btn {
      font-size: 12px !important;
      font-weight: 600 !important;
      padding: 5px 12px !important;
      border-radius: 6px !important;
      transition: all 0.15s ease !important;
      cursor: pointer;
    }
    .guc-item-select-checkbox {
      width: 17px !important;
      height: 17px !important;
      cursor: pointer;
      accent-color: #2563eb;
      vertical-align: middle;
    }
    .guc-status-toggle-btn {
      font-size: 11px !important;
      font-weight: 600 !important;
      padding: 4px 9px !important;
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
    .guc-settings-drawer {
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 16px 20px;
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
    .guc-card-header-bar {
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 4px;
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
