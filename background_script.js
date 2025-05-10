browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadFile") {
    console.log(`Background: Received request to download ${request.filename} from ${request.url}`);
    browser.downloads.download({
      url: request.url,
      filename: request.filename,
      conflictAction: 'uniquify' // Appends a number if filename exists
    }).then(downloadId => {
      if (browser.runtime.lastError) {
        console.error(`Background: Download failed for ${request.filename}:`, browser.runtime.lastError.message);
        sendResponse({ success: false, error: browser.runtime.lastError.message });
      } else {
        console.log(`Background: Download started for ${request.filename} with ID: ${downloadId}`);
        sendResponse({ success: true, downloadId: downloadId });
      }
    }).catch(error => { // This catch might be redundant due to the .then check, but good for safety
      console.error(`Background: Download promise rejected for ${request.filename}:`, error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Indicates that the response will be sent asynchronously
  }
});