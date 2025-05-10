// content_script.js (v2.0 - VoD Buttons Removed)

console.log("GUC CMS Downloader content script loaded - v1.9");

// sanitizeFilename, getAbsoluteUrl - (Same as v1.11)
// extractItemDetails - (Will still identify VoDs but no dacastContentId needed if not used)
// requestSingleDownload, requestBulkDownload - (Same as v1.11, but won't be called for VoD by new buttons)
// processWeeks - (MAJOR CHANGE: Will not add any new buttons for VoD items)
// addGlobalBulkButtons, init, observer - (Same as v1.11)

function sanitizeFilename(name) {
  let sane = name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
  if (sane.length > 200) { sane = sane.substring(0, 200).trim(); }
  return sane;
}

function getAbsoluteUrl(hrefOrDataUrl) {
    if (!hrefOrDataUrl) return null;
    if (hrefOrDataUrl.startsWith('http://') || hrefOrDataUrl.startsWith('https://')) { return hrefOrDataUrl; }
    if (hrefOrDataUrl.startsWith('/')) { return `https://cms.guc.edu.eg${hrefOrDataUrl}`; }
    return `https://cms.guc.edu.eg/${hrefOrDataUrl}`;
}

function extractItemDetails(itemElement, weekInfo) {
  const titleDiv = itemElement.querySelector('div[id^="content"]');
  let originalDownloadLinkElement = itemElement.querySelector('a.btn.btn-primary.contentbtn[id="download"]');
  const originalWatchVideoButton = itemElement.querySelector('input.btn.btn-primary.vodbutton.contentbtn[value="Watch Video"]');

  if (!titleDiv) { return null; }

  let isVod = false;
  let downloadUrl; // Will be null for VoDs if we don't use their direct links

  let rawTitleFromStrong = ""; 
  const strongTag = titleDiv.querySelector('strong');
  if(strongTag) { rawTitleFromStrong = strongTag.textContent.trim(); } 
  else { rawTitleFromStrong = titleDiv.textContent.trim(); }

  if (originalWatchVideoButton && (!originalDownloadLinkElement || getComputedStyle(originalDownloadLinkElement).display === 'none')) {
    isVod = true;
    // For VoDs, we are no longer attempting to use their direct download links from the extension
    downloadUrl = null; 
    // console.log(`VoD ("${rawTitleFromStrong}"): Identified. Download via extension disabled.`);
  } else if (originalDownloadLinkElement && originalDownloadLinkElement.hasAttribute('href')) {
    downloadUrl = getAbsoluteUrl(originalDownloadLinkElement.getAttribute('href'));
  } else { return null; }

  // If it's a VoD, downloadUrl will be null, so no download will be attempted by the extension.
  // If it's not a VoD but has no valid link, it would have returned null earlier.

  let itemType = "";
  if (strongTag) {
    let currentNode = strongTag.nextSibling;
    while (currentNode) {
      if (currentNode.nodeType === Node.TEXT_NODE && currentNode.textContent.trim() !== "") {
        const typeMatch = currentNode.textContent.trim().match(/\(([^)]+)\)/);
        if (typeMatch && typeMatch[1]) { itemType = typeMatch[1].toLowerCase().trim(); if (itemType === "vod" && !isVod) { isVod = true; }}
        break;
      }
      currentNode = currentNode.nextSibling;
    }
  }
  if(isVod && !itemType && titleDiv.textContent.toLowerCase().includes('(vod)')){ itemType = "vod"; }

  let baseTitle = rawTitleFromStrong.replace(/^\d+\s*-\s*/, '').trim();
  let finalCleanedTitleForFilename;
  const isLecture = itemType.includes('lecture') || baseTitle.toLowerCase().startsWith('lecture');
  const isTutorial = itemType.includes('tutorial') || baseTitle.toLowerCase().startsWith('tutorial');

  if (isLecture) { const match = baseTitle.match(/^(lecture)\s*(\d+)/i); if (match) { finalCleanedTitleForFilename = `Lecture ${match[2]}`; } else { finalCleanedTitleForFilename = baseTitle; }} 
  else if (isTutorial) { const match = baseTitle.match(/^(tutorial)\s*(\d+)/i); if (match) { finalCleanedTitleForFilename = `Tutorial ${match[2]}`; } else { finalCleanedTitleForFilename = baseTitle; }} 
  else { finalCleanedTitleForFilename = baseTitle; }
  
  const sanitizedFilenamePart = sanitizeFilename(finalCleanedTitleForFilename);
  let extension = ".file"; 
  
  if (downloadUrl) { // Only attempt to get extension if there's a downloadUrl (i.e., not a VoD handled by us)
    const originalFilenameFromServer = downloadUrl.substring(downloadUrl.lastIndexOf('/') + 1).split('?')[0];
    let extPart = originalFilenameFromServer.substring(originalFilenameFromServer.lastIndexOf('.'));
    if (extPart.includes('.')) { extension = extPart; }
  } else if (isVod) {
      extension = ".mp4"; // Still good to have a nominal extension for VoD items for consistency if data structure needs it
  }


  if (extension === ".file" && !isVod && itemType.includes('project')) { extension = ".pdf"; } 
  else if (extension === ".file" && !isVod && (itemType.includes('lecture') || itemType.includes('tutorial')) && downloadUrl && (downloadUrl.includes('.ppt') || downloadUrl.includes('.pptx')) ) {
    if(downloadUrl.includes('.pptx')) extension = ".pptx"; else if(downloadUrl.includes('.ppt')) extension = ".ppt";
  }
  const filename = `${sanitizedFilenamePart}${extension}`;

  const dataForDownload = {
    originalTitle: titleDiv.textContent.trim(),
    cleanedTitleForFilter: baseTitle.toLowerCase(), 
    itemType: itemType,
    url: downloadUrl, // Will be null for VoDs the extension won't try to download
    filename: filename,
    isVod: isVod
  };

  return {
      dataForDownload: dataForDownload, // For background script IF we were to send, or for filtering
      domElements: { originalDownloadLinkElement, originalWatchVideoButton, itemRowElement }
  };
}

// requestSingleDownload: Will only be called for non-VoD items from modified event listeners
async function requestSingleDownload(itemDataForDownload) {
  if (itemDataForDownload.isVod || !itemDataForDownload.url) {
      // This case should ideally not be hit by direct calls from new buttons
      // if VoD buttons are removed and URL check is done before calling.
      console.warn(`Content: requestSingleDownload called for VoD or null URL. Filename: ${itemDataForDownload.filename}. This download will be skipped by the extension.`);
      return; 
  }
  console.log(`Content: Requesting single download for ${itemDataForDownload.filename}`);
  try {
    const response = await browser.runtime.sendMessage({
      action: "downloadFile",
      url: itemDataForDownload.url,
      filename: itemDataForDownload.filename,
      isVod: itemDataForDownload.isVod // Should be false here
    });
    if (response && response.success) { console.log(`Content: Single download initiated for ${itemDataForDownload.filename}`); } 
    else { console.error(`Content: Single download failed for ${itemDataForDownload.filename}. Response:`, response); }
  } catch (error) { console.error(`Content: Error sending single download message for ${itemDataForDownload.filename}:`, error); }
}

// requestBulkDownload: The items array will already have VoDs filtered out by processWeeks
async function requestBulkDownload(itemsDataForDownload, description) {
  if (itemsDataForDownload.length === 0) { alert(`No files to download for: ${description}`); return; }
  alert(`Starting bulk download for ${itemsDataForDownload.length} files: ${description}.`); 
  console.log(`Content: Requesting bulk download for ${itemsDataForDownload.length} items: ${description}`);
  try {
    // Filter out VoDs one last time, just in case, though they shouldn't be in itemsDataForDownload for bulk
    const nonVodItems = itemsDataForDownload.filter(item => !item.isVod && item.url);
    if (nonVodItems.length === 0) {
        alert(`No downloadable non-video files found for: ${description}`);
        return;
    }
    const response = await browser.runtime.sendMessage({
      action: "bulkDownloadFiles",
      items: nonVodItems.map(item => ({ 
          url: item.url,
          filename: item.filename,
          isVod: item.isVod // Will be false
      }))
    });
    if (response && response.success) { console.log(`Content: Bulk download request sent for "${description}". Background script processing.`); } 
    else { console.error(`Content: Bulk download request failed for "${description}". Response:`, response); alert(`Could not start bulk download for "${description}".`); }
  } catch (error) { console.error(`Content: Error sending bulk download message for "${description}":`, error); alert(`Error occurred when trying to start bulk download for "${description}".`); }
}


function processWeeks() {
  const weekBlocks = document.querySelectorAll('div.card.mb-5.weeksdata');
  const allItemsDataForBulk = []; // This will ONLY store non-VoD items

  weekBlocks.forEach((weekBlock, weekIndex) => {
    const weekHeader = weekBlock.querySelector('div.card-header h2.text-big');
    let weekDateForButton = `Week ${weekIndex + 1}`;
    if (weekHeader && weekHeader.textContent) { const weekHeaderText = weekHeader.textContent.trim(); const datePart = weekHeaderText.replace('Week:', '').trim(); if (datePart) weekDateForButton = datePart; }
    const currentWeekIdentifier = `Week_${weekDateForButton.replace(/-/g, '_')}`;
    const contentItemsElements = weekBlock.querySelectorAll('div.p-3 > div:last-of-type > div.card.mb-4');
    const itemsDataInThisWeekForBulk = []; // ONLY non-VoD items

    contentItemsElements.forEach(itemElement => {
      const extracted = extractItemDetails(itemElement, currentWeekIdentifier);
      if (extracted && extracted.dataForDownload) {
        const details = extracted.dataForDownload;
        const dom = extracted.domElements;

        if (details.isVod) {
          // --- NO BUTTONS ADDED FOR VOD ITEMS ---
          // The original "Watch Video" button remains untouched.
          console.log(`Identified VoD: "${details.cleanedTitleForFilter}". Extension will not add download buttons.`);
        } else { // Non-VoD file
          // Ensure URL is present for non-VoD items we intend to download
          if (details.url) { 
            allItemsDataForBulk.push(details);
            itemsDataInThisWeekForBulk.push(details);

            if (dom.downloadLinkElement && !dom.downloadLinkElement.dataset.listenerAttached) {
              dom.downloadLinkElement.addEventListener('click', (event) => {
                event.preventDefault();
                requestSingleDownload(details); // This will use background for now
              });
              dom.downloadLinkElement.dataset.listenerAttached = "true";
            }
          } else {
            console.warn(`Skipping non-VoD item "${details.cleanedTitleForFilter}" due to missing URL.`);
          }
        }
      }
    });

    if (itemsDataInThisWeekForBulk.length > 0 && weekHeader) {
      const buttonHost = weekHeader.closest('.card-header').querySelector('.col-lg-6.col-md-6.col-sm-12:last-child .menu-header-title.text-right');
      if (buttonHost && !buttonHost.querySelector('.guc-download-week-button')) {
        const bulkWeekButton = document.createElement('button');
        bulkWeekButton.textContent = `Download Week Files - ${weekDateForButton}`;
        bulkWeekButton.className = 'btn btn-success btn-sm mb-2 guc-download-week-button';
        bulkWeekButton.style.marginRight = '10px';
        bulkWeekButton.addEventListener('click', () => { requestBulkDownload(itemsDataInThisWeekForBulk, `Week ${weekDateForButton} Files`); });
        buttonHost.prepend(bulkWeekButton);
      }
    }
  });
  addGlobalBulkButtons(allItemsDataForBulk); // Pass only non-VoD items
}

// addGlobalBulkButtons (same as v1.8/1.5, it operates on nonVodItemsData)
function addGlobalBulkButtons(nonVodItemsData) {
  const insertionPoint = document.getElementById('ContentPlaceHolderright_ContentPlaceHoldercontent_desc');
  let buttonContainerParent;

  if (insertionPoint) { buttonContainerParent = insertionPoint.parentNode; } 
  else { const fallbackInsertionPoint = document.querySelector('.app-page-title'); if (fallbackInsertionPoint) { buttonContainerParent = fallbackInsertionPoint.parentNode; console.warn("Primary insertion point for global buttons not found, using fallback after .app-page-title."); } 
  else { console.error("Global buttons: Critical. Neither primary nor fallback insertion point found."); return; } }
  
  if (buttonContainerParent.querySelector('.guc-global-bulk-buttons')) { console.log("Global bulk buttons already exist."); return; }
  if (nonVodItemsData.length === 0) { console.log("No non-VoD items found for global bulk download buttons."); return; }

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'mt-3 mb-3 p-3 border rounded guc-global-bulk-buttons';
  const downloadAllCourseButton = document.createElement('button');
  downloadAllCourseButton.textContent = 'Download All Course Files';
  downloadAllCourseButton.className = 'btn btn-info mr-2 mb-2 btn-sm';
  downloadAllCourseButton.addEventListener('click', () => { requestBulkDownload(nonVodItemsData, 'All Course Files'); });
  buttonContainer.appendChild(downloadAllCourseButton);

  const filterTypes = [
    { label: 'Tutorials', customFilter: item => item.itemType.includes('tutorial') || item.cleanedTitleForFilter.startsWith('tutorial') },
    { label: 'Lectures', customFilter: item => item.itemType.includes('lecture') || item.cleanedTitleForFilter.startsWith('lecture') },
    { label: 'Projects', customFilter: item => item.itemType.includes('project') },
    { label: 'Assignments', customFilter: item => item.itemType.includes('assignment') },
    { label: 'Sheets', customFilter: item => item.cleanedTitleForFilter.startsWith('sheet ') && !item.cleanedTitleForFilter.startsWith('solution sheet') && (item.itemType.includes('exercise') || item.itemType.includes('sheet'))},
    { label: 'Sheet Solutions', customFilter: item => item.cleanedTitleForFilter.startsWith('solution sheet') && (item.itemType.includes('exercise') || item.itemType.includes('solution'))}
  ];

  filterTypes.forEach(filter => {
    let filteredItems;
    if (filter.customFilter) { filteredItems = nonVodItemsData.filter(filter.customFilter); } 
    else if (filter.keyword) { filteredItems = nonVodItemsData.filter(item => item.itemType.includes(filter.keyword));} 
    else { filteredItems = []; }
    if (filteredItems.length > 0) {
      const button = document.createElement('button');
      button.textContent = `Download All ${filter.label}`;
      button.className = 'btn btn-warning mr-2 mb-2 btn-sm';
      button.addEventListener('click', () => { requestBulkDownload(filteredItems, `All ${filter.label}`); });
      buttonContainer.appendChild(button);
    }
  });
  if (insertionPoint) { buttonContainerParent.insertBefore(buttonContainer, insertionPoint.nextSibling); } 
  else if (document.querySelector('.app-page-title')) { document.querySelector('.app-page-title').parentNode.insertBefore(buttonContainer, document.querySelector('.app-page-title').nextSibling); }
}

// --- Main Execution & Observer --- (remains same)
function init() {
    console.log("GUC CMS Downloader: Initializing v1.12");
    processWeeks();
}
const observer = new MutationObserver((mutationsList, obs) => {
    for(const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            let addedRelevantContent = false;
            mutation.addedNodes.forEach(node => { if (node.nodeType === Node.ELEMENT_NODE && (node.classList.contains('weeksdata') || node.querySelector('.weeksdata'))) { addedRelevantContent = true; }});
            if(addedRelevantContent){ console.log("GUC CMS Downloader: DOM changes, re-processing."); setTimeout(init, 500); break; }
        }
    }
});
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    init();
    const mainContentArea = document.querySelector('.app-main__inner .container-fluid.p-0.m-0') || document.querySelector('.app-main__inner');
    if (mainContentArea) { observer.observe(mainContentArea, { childList: true, subtree: true }); console.log("MutationObserver started:", mainContentArea); } 
    else { console.error("GUC CMS Downloader: Observer target not found.");}
  });
} else {
  init();
  const mainContentArea = document.querySelector('.app-main__inner .container-fluid.p-0.m-0') || document.querySelector('.app-main__inner');
  if (mainContentArea) { observer.observe(mainContentArea, { childList: true, subtree: true }); console.log("MutationObserver started:", mainContentArea); } 
  else { console.error("GUC CMS Downloader: Observer target not found."); }
}