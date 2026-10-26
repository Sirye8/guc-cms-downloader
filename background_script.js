// background_script.js
// GUC CMS Downloader v3.3.0
// Manifest V3 Service Worker (Chrome/Brave) & Background Script (Firefox)

const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);

console.log("GUC CMS Downloader background script initialized");

function downloadSingleFile(itemInfo) {
  return new Promise((resolve) => {
    try {
      const downloadOptions = {
        url: itemInfo.url,
        filename: itemInfo.filename,
        conflictAction: itemInfo.conflictAction || 'uniquify'
      };

      const result = browserAPI.downloads.download(downloadOptions, (downloadId) => {
        if (browserAPI.runtime.lastError) {
          console.error(`Download failed for ${itemInfo.filename}:`, browserAPI.runtime.lastError.message);
          resolve({ success: false, error: browserAPI.runtime.lastError.message });
        } else if (downloadId !== undefined) {
          console.log(`Download started for ${itemInfo.filename} with ID: ${downloadId}`);
          resolve({ success: true, downloadId: downloadId });
        }
      });

      // Handle Promise-based return (Firefox / modern Chrome)
      if (result && typeof result.then === 'function') {
        result
          .then((downloadId) => {
            console.log(`Download started (Promise) for ${itemInfo.filename} with ID: ${downloadId}`);
            resolve({ success: true, downloadId: downloadId });
          })
          .catch((err) => {
            console.error(`Download error (Promise) for ${itemInfo.filename}:`, err.message);
            resolve({ success: false, error: err.message });
          });
      }
    } catch (err) {
      console.error(`Exception downloading ${itemInfo.filename}:`, err);
      resolve({ success: false, error: err.message });
    }
  });
}

browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadFile") {
    downloadSingleFile(request).then((res) => {
      sendResponse(res);
    });
    return true; // Keep message channel open for async response
  } else if (request.action === "bulkDownloadFiles") {
    const items = request.items || [];
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const delay = (typeof request.delayMs === 'number') ? request.delayMs : 350;
    console.log(`Bulk download started: ${items.length} items (throttle: ${delay}ms)`);

    (async () => {
      let completedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Notify content script of progress
        if (tabId) {
          try {
            browserAPI.tabs.sendMessage(tabId, {
              action: "downloadProgress",
              current: i + 1,
              total: items.length,
              filename: item.displayName || item.filename,
              done: false
            });
          } catch (e) {
            // Ignore if tab was closed
          }
        }

        const res = await downloadSingleFile(item);
        if (res.success) {
          completedCount++;
        } else {
          failedCount++;
        }

        // Throttle downloads to prevent browser flood or network dropping
        if (i < items.length - 1 && delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Notify completion
      if (tabId) {
        try {
          browserAPI.tabs.sendMessage(tabId, {
            action: "downloadProgress",
            current: items.length,
            total: items.length,
            completedCount: completedCount,
            failedCount: failedCount,
            done: true
          });
        } catch (e) {
          // Ignore
        }
      }
      console.log(`Bulk download completed: ${completedCount} successful, ${failedCount} failed.`);
    })();

    sendResponse({ success: true, message: "Bulk download started" });
    return true;
  }
});
