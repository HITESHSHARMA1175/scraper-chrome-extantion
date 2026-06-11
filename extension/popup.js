// popup.js

const inputPanel = document.getElementById('input-panel');
const progressPanel = document.getElementById('progress-panel');
const resultsPanel = document.getElementById('results-panel');

const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const downloadBtn = document.getElementById('download-btn');
const resetBtn = document.getElementById('reset-btn');

const cityInput = document.getElementById('city');
const keywordInput = document.getElementById('keyword');
const limitInput = document.getElementById('limit');

const collectedCount = document.getElementById('collected-count');
const statusText = document.getElementById('status-text');
const totalCollected = document.getElementById('total-collected');

let currentResults = [];
let currentCity = '';
let currentKeyword = '';

// Load state on open
document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ action: 'getState' }, (state) => {
    restoreState(state);
  });
});

// Listen for updates from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateResults') {
    collectedCount.innerText = message.results.length;
    statusText.innerText = message.status;
    currentResults = message.results;
  }
  else if (message.action === 'scrapeCompleted') {
    showResults(message.results);
  }
  else if (message.action === 'scrapeFailed') {
    showError(message.error);
  }
  sendResponse({ received: true });
  return true;
});

// Start Scraping
startBtn.addEventListener('click', async () => {
  const city = cityInput.value.trim();
  const keyword = keywordInput.value.trim();
  const limit = parseInt(limitInput.value) || 50;

  if (!city || !keyword) {
    alert('Please enter both City and Keyword.');
    return;
  }

  currentCity = city;
  currentKeyword = keyword;
  currentResults = [];

  // Normalize inputs for JustDial URL format
  const normalizedCity = city.replace(/\s+/g, '-');
  const normalizedKeyword = keyword.replace(/\s+/g, '-');
  const url = `https://www.justdial.com/${normalizedCity}/${normalizedKeyword}/`;

  statusText.innerText = 'Creating background tab...';
  switchPanel(progressPanel);

  // 1. Create the JustDial tab (inactive so it doesn't disrupt the user)
  chrome.tabs.create({ url: url, active: false }, (tab) => {
    const tabId = tab.id;

    // 2. Listen for tab load completion to inject content.js
    chrome.tabs.onUpdated.addListener(function tabListener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(tabListener);

        // Inject content.js
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        }, () => {
          // Initialize scraper settings in content script
          chrome.tabs.sendMessage(tabId, {
            action: 'init',
            targetCount: limit
          }, () => {
            // Signal background service worker that scrape has started
            chrome.runtime.sendMessage({
              action: 'startScrape',
              tabId: tabId,
              targetCount: limit,
              city: city,
              keyword: keyword
            });
          });
        });
      }
    });
  });
});

// Stop Scraping
stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopScrape' }, (state) => {
    showResults(state.results);
  });
});

// Reset / New Scrape
resetBtn.addEventListener('click', () => {
  switchPanel(inputPanel);
  collectedCount.innerText = '0';
  statusText.innerText = 'Initializing...';
});

// Download Excel
downloadBtn.addEventListener('click', () => {
  if (currentResults.length === 0) {
    alert('No results to download.');
    return;
  }

  // Build Excel XML (SpreadsheetML) content
  let xmlContent = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="JustDial Listings">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">Name</Data></Cell>
    <Cell><Data ss:Type="String">Address</Data></Cell>
    <Cell><Data ss:Type="String">Phone</Data></Cell>
   </Row>`;

  currentResults.forEach(item => {
    // Escape XML special characters to prevent document corruption
    const escapeXml = (str) => {
      if (!str) return '';
      return str.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
    };

    const escapedName = escapeXml(item.name);
    const escapedAddress = escapeXml(item.address);
    const escapedPhone = escapeXml(item.phone);

    xmlContent += `
   <Row>
    <Cell><Data ss:Type="String">${escapedName}</Data></Cell>
    <Cell><Data ss:Type="String">${escapedAddress}</Data></Cell>
    <Cell><Data ss:Type="String">${escapedPhone}</Data></Cell>
   </Row>`;
  });

  xmlContent += `
  </Table>
 </Worksheet>
</Workbook>`;

  const base64Data = btoa(unescape(encodeURIComponent(xmlContent)));
  const dataUrl = 'data:application/vnd.ms-excel;charset=utf-8;base64,' + base64Data;
  const filename = `JustDial_${currentKeyword.replace(/\s+/g, '_')}_${currentCity.replace(/\s+/g, '_')}.xls`;

  // Get active tab and trigger the download from the web page context of that tab.
  // This bypasses extension popup restrictions on data URLs which force raw GUID filenames.
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      const activeTabId = tabs[0].id;
      chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: (url, filename) => {
          const link = document.createElement('a');
          link.setAttribute('href', url);
          link.setAttribute('download', filename);
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        },
        args: [dataUrl, filename]
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn("Script injection failed: " + chrome.runtime.lastError.message);
          fallbackDownload(dataUrl, filename);
        }
      });
    } else {
      fallbackDownload(dataUrl, filename);
    }
  });
});

function fallbackDownload(url, filename) {
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Helper functions
function switchPanel(activePanel) {
  inputPanel.classList.add('hidden');
  progressPanel.classList.add('hidden');
  resultsPanel.classList.add('hidden');
  
  activePanel.classList.remove('hidden');
}

function restoreState(state) {
  currentCity = state.city;
  currentKeyword = state.keyword;
  currentResults = state.results;

  if (state.active) {
    collectedCount.innerText = state.results.length;
    statusText.innerText = state.status;
    switchPanel(progressPanel);
  } else if (state.status === 'Completed' || state.status === 'Stopped') {
    showResults(state.results);
  } else {
    switchPanel(inputPanel);
  }
}

function showResults(results) {
  totalCollected.innerText = results.length;
  currentResults = results;
  switchPanel(resultsPanel);
}

function showError(error) {
  statusText.innerText = 'Failed: ' + error;
  switchPanel(progressPanel);
}
