console.log("CMS Downloader content script loaded");

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
  const downloadButtonAnchor = itemElement.querySelector('a.btn.btn-primary.contentbtn[id="download"]');
  const watchVideoButtonInput = itemElement.querySelector('input.btn.btn-primary.vodbutton.contentbtn[value="Watch Video"]');

  if (!titleDiv) { return null; }

  // --- Determine if this is a VoD item based on visible "Watch Video" button ---
  // --- or if the "Download Content" link is explicitly hidden ---
  let isLikelyVoD = false;
  if (watchVideoButtonInput && getComputedStyle(watchVideoButtonInput).display !== 'none') {
    isLikelyVoD = true;
  }
  if (downloadButtonAnchor && getComputedStyle(downloadButtonAnchor).display === 'none' && watchVideoButtonInput) {
    // If download link is hidden and there's a watch button, it's definitely a VoD for our purposes
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
        if (typeMatch && typeMatch[1]) { itemType = typeMatch[1].toLowerCase().trim(); }
        break;
      }
      currentNode = currentNode.nextSibling;
    }
  } else {
    rawTitleFromStrong = titleDiv.textContent.trim();
  }

  // If itemType explicitly says "vod", then it IS a VoD.
  if (itemType.includes("vod")) {
    isLikelyVoD = true;
  }

  // --- IF IT'S A VOD, IGNORE IT COMPLETELY FOR THE EXTENSION ---
  if (isLikelyVoD) {
    console.log(`extractItemDetails: Item "${rawTitleFromStrong}" identified as VoD. Skipping.`);
    return null; // Skip this item entirely
  }

  // --- If it's NOT a VoD, proceed to get download URL and details ---
  // At this point, we expect downloadButtonAnchor to be valid and visible
  if (!downloadButtonAnchor || getComputedStyle(downloadButtonAnchor).display === 'none' || !downloadButtonAnchor.hasAttribute('href')) {
    console.warn(`extractItemDetails: Non-VoD item "${rawTitleFromStrong}" is missing a visible download link or href. Skipping.`);
    return null; // Skip if no valid download link for a non-VoD
  }

  const downloadUrl = getAbsoluteUrl(downloadButtonAnchor.getAttribute('href'));
  if (!downloadUrl) {
    console.warn(`extractItemDetails: Non-VoD item "${rawTitleFromStrong}" produced a null URL. Skipping.`);
    return null;
  }

  // --- Filename Generation ---
  let baseTitle = rawTitleFromStrong.replace(/^\d+\s*-\s*/, '').trim();
  let finalCleanedTitleForFilename;
  const isLectureType = itemType.includes('lecture') || baseTitle.toLowerCase().startsWith('lecture');
  const isTutorialType = itemType.includes('tutorial') || baseTitle.toLowerCase().startsWith('tutorial');

  if (isLectureType) { const match = baseTitle.match(/^(lecture)\s*(\d+)/i); if (match) { finalCleanedTitleForFilename = `Lecture ${match[2]}`; } else { finalCleanedTitleForFilename = baseTitle; }} 
  else if (isTutorialType) { const match = baseTitle.match(/^(tutorial)\s*(\d+)/i); if (match) { finalCleanedTitleForFilename = `Tutorial ${match[2]}`; } else { finalCleanedTitleForFilename = baseTitle; }} 
  else { finalCleanedTitleForFilename = baseTitle; }
  
  const sanitizedFilenamePart = sanitizeFilename(finalCleanedTitleForFilename);
  const originalFilenameFromServer = downloadUrl.substring(downloadUrl.lastIndexOf('/') + 1).split('?')[0];
  let extension = originalFilenameFromServer.substring(originalFilenameFromServer.lastIndexOf('.'));
  
  if (!extension.includes('.')) { extension = ".file"; }
  if (extension === ".file") { // More specific extension guessing if needed
      if (itemType.includes('project')) { extension = ".pdf"; } 
      else if ((itemType.includes('lecture') || itemType.includes('tutorial')) && (downloadUrl.includes('.ppt') || downloadUrl.includes('.pptx')) ) {
        if(downloadUrl.includes('.pptx')) extension = ".pptx"; else if(downloadUrl.includes('.ppt')) extension = ".ppt";
      }
  }
  const filename = `${sanitizedFilenamePart}${extension}`;

  const dataForDownload = {
    originalTitle: titleDiv.textContent.trim(),
    cleanedTitleForFilter: baseTitle.toLowerCase(), 
    itemType: itemType,
    url: downloadUrl, 
    filename: filename,
    isVod: false // Will always be false if we reach here
  };

  return {
      dataForDownload: dataForDownload, 
      domElements: { 
          originalDownloadLinkElement: downloadButtonAnchor, 
          // originalWatchVideoButton is not needed if we fully ignore VoDs for modification
          itemRowElement: itemElement
      }
  };
}

async function requestSingleDownload(itemDataForDownload) {
  // This function is now only called for non-VoD items with valid URLs
  console.log(`Content: Requesting single download for ${itemDataForDownload.filename}`);
  try {
    const response = await browser.runtime.sendMessage({
      action: "downloadFile",
      url: itemDataForDownload.url,
      filename: itemDataForDownload.filename,
      isVod: false 
    });
    if (response && response.success) { console.log(`Content: Single download initiated for ${itemDataForDownload.filename}`); } 
    else { console.error(`Content: Single download failed for ${itemDataForDownload.filename}. Response:`, response); }
  } catch (error) { console.error(`Content: Error sending single download message for ${itemDataForDownload.filename}:`, error); }
}

async function requestBulkDownload(itemsDataForDownload, description) {
  // itemsDataForDownload here should already contain only non-VoD items
  if (itemsDataForDownload.length === 0) { alert(`No files to download for: ${description}`); return; }
  alert(`Starting bulk download for ${itemsDataForDownload.length} files: ${description}.`); 
  console.log(`Content: Requesting bulk download for ${itemsDataForDownload.length} items: ${description}`);
  try {
    const response = await browser.runtime.sendMessage({
      action: "bulkDownloadFiles",
      items: itemsDataForDownload.map(item => ({ // Ensure we only send what background needs
          url: item.url,
          filename: item.filename,
          isVod: item.isVod // will be false
      }))
    });
    if (response && response.success) { console.log(`Content: Bulk download request sent for "${description}". Background script processing.`); } 
    else { console.error(`Content: Bulk download request failed for "${description}". Response:`, response); alert(`Could not start bulk download for "${description}".`); }
  } catch (error) { console.error(`Content: Error sending bulk download message for "${description}":`, error); alert(`Error occurred when trying to start bulk download for "${description}".`); }
}

function processWeeks() {
  console.log("processWeeks: Starting to process week blocks...");
  const weekBlocks = document.querySelectorAll('div.card.mb-5.weeksdata');
  if (weekBlocks.length === 0) { console.warn("processWeeks: No week blocks found."); return; }
  const allItemsDataForBulk = []; 

  weekBlocks.forEach((weekBlock, weekIndex) => {
    const weekHeader = weekBlock.querySelector('div.card-header h2.text-big');
    let weekDateForButton = `Week ${weekIndex + 1}`;
    if (weekHeader && weekHeader.textContent) { const weekHeaderText = weekHeader.textContent.trim(); const datePart = weekHeaderText.replace('Week:', '').trim(); if (datePart) weekDateForButton = datePart; }
    
    const contentItemsElements = weekBlock.querySelectorAll('div.p-3 > div:last-of-type > div.card.mb-4');
    const itemsDataInThisWeekForBulk = []; 

    contentItemsElements.forEach(itemElement => {
      const extracted = extractItemDetails(itemElement, weekDateForButton); 
      
      // Only proceed if extracted is not null (meaning it's a valid, non-VoD item)
      if (extracted && extracted.dataForDownload) {
        const details = extracted.dataForDownload; // This is a non-VoD item
        const dom = extracted.domElements;

        allItemsDataForBulk.push(details);
        itemsDataInThisWeekForBulk.push(details);

        // dom.originalDownloadLinkElement should be valid here because extractItemDetails would have returned null otherwise
        if (dom.originalDownloadLinkElement && !dom.originalDownloadLinkElement.dataset.gucCmsDownloaderListener) {
          // console.log(`processWeeks: Attaching listener to: "${details.cleanedTitleForFilter}"`);
          dom.originalDownloadLinkElement.addEventListener('click', function(event) { 
            event.preventDefault();
            event.stopPropagation(); 
            console.log("CUSTOM CLICK LISTENER FIRED for single download:", details.filename); 
            requestSingleDownload(details); 
          }, true); 
          dom.originalDownloadLinkElement.dataset.gucCmsDownloaderListener = "true";
        } else if (!dom.originalDownloadLinkElement) {
            // This warning should ideally not appear if extractItemDetails is correct
            console.warn(`processWeeks: Listener not attached. No downloadLinkElement for non-VoD item: "${details.cleanedTitleForFilter}" (This indicates an issue in extractItemDetails).`);
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
  addGlobalBulkButtons(allItemsDataForBulk); 
  console.log("processWeeks: Finished processing all week blocks.");
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

function init() {
    console.log("CMS Downloader: Initializing...");
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