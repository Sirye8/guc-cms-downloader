// content_script.js (v1.8 - Special Naming for Lec/Tut - Full Script)

console.log("GUC CMS Downloader content script loaded - v1.8 (Lec/Tut Naming)");

function sanitizeFilename(name) {
  let sane = name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
  if (sane.length > 200) {
    sane = sane.substring(0, 200).trim();
  }
  return sane;
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

function extractItemDetails(itemElement, weekInfo) {
  const titleDiv = itemElement.querySelector('div[id^="content"]');
  let originalDownloadLinkElement = itemElement.querySelector('a.btn.btn-primary.contentbtn[id="download"]');
  const originalWatchVideoButton = itemElement.querySelector('input.btn.btn-primary.vodbutton.contentbtn[value="Watch Video"]');

  if (!titleDiv) {
    return null;
  }

  let isVod = false;
  let downloadUrl;

  if (originalWatchVideoButton && (!originalDownloadLinkElement || getComputedStyle(originalDownloadLinkElement).display === 'none')) {
    isVod = true;
    if (originalDownloadLinkElement && originalDownloadLinkElement.hasAttribute('href')) {
        downloadUrl = getAbsoluteUrl(originalDownloadLinkElement.getAttribute('href'));
    } else if (originalWatchVideoButton.hasAttribute('data-url')) {
        downloadUrl = getAbsoluteUrl(originalWatchVideoButton.getAttribute('data-url'));
    }
  } else if (originalDownloadLinkElement && originalDownloadLinkElement.hasAttribute('href')) {
    downloadUrl = getAbsoluteUrl(originalDownloadLinkElement.getAttribute('href'));
  } else {
    return null;
  }

  if (!downloadUrl) {
    return null;
  }

  let rawTitleFromStrong = ""; // Title from <strong> tag
  let itemType = "";         // Text from (parentheses)

  const strongTag = titleDiv.querySelector('strong');
  if (strongTag) {
    rawTitleFromStrong = strongTag.textContent.trim();
    let currentNode = strongTag.nextSibling;
    while (currentNode) {
      if (currentNode.nodeType === Node.TEXT_NODE && currentNode.textContent.trim() !== "") {
        const typeMatch = currentNode.textContent.trim().match(/\(([^)]+)\)/);
        if (typeMatch && typeMatch[1]) {
          itemType = typeMatch[1].toLowerCase().trim();
          if (itemType === "vod" && !isVod) {
            isVod = true;
          }
        }
        break;
      }
      currentNode = currentNode.nextSibling;
    }
  } else {
    rawTitleFromStrong = titleDiv.textContent.trim();
  }

  let baseTitle = rawTitleFromStrong.replace(/^\d+\s*-\s*/, '').trim();
  let finalCleanedTitleForFilename;

  const isLecture = itemType.includes('lecture') || baseTitle.toLowerCase().startsWith('lecture');
  const isTutorial = itemType.includes('tutorial') || baseTitle.toLowerCase().startsWith('tutorial');

  if (isLecture) {
    const match = baseTitle.match(/^(lecture)\s*(\d+)/i);
    if (match) {
      finalCleanedTitleForFilename = `Lecture ${match[2]}`;
    } else {
      finalCleanedTitleForFilename = baseTitle; 
    }
  } else if (isTutorial) {
    const match = baseTitle.match(/^(tutorial)\s*(\d+)/i);
    if (match) {
      finalCleanedTitleForFilename = `Tutorial ${match[2]}`;
    } else {
      finalCleanedTitleForFilename = baseTitle;
    }
  } else {
    finalCleanedTitleForFilename = baseTitle;
  }
  
  const sanitizedFilenamePart = sanitizeFilename(finalCleanedTitleForFilename);

  const originalFilenameFromServer = downloadUrl.substring(downloadUrl.lastIndexOf('/') + 1).split('?')[0];
  let extension = originalFilenameFromServer.substring(originalFilenameFromServer.lastIndexOf('.'));
  if (!extension.includes('.')) {
      extension = "";
  }
  if (!extension && isVod) {
    extension = ".mp4";
  } else if (!extension && itemType.includes('project')) {
    extension = ".pdf";
  } else if (!extension && (itemType.includes('lecture') || itemType.includes('tutorial')) && (downloadUrl.includes('.ppt') || downloadUrl.includes('.pptx')) ) {
    if(downloadUrl.includes('.pptx')) extension = ".pptx";
    else if(downloadUrl.includes('.ppt')) extension = ".ppt";
  } else if (!extension) {
    extension = ".file";
  }
  
  const filename = `${sanitizedFilenamePart}${extension}`;

  const dataForDownload = {
    originalTitle: titleDiv.textContent.trim(),
    cleanedTitleForFilter: baseTitle.toLowerCase(), 
    itemType: itemType,
    url: downloadUrl,
    filename: filename,
    isVod: isVod
  };

  return {
      dataForDownload: dataForDownload,
      domElements: {
          downloadLinkElement: originalDownloadLinkElement,
          watchVideoButton: originalWatchVideoButton,
          itemRowElement: itemElement
      }
  };
}

async function requestSingleDownload(itemDataForDownload) {
  console.log(`Content: Requesting single download for ${itemDataForDownload.filename}`);
  try {
    const response = await browser.runtime.sendMessage({
      action: "downloadFile",
      url: itemDataForDownload.url,
      filename: itemDataForDownload.filename
    });
    if (response && response.success) {
      console.log(`Content: Single download initiated for ${itemDataForDownload.filename}`);
    } else {
      console.error(`Content: Single download failed for ${itemDataForDownload.filename}. Response:`, response);
    }
  } catch (error) {
    console.error(`Content: Error sending single download message for ${itemDataForDownload.filename}:`, error);
  }
}

async function requestBulkDownload(itemsDataForDownload, description) {
  if (itemsDataForDownload.length === 0) {
    alert(`No files to download for: ${description}`);
    return;
  }
  alert(`Starting bulk download for ${itemsDataForDownload.length} files: ${description}.`); 
  console.log(`Content: Requesting bulk download for ${itemsDataForDownload.length} items: ${description}`);
  try {
    const response = await browser.runtime.sendMessage({
      action: "bulkDownloadFiles",
      items: itemsDataForDownload
    });
    if (response && response.success) {
      console.log(`Content: Bulk download request sent for "${description}". Background script processing.`);
    } else {
      console.error(`Content: Bulk download request failed for "${description}". Response:`, response);
      alert(`Could not start bulk download for "${description}".`);
    }
  } catch (error) {
    console.error(`Content: Error sending bulk download message for "${description}":`, error);
    alert(`Error occurred when trying to start bulk download for "${description}".`);
  }
}

function processWeeks() {
  const weekBlocks = document.querySelectorAll('div.card.mb-5.weeksdata');
  const allItemsDataForBulk = [];

  weekBlocks.forEach((weekBlock, weekIndex) => {
    const weekHeader = weekBlock.querySelector('div.card-header h2.text-big');
    let weekDateForButton = `Week ${weekIndex + 1}`;
    if (weekHeader && weekHeader.textContent) {
      const weekHeaderText = weekHeader.textContent.trim();
      const datePart = weekHeaderText.replace('Week:', '').trim();
      if (datePart) weekDateForButton = datePart;
    }
    const currentWeekIdentifier = `Week_${weekDateForButton.replace(/-/g, '_')}`;

    const contentItemsElements = weekBlock.querySelectorAll('div.p-3 > div:last-of-type > div.card.mb-4');
    const itemsDataInThisWeekForBulk = [];

    contentItemsElements.forEach(itemElement => {
      const extracted = extractItemDetails(itemElement, currentWeekIdentifier);
      if (extracted && extracted.dataForDownload) {
        const details = extracted.dataForDownload;
        const dom = extracted.domElements;

        if (details.isVod) {
          if (dom.watchVideoButton) {
            const buttonContainer = dom.watchVideoButton.parentNode;
            if (buttonContainer && !buttonContainer.querySelector('.guc-download-video-button')) {
                const downloadVideoButton = document.createElement('button');
                downloadVideoButton.textContent = 'Download Video';
                downloadVideoButton.className = 'btn btn-info btn-sm ml-2 guc-download-video-button';
                downloadVideoButton.style.verticalAlign = 'top';
                downloadVideoButton.addEventListener('click', (event) => {
                  event.preventDefault();
                  requestSingleDownload(details);
                });
                const complaintButton = dom.itemRowElement.querySelector('input.btn.btn-danger.complaint');
                if (complaintButton) {
                    buttonContainer.insertBefore(downloadVideoButton, complaintButton);
                } else {
                    buttonContainer.appendChild(downloadVideoButton);
                }
            }
          }
        } else {
          allItemsDataForBulk.push(details);
          itemsDataInThisWeekForBulk.push(details);

          if (dom.downloadLinkElement && !dom.downloadLinkElement.dataset.listenerAttached) {
            dom.downloadLinkElement.addEventListener('click', (event) => {
              event.preventDefault();
              requestSingleDownload(details);
            });
            dom.downloadLinkElement.dataset.listenerAttached = "true";
          }
        }
      } else {
        console.warn("Skipping item in week " + weekDateForButton + " due to missing details during extraction.");
      }
    });

    if (itemsDataInThisWeekForBulk.length > 0 && weekHeader) {
      const buttonHost = weekHeader.closest('.card-header').querySelector('.col-lg-6.col-md-6.col-sm-12:last-child .menu-header-title.text-right');
      if (buttonHost && !buttonHost.querySelector('.guc-download-week-button')) {
        const bulkWeekButton = document.createElement('button');
        bulkWeekButton.textContent = `Download Week Files - ${weekDateForButton}`;
        bulkWeekButton.className = 'btn btn-success btn-sm mb-2 guc-download-week-button';
        bulkWeekButton.style.marginRight = '10px';
        bulkWeekButton.addEventListener('click', () => {
          requestBulkDownload(itemsDataInThisWeekForBulk, `Week ${weekDateForButton} Files`);
        });
        buttonHost.prepend(bulkWeekButton);
      }
    }
  });
  addGlobalBulkButtons(allItemsDataForBulk);
}

function addGlobalBulkButtons(nonVodItemsData) {
  const insertionPoint = document.getElementById('ContentPlaceHolderright_ContentPlaceHoldercontent_desc');
  let buttonContainerParent;

  if (insertionPoint) {
      buttonContainerParent = insertionPoint.parentNode;
  } else {
      const fallbackInsertionPoint = document.querySelector('.app-page-title');
      if (fallbackInsertionPoint) {
          buttonContainerParent = fallbackInsertionPoint.parentNode;
          console.warn("Primary insertion point for global buttons not found, using fallback after .app-page-title.");
      } else {
          console.error("Global buttons: Critical. Neither primary nor fallback insertion point found.");
          return;
      }
  }
  
  if (buttonContainerParent.querySelector('.guc-global-bulk-buttons')) {
    console.log("Global bulk buttons already exist. Skipping regeneration.");
    return;
  }
  if (nonVodItemsData.length === 0) {
    console.log("No non-VoD items found for global bulk download buttons.");
    return;
  }

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'mt-3 mb-3 p-3 border rounded guc-global-bulk-buttons';

  const downloadAllCourseButton = document.createElement('button');
  downloadAllCourseButton.textContent = 'Download All Course Files';
  downloadAllCourseButton.className = 'btn btn-info mr-2 mb-2 btn-sm';
  downloadAllCourseButton.addEventListener('click', () => {
    requestBulkDownload(nonVodItemsData, 'All Course Files');
  });
  buttonContainer.appendChild(downloadAllCourseButton);

  const filterTypes = [
    { label: 'Tutorials', customFilter: item => item.itemType.includes('tutorial') || item.cleanedTitleForFilter.startsWith('tutorial') },
    { label: 'Lectures', customFilter: item => item.itemType.includes('lecture') || item.cleanedTitleForFilter.startsWith('lecture') },
    { label: 'Projects', customFilter: item => item.itemType.includes('project') },
    { label: 'Assignments', customFilter: item => item.itemType.includes('assignment') },
    { 
      label: 'Sheets', 
      customFilter: item => item.cleanedTitleForFilter.startsWith('sheet ') && 
                           !item.cleanedTitleForFilter.startsWith('solution sheet') &&
                           (item.itemType.includes('exercise') || item.itemType.includes('sheet'))
    },
    { 
      label: 'Sheet Solutions', 
      customFilter: item => item.cleanedTitleForFilter.startsWith('solution sheet') &&
                           (item.itemType.includes('exercise') || item.itemType.includes('solution'))
    }
  ];

  filterTypes.forEach(filter => {
    let filteredItems;
    if (filter.customFilter) {
        filteredItems = nonVodItemsData.filter(filter.customFilter);
    } else if (filter.keyword) {
        filteredItems = nonVodItemsData.filter(item => item.itemType.includes(filter.keyword));
    } else {
        filteredItems = [];
    }
    
    if (filteredItems.length > 0) {
      const button = document.createElement('button');
      button.textContent = `Download All ${filter.label}`;
      button.className = 'btn btn-warning mr-2 mb-2 btn-sm';
      button.addEventListener('click', () => {
        requestBulkDownload(filteredItems, `All ${filter.label}`);
      });
      buttonContainer.appendChild(button);
    }
  });

  if (insertionPoint) {
    buttonContainerParent.insertBefore(buttonContainer, insertionPoint.nextSibling);
  } else if (document.querySelector('.app-page-title')) {
    document.querySelector('.app-page-title').parentNode.insertBefore(buttonContainer, document.querySelector('.app-page-title').nextSibling);
  }
}

function init() {
    console.log("GUC CMS Downloader: Initializing v1.8");
    processWeeks();
}

const observer = new MutationObserver((mutationsList, obs) => {
    for(const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            let addedRelevantContent = false;
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE && 
                    (node.classList.contains('weeksdata') || node.querySelector('.weeksdata'))) {
                    addedRelevantContent = true;
                }
            });
            if(addedRelevantContent){
                console.log("GUC CMS Downloader: Detected DOM changes, re-processing weeks.");
                setTimeout(init, 500);
                break; 
            }
        }
    }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    init();
    const mainContentArea = document.querySelector('.app-main__inner .container-fluid.p-0.m-0') || document.querySelector('.app-main__inner');
    if (mainContentArea) {
        observer.observe(mainContentArea, { childList: true, subtree: true });
        console.log("MutationObserver started on:", mainContentArea);
    } else {
        console.error("GUC CMS Downloader: Could not find target node for MutationObserver.");
    }
  });
} else {
  init();
  const mainContentArea = document.querySelector('.app-main__inner .container-fluid.p-0.m-0') || document.querySelector('.app-main__inner');
  if (mainContentArea) {
      observer.observe(mainContentArea, { childList: true, subtree: true });
      console.log("MutationObserver started on:", mainContentArea);
  } else {
      console.error("GUC CMS Downloader: Could not find target node for MutationObserver.");
  }
}