// content_script.js (Updated for VoD and clearer bulk descriptions)

console.log("GUC CMS Downloader content script loaded - v1.1 (VoD support)");

function sanitizeFilename(name) {
  let sane = name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
  if (sane.length > 200) {
    sane = sane.substring(0, 200).trim();
  }
  return sane;
}

function getAbsoluteUrl(hrefOrDataUrl) {
    if (!hrefOrDataUrl) return null; // Guard against null/undefined input
    if (hrefOrDataUrl.startsWith('http://') || hrefOrDataUrl.startsWith('https://')) {
        return hrefOrDataUrl;
    }
    if (hrefOrDataUrl.startsWith('/')) {
        return `https://cms.guc.edu.eg${hrefOrDataUrl}`;
    }
    // Fallback for unexpected cases, though less likely for this site
    return `https://cms.guc.edu.eg/${hrefOrDataUrl}`;
}


function extractItemDetails(itemElement, weekInfo) {
  const titleDiv = itemElement.querySelector('div[id^="content"]');
  let downloadLinkElement = itemElement.querySelector('a.btn.btn-primary.contentbtn[id="download"]');
  const watchVideoButton = itemElement.querySelector('input.btn.btn-primary.vodbutton.contentbtn[value="Watch Video"]');

  if (!titleDiv) {
    console.warn("Title div not found for an item in week:", weekInfo);
    return null;
  }

  let isVod = false;
  let downloadUrl;

  if (watchVideoButton && (!downloadLinkElement || getComputedStyle(downloadLinkElement).display === 'none')) {
    isVod = true;
    if (downloadLinkElement && downloadLinkElement.hasAttribute('href')) {
        downloadUrl = getAbsoluteUrl(downloadLinkElement.getAttribute('href'));
    } else if (watchVideoButton.hasAttribute('data-url')) {
        downloadUrl = getAbsoluteUrl(watchVideoButton.getAttribute('data-url'));
    }
  } else if (downloadLinkElement && downloadLinkElement.hasAttribute('href')) {
    downloadUrl = getAbsoluteUrl(downloadLinkElement.getAttribute('href'));
  } else {
    console.warn("No download URL found for item:", titleDiv.textContent.trim(), "in week:", weekInfo);
    return null;
  }

  if (!downloadUrl) {
    console.warn("Could not construct a valid download URL for:", titleDiv.textContent.trim());
    return null;
  }

  let rawTitle = "";
  let itemType = ""; // e.g. "(Tutorial notes)" -> "tutorial notes"

  const strongTag = titleDiv.querySelector('strong');
  if (strongTag) {
    rawTitle = strongTag.textContent.trim();
    let currentNode = strongTag.nextSibling;
    while (currentNode) {
      if (currentNode.nodeType === Node.TEXT_NODE && currentNode.textContent.trim() !== "") {
        const typeMatch = currentNode.textContent.trim().match(/\(([^)]+)\)/);
        if (typeMatch && typeMatch[1]) {
          itemType = typeMatch[1].toLowerCase().trim();
          if (itemType === "vod" && !isVod) {
            isVod = true; // Correct based on explicit (VoD) type
          }
        }
        break;
      }
      currentNode = currentNode.nextSibling;
    }
  } else {
    rawTitle = titleDiv.textContent.trim();
  }

  // Clean the title: remove leading "X - "
  const cleanedItemTitle = sanitizeFilename(rawTitle.replace(/^\d+\s*-\s*/, '').trim());
  
  const originalFilenameFromServer = downloadUrl.substring(downloadUrl.lastIndexOf('/') + 1).split('?')[0]; // Remove query params for extension
  let extension = originalFilenameFromServer.substring(originalFilenameFromServer.lastIndexOf('.'));
  if (!extension.includes('.')) { // If no dot, then no valid extension from URL
      extension = ""; // Reset
  }

  if (!extension && isVod) {
    extension = ".mp4"; // Assume mp4 for VoDs if no extension found and type is VoD
  } else if (!extension && itemType.includes('project')) { // Example: if PDFs for projects often lack extension
    extension = ".pdf"; // Common default, adjust if needed
  } else if (!extension) {
    extension = ".file"; // Generic fallback if absolutely no hint
  }


  const filename = `${weekInfo} - ${cleanedItemTitle}${extension}`;

  return {
    originalTitle: titleDiv.textContent.trim(),
    cleanedTitle: cleanedItemTitle,
    itemType: itemType, // "tutorial notes", "project", "lecture slides", "vod"
    url: downloadUrl,
    filename: filename,
    isVod: isVod,
    downloadLinkElement: downloadLinkElement,
    watchVideoButton: watchVideoButton
  };
}

function processWeeks() {
  const weekBlocks = document.querySelectorAll('div.card.mb-5.weeksdata');
  const allItemsForBulkDownload = [];

  weekBlocks.forEach((weekBlock, weekIndex) => {
    const weekHeader = weekBlock.querySelector('div.card-header h2.text-big');
    
    let weekIdentifier = `WeekUnknown_${weekIndex + 1}`; // Fallback identifier
    if (weekHeader && weekHeader.textContent) {
      const weekHeaderText = weekHeader.textContent.trim();
      const datePart = weekHeaderText.replace('Week:', '').trim();
      if (datePart) {
        weekIdentifier = `Week_${datePart.replace(/-/g, '-')}`;
      }
    }

    const contentItemsElements = weekBlock.querySelectorAll('div.p-3 > div:last-of-type > div.card.mb-4');
    const itemsInThisWeekForBulk = [];

    contentItemsElements.forEach(itemElement => {
      const details = extractItemDetails(itemElement, weekIdentifier);
      if (details) {
        if (details.isVod) {
          if (details.watchVideoButton) {
            const existingDownloadVidButton = details.watchVideoButton.parentNode.querySelector('.guc-download-video-button');
            if (!existingDownloadVidButton) { // Add button only if it doesn't exist
                const downloadVideoButton = document.createElement('button');
                downloadVideoButton.textContent = 'Download Video';
                downloadVideoButton.className = 'btn btn-info btn-sm ml-2 guc-download-video-button'; // Added class
                downloadVideoButton.style.verticalAlign = 'top';
                downloadVideoButton.addEventListener('click', (event) => {
                  event.preventDefault();
                  browser.runtime.sendMessage({
                    action: "downloadFile",
                    url: details.url,
                    filename: details.filename
                  }).catch(e => console.error("Error sending message for VoD download:", e));
                });
                const complaintButton = itemElement.querySelector('input.btn.btn-danger.complaint');
                if (complaintButton) {
                    complaintButton.parentNode.insertBefore(downloadVideoButton, complaintButton);
                } else {
                    details.watchVideoButton.parentNode.appendChild(downloadVideoButton);
                }
            }
          }
        } else { // Non-VoD file
          allItemsForBulkDownload.push(details);
          itemsInThisWeekForBulk.push(details);

          if (details.downloadLinkElement && !details.downloadLinkElement.dataset.listenerAttached) {
            details.downloadLinkElement.addEventListener('click', (event) => {
              event.preventDefault();
              browser.runtime.sendMessage({
                action: "downloadFile",
                url: details.url,
                filename: details.filename
              }).catch(e => console.error("Error sending message for single download:", e));
            });
            details.downloadLinkElement.dataset.listenerAttached = "true"; // Mark as processed
          }
        }
      }
    });

    if (itemsInThisWeekForBulk.length > 0 && weekHeader) {
      const buttonHost = weekHeader.closest('.card-header').querySelector('.col-lg-6.col-md-6.col-sm-12:last-child .menu-header-title.text-right');
      if (buttonHost && !buttonHost.querySelector('.guc-download-week-button')) { // Add only if not present
        const bulkWeekButton = document.createElement('button');
        bulkWeekButton.textContent = `Download Week Files (No Videos) - ${weekIdentifier.replace("Week_","")}`;
        bulkWeekButton.className = 'btn btn-success btn-sm mb-2 guc-download-week-button'; // Added class
        bulkWeekButton.style.marginRight = '10px';
        bulkWeekButton.addEventListener('click', async () => {
          alert(`Starting download for ${itemsInThisWeekForBulk.length} non-video files from ${weekIdentifier}...`);
          for (const item of itemsInThisWeekForBulk) {
            await browser.runtime.sendMessage({ action: "downloadFile", url: item.url, filename: item.filename });
            await new Promise(resolve => setTimeout(resolve, 300)); // Shorter delay
          }
          alert(`Finished queuing non-video downloads for ${weekIdentifier}.`);
        });
        buttonHost.prepend(bulkWeekButton);
      }
    }
  });
  addGlobalBulkButtons(allItemsForBulkDownload);
}

function addGlobalBulkButtons(allItems) { // allItems here are non-VoD
  const insertionPoint = document.getElementById('ContentPlaceHolderright_ContentPlaceHoldercontent_desc');
  if (!insertionPoint || allItems.length === 0) {
    console.warn("Global buttons: Insertion point or items not found.");
    return;
  }
  
  // Check if buttons already exist
  if (document.querySelector('.guc-global-bulk-buttons')) {
    return;
  }

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'mt-3 mb-3 guc-global-bulk-buttons'; // Added class

  const downloadAllCourseButton = document.createElement('button');
  downloadAllCourseButton.textContent = 'Download All Course Files (No Videos)';
  downloadAllCourseButton.className = 'btn btn-info mr-2 mb-2 btn-sm';
  downloadAllCourseButton.addEventListener('click', async () => {
    alert(`Starting download for all ${allItems.length} non-video files in the course...`);
    for (const item of allItems) {
      await browser.runtime.sendMessage({ action: "downloadFile", url: item.url, filename: item.filename });
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    alert('Finished queuing all non-video course files.');
  });
  buttonContainer.appendChild(downloadAllCourseButton);

  const filterTypes = [
    { label: 'Tutorials', keyword: 'tutorial' },
    { label: 'Lectures', keyword: 'lecture' },
    { label: 'Projects/Assignments', keyword: 'project' }
  ];

  filterTypes.forEach(filter => {
    const filteredItems = allItems.filter(item => item.itemType.includes(filter.keyword));
    if (filteredItems.length > 0) {
      const button = document.createElement('button');
      button.textContent = `Download All ${filter.label} (No Videos)`;
      button.className = 'btn btn-warning mr-2 mb-2 btn-sm';
      button.addEventListener('click', async () => {
        alert(`Starting download for ${filteredItems.length} ${filter.label.toLowerCase()} (non-video)...`);
        for (const item of filteredItems) {
          await browser.runtime.sendMessage({ action: "downloadFile", url: item.url, filename: item.filename });
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        alert(`Finished queuing all ${filter.label.toLowerCase()} (non-video).`);
      });
      buttonContainer.appendChild(button);
    }
  });
  insertionPoint.parentNode.insertBefore(buttonContainer, insertionPoint.nextSibling);
}

// --- Main Execution ---
function init() {
    console.log("GUC CMS Downloader: Initializing");
    processWeeks();
}

// Observe DOM changes for dynamically loaded content, though likely not needed for this specific page.
// However, it's good practice if parts of the page load later.
const observer = new MutationObserver((mutationsList, observer) => {
    // This could be smarter to only run if specific week/content elements are added
    // For now, just re-run if anything significant changes in the main content area.
    for(const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            // A simple check to see if a week block might have been added
            let addedWeekBlock = false;
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('weeksdata')) {
                    addedWeekBlock = true;
                }
            });
            if(addedWeekBlock){
                console.log("GUC CMS Downloader: Detected potential dynamic content, re-processing.");
                init(); // Re-initialize if new week blocks appear
                // Consider disconnecting observer if processing is one-time after full load
                // observer.disconnect();
                break;
            }
        }
    }
});


if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Start observing the main content area where weeks are listed
const targetNode = document.querySelector('.app-main__inner'); // Adjust if a more specific parent of weeksdata exists
if (targetNode) {
    observer.observe(targetNode, { childList: true, subtree: true });
} else {
    console.warn("GUC CMS Downloader: Could not find target node for MutationObserver.");
}