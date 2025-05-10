// background_script.js (Updated for bulk download handling)

async function downloadSingleFile(itemInfo, sendResponse) {
  console.log(`Background: Received request to download ${itemInfo.filename} from ${itemInfo.url}`);
  try {
    const downloadId = await browser.downloads.download({
      url: itemInfo.url,
      filename: itemInfo.filename,
      conflictAction: 'uniquify'
    });
    console.log(`Background: Download started for ${itemInfo.filename} with ID: ${downloadId}`);
    if (sendResponse) sendResponse({ success: true, downloadId: downloadId });
    return { success: true, downloadId: downloadId }; // Return status for bulk handler
  } catch (error) {
    console.error(`Background: Download failed for ${itemInfo.filename}:`, error.message);
    if (sendResponse) sendResponse({ success: false, error: error.message });
    return { success: false, error: error.message }; // Return status for bulk handler
  }
}

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadFile") {
    // This path is still used for single file downloads
    downloadSingleFile(request, sendResponse);
    return true; // Indicates that the response will be sent asynchronously
  } else if (request.action === "bulkDownloadFiles") {
    console.log(`Background: Received request for bulk download of ${request.items.length} items.`);
    // We don't send an immediate response back for bulk,
    // as it's a long-running operation. The content script
    // will show alerts to the user.
    // The function itself is async and will handle downloads sequentially.
    (async () => {
      for (const item of request.items) {
        console.log(`Background (Bulk): Processing ${item.filename}`);
        await downloadSingleFile(item, null); // Pass null for sendResponse as we don't need individual ack here
        // Delay between downloads
        await new Promise(resolve => setTimeout(resolve, 0)); // Increased delay slightly for stability
      }
      console.log("Background: Bulk download processing finished.");
      // Optionally send a message back to content script if needed, but alerts are in content script for now
    })();
    // For bulk, we might not need to return true if we don't send an async response FROM THIS HANDLER
    // but the individual downloadSingleFile calls might. To be safe, let's acknowledge message receipt.
    sendResponse({ success: true, message: "Bulk download request received and processing started." });
    return false; // Or true if the async processing within is considered the response. Let's try false.
                   // The main thing is that the async IIFE runs independently.
  }
});