// content_script.js
console.log("GUC CMS Downloader content script loaded - v3.0.0");

const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);

// Storage helper for preferences
const PREF_KEY_ORGANIZE_FOLDERS = 'guc_cms_organize_folders';
function getOrganizeFoldersPreference() {
  const val = localStorage.getItem(PREF_KEY_ORGANIZE_FOLDERS);
  return val === null ? true : val === 'true'; // Enabled by default
}
function setOrganizeFoldersPreference(enabled) {
  localStorage.setItem(PREF_KEY_ORGANIZE_FOLDERS, enabled ? 'true' : 'false');
}

// Session storage for tracked downloads
function getDownloadedUrls() {
  try {
    const data = sessionStorage.getItem('guc_cms_downloaded_urls');
    return data ? new Set(JSON.parse(data)) : new Set();
  } catch (e) {
    return new Set();
  }
}
function markUrlAsDownloaded(url) {
  try {
    const urls = getDownloadedUrls();
    urls.add(url);
    sessionStorage.setItem('guc_cms_downloaded_urls', JSON.stringify(Array.from(urls)));
  } catch (e) {
    // ignore
  }
}

// --- Filename Sanitization & Cleaning ---
function sanitizeFilename(name) {
  if (!name) return "";
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
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

  // Strip leading or trailing hyphens, dots, underscores
  title = title.replace(/^[-\s._]+|[-\s._]+$/g, '');

  return title;
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

  let folderName = "";
  if (courseCode && courseName) {
    folderName = `${courseCode} - ${courseName}`;
  } else if (courseName) {
    folderName = courseName;
  } else {
    folderName = "Course Materials";
  }

  return {
    courseCode,
    courseName,
    season,
    courseFolder: sanitizeFilename(folderName)
  };
}

function extractWeekFolder(weekBlock, weekIndex) {
  const weekHeader = weekBlock.querySelector('div.card-header h2.text-big');
  let weekTitle = `Week ${weekIndex + 1}`;
  if (weekHeader && weekHeader.textContent) {
    const dateText = weekHeader.textContent.replace(/^Week:\s*/i, '').trim();
    if (dateText) {
      weekTitle = `Week ${weekIndex + 1} (${dateText})`;
    }
  }
  return sanitizeFilename(weekTitle);
}

// --- Item Details Extraction ---
function extractItemDetails(itemElement, weekInfo) {
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
    weekFolder: weekInfo.weekFolder,
    courseFolder: weekInfo.courseFolder,
    domElements: {
      downloadButtonAnchor: downloadButtonAnchor,
      itemRowElement: itemElement,
      titleDiv: titleDiv
    }
  };
}

// Build final download relative path based on user preference
function buildDownloadPath(item) {
  const organize = getOrganizeFoldersPreference();
  if (!organize) {
    return item.filename;
  }
  const courseFolder = item.courseFolder || "Course Materials";
  const weekFolder = item.weekFolder || "General";
  return `GUC CMS/${courseFolder}/${weekFolder}/${item.filename}`;
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
    toast.style.cssText = 'background: #ffffff; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.18); border-left: 5px solid #007bff; overflow: hidden; padding: 14px 16px; margin-top: 10px; transition: all 0.25s ease; pointer-events: auto;';
    toastContainer.appendChild(toast);
  }

  if (isSuccess) {
    toast.style.borderLeftColor = '#28a745';
  } else if (isError) {
    toast.style.borderLeftColor = '#dc3545';
  } else {
    toast.style.borderLeftColor = '#007bff';
  }

  let progressBarHtml = '';
  if (progress !== null && typeof progress === 'number') {
    progressBarHtml = `
      <div style="background: #e9ecef; border-radius: 4px; height: 6px; width: 100%; margin-top: 10px; overflow: hidden;">
        <div style="background: #007bff; height: 100%; width: ${Math.min(100, Math.max(0, progress))}%; transition: width 0.2s ease;"></div>
      </div>
    `;
  }

  toast.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
      <strong style="color: #212529; font-size: 14px; font-weight: 600;">${title}</strong>
      <button style="background: none; border: none; font-size: 18px; cursor: pointer; color: #6c757d; line-height: 1; padding: 0 0 0 8px;" id="guc-toast-close">&times;</button>
    </div>
    <div style="font-size: 13px; color: #495057; margin-top: 5px; word-break: break-word;">${message}</div>
    ${progressBarHtml}
  `;

  const closeBtn = toast.querySelector('#guc-toast-close');
  if (closeBtn) {
    closeBtn.onclick = () => {
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
    }, 4500);
  }
}

// Listen to download progress from background script
if (browserAPI && browserAPI.runtime && browserAPI.runtime.onMessage) {
  browserAPI.runtime.onMessage.addListener((message) => {
    if (message.action === "downloadProgress") {
      const pct = Math.round((message.current / message.total) * 100);
      if (message.done) {
        showToast(
          "Download Complete!",
          `Successfully queued all ${message.total} files.`,
          100,
          true,
          false
        );
      } else {
        showToast(
          `Downloading (${message.current}/${message.total})...`,
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
  markUrlAsDownloaded(item.url);
  updateItemDownloadedBadge(item);

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

  // Mark all as downloaded in session
  items.forEach(it => {
    markUrlAsDownloaded(it.url);
    updateItemDownloadedBadge(it);
  });

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

function updateItemDownloadedBadge(item) {
  const row = item.domElements.itemRowElement;
  if (!row) return;
  let badge = row.querySelector('.guc-downloaded-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'badge badge-success ml-2 guc-downloaded-badge';
    badge.textContent = '✓ Downloaded';
    badge.style.fontSize = '11px';
    badge.style.padding = '5px 8px';
    badge.style.verticalAlign = 'middle';
    const anchor = item.domElements.downloadButtonAnchor;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.appendChild(badge);
    }
  } else {
    badge.style.display = 'inline-block';
  }
}

// --- Checkbox & Selection State ---
let allDiscoveredItems = [];
const selectedItemUrls = new Set();

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
  if (isChecked) {
    selectedItemUrls.add(item.url);
  } else {
    selectedItemUrls.delete(item.url);
  }
  updateSelectedCountUI();
}

// --- Main Page Processor ---
function processWeeks() {
  const weekBlocks = document.querySelectorAll('div.card.mb-5.weeksdata');
  if (weekBlocks.length === 0) {
    console.warn("GUC CMS Downloader: No week blocks found.");
    return;
  }

  const courseMeta = extractCourseMetadata();
  const downloadedSet = getDownloadedUrls();
  allDiscoveredItems = [];

  weekBlocks.forEach((weekBlock, weekIndex) => {
    const weekFolder = extractWeekFolder(weekBlock, weekIndex);
    const weekInfo = {
      courseFolder: courseMeta.courseFolder,
      weekFolder: weekFolder,
      weekIndex: weekIndex
    };

    const contentItemsElements = weekBlock.querySelectorAll('div.p-3 > div:last-of-type > div.card.mb-4');
    const itemsInThisWeek = [];

    contentItemsElements.forEach(itemElement => {
      const details = extractItemDetails(itemElement, weekInfo);
      if (!details) return;

      allDiscoveredItems.push(details);
      itemsInThisWeek.push(details);

      // Check if already downloaded in this session
      if (downloadedSet.has(details.url)) {
        updateItemDownloadedBadge(details);
      }

      // Inject Item Checkbox
      const body = itemElement.querySelector('.card-body');
      if (body && !body.querySelector('.guc-item-select-checkbox')) {
        const checkboxWrapper = document.createElement('div');
        checkboxWrapper.className = 'guc-checkbox-wrapper mb-2 d-flex align-items-center';
        checkboxWrapper.innerHTML = `
          <input type="checkbox" class="guc-item-select-checkbox mr-2" style="width: 17px; height: 17px; cursor: pointer;">
          <small class="text-muted" style="cursor: pointer; user-select: none;">Select for download</small>
        `;
        const cb = checkboxWrapper.querySelector('input');
        cb.checked = selectedItemUrls.has(details.url);
        cb.addEventListener('change', (e) => {
          onItemCheckboxChanged(details, e.target.checked);
        });
        checkboxWrapper.querySelector('small').addEventListener('click', () => {
          cb.checked = !cb.checked;
          onItemCheckboxChanged(details, cb.checked);
        });

        // Insert at the beginning of card body
        body.insertBefore(checkboxWrapper, body.firstChild);
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
          bulkWeekButton.textContent = `Download Week Files (${itemsInThisWeek.length})`;
          bulkWeekButton.className = 'btn btn-success btn-sm mb-2 guc-download-week-button';
          bulkWeekButton.addEventListener('click', () => {
            requestBulkDownload(itemsInThisWeek, weekFolder);
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

  // Remove existing if re-rendering
  const existing = document.querySelector('.guc-global-bulk-panel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.className = 'card mb-4 border-primary guc-global-bulk-panel shadow-sm';
  panel.style.borderRadius = '10px';
  panel.style.overflow = 'hidden';

  const isOrganizeChecked = getOrganizeFoldersPreference();

  panel.innerHTML = `
    <div class="card-header bg-light d-flex justify-content-between align-items-center flex-wrap" style="padding: 10px 18px;">
      <div class="font-weight-bold text-primary d-flex align-items-center">
        <span style="font-size: 16px; margin-right: 6px;">📥</span>
        GUC CMS Downloader <span class="badge badge-primary ml-2" style="font-size: 10px;">v3.0.0</span>
      </div>
      <div class="d-flex align-items-center flex-wrap mt-1 mt-md-0">
        <label class="mb-0 font-weight-normal small mr-3" style="cursor: pointer; user-select: none;">
          <input type="checkbox" id="guc-pref-folders" class="mr-1" style="vertical-align: middle;" ${isOrganizeChecked ? 'checked' : ''}>
          Organize into Course & Week folders
        </label>
        <button class="btn btn-outline-secondary btn-sm mr-2 py-0 px-2" id="guc-select-all-btn" style="font-size: 12px; height: 26px;">Select All</button>
        <button class="btn btn-outline-secondary btn-sm py-0 px-2" id="guc-deselect-all-btn" style="font-size: 12px; height: 26px;">Deselect All</button>
      </div>
    </div>
    <div class="card-body" style="padding: 14px 18px;">
      <div class="d-flex align-items-center flex-wrap mb-2">
        <button class="btn btn-info btn-sm mr-2 mb-2 font-weight-bold shadow-sm" id="guc-download-all-btn">
          Download All Course Files (<span class="guc-total-count">${allItems.length}</span>)
        </button>
        <button class="btn btn-secondary btn-sm mr-2 mb-2 font-weight-bold shadow-sm" id="guc-download-selected-btn" disabled>
          Download Selected (<span class="guc-selected-count">${selectedItemUrls.size}</span>)
        </button>
      </div>
      <div class="guc-category-buttons-container pt-2 border-top">
        <small class="text-muted d-block mb-2 font-weight-bold">Download by Category:</small>
        <div class="guc-categories-row d-flex flex-wrap"></div>
      </div>
    </div>
  `;

  // Attach preference toggle listener
  const folderPrefCb = panel.querySelector('#guc-pref-folders');
  folderPrefCb.addEventListener('change', (e) => {
    setOrganizeFoldersPreference(e.target.checked);
    showToast(
      "Folder Organization",
      e.target.checked ? "Files will be saved in Course & Week folders." : "Files will be saved directly in Downloads root.",
      null,
      true,
      false
    );
  });

  // Select / Deselect All
  panel.querySelector('#guc-select-all-btn').addEventListener('click', () => {
    allItems.forEach(it => {
      selectedItemUrls.add(it.url);
      const cb = it.domElements.itemRowElement.querySelector('.guc-item-select-checkbox');
      if (cb) cb.checked = true;
    });
    document.querySelectorAll('.guc-week-select-all').forEach(cb => cb.checked = true);
    updateSelectedCountUI();
  });

  panel.querySelector('#guc-deselect-all-btn').addEventListener('click', () => {
    selectedItemUrls.clear();
    allItems.forEach(it => {
      const cb = it.domElements.itemRowElement.querySelector('.guc-item-select-checkbox');
      if (cb) cb.checked = false;
    });
    document.querySelectorAll('.guc-week-select-all').forEach(cb => cb.checked = false);
    updateSelectedCountUI();
  });

  // Download All
  panel.querySelector('#guc-download-all-btn').addEventListener('click', () => {
    requestBulkDownload(allItems, `${courseMeta.courseName || 'All Course'} Files`);
  });

  // Download Selected
  panel.querySelector('#guc-download-selected-btn').addEventListener('click', () => {
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
      btn.className = 'btn btn-outline-primary btn-sm mr-2 mb-2 font-weight-normal shadow-sm';
      btn.innerHTML = `${cat.label} <span class="badge badge-light border ml-1">${filtered.length}</span>`;
      btn.addEventListener('click', () => {
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
