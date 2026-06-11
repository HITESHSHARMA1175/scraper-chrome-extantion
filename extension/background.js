// background.js

let scrapeState = {
  active: false,
  tabId: null,
  results: [],
  targetCount: 100,
  fields: {},
  status: 'Ready'
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScrape') {
    scrapeState.active = true;
    scrapeState.tabId = message.tabId;
    scrapeState.targetCount = message.targetCount;
    scrapeState.fields = message.fields;
    scrapeState.results = [];
    scrapeState.status = 'Initializing...';
    sendResponse({ success: true });
  } 
  else if (message.action === 'updateResults') {
    scrapeState.results = message.results;
    scrapeState.status = message.status || 'Scraping...';
    // Forward message to popup if open
    chrome.runtime.sendMessage(message).catch(() => {}); 
    sendResponse({ success: true });
  } 
  else if (message.action === 'scrapeCompleted') {
    scrapeState.active = false;
    scrapeState.status = 'Completed';
    scrapeState.results = message.results;
    chrome.runtime.sendMessage(message).catch(() => {});
    sendResponse({ success: true });
  }
  else if (message.action === 'scrapeFailed') {
    scrapeState.active = false;
    scrapeState.status = 'Failed: ' + message.error;
    chrome.runtime.sendMessage(message).catch(() => {});
    sendResponse({ success: true });
  }
  else if (message.action === 'getState') {
    sendResponse(scrapeState);
  }
  else if (message.action === 'stopScrape') {
    scrapeState.active = false;
    scrapeState.status = 'Stopped';
    if (scrapeState.tabId) {
      chrome.tabs.sendMessage(scrapeState.tabId, { action: 'stop' }).catch(() => {});
    }
    sendResponse(scrapeState);
  }
  return true;
});
