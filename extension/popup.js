// popup.js

const inputPanel = document.getElementById('input-panel');
const progressPanel = document.getElementById('progress-panel');
const resultsPanel = document.getElementById('results-panel');
const errorPanel = document.getElementById('error-panel');

const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const downloadBtn = document.getElementById('download-btn');
const resetBtn = document.getElementById('reset-btn');

const limitInput = document.getElementById('limit');

const collectedCount = document.getElementById('collected-count');
const statusText = document.getElementById('status-text');
const totalCollected = document.getElementById('total-collected');

let currentResults = [];

const defaultFields = ['name', 'phone', 'address', 'rating', 'reviews'];
const allFieldKeys = ['name', 'phone', 'address', 'rating', 'reviews', 'category', 'years', 'website', 'whatsapp', 'email', 'hours', 'location', 'pincode'];

// Load state on open
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  
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

// Check if tab is JustDial
function checkActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      const activeTab = tabs[0];
      const url = activeTab.url || '';
      const isJustDial = url.includes('justdial.com');
      
      if (!isJustDial) {
        inputPanel.classList.add('hidden');
        progressPanel.classList.add('hidden');
        resultsPanel.classList.add('hidden');
        errorPanel.classList.remove('hidden');
        callback(false, activeTab);
      } else {
        errorPanel.classList.add('hidden');
        callback(true, activeTab);
      }
    } else {
      inputPanel.classList.add('hidden');
      progressPanel.classList.add('hidden');
      resultsPanel.classList.add('hidden');
      errorPanel.classList.remove('hidden');
      callback(false, null);
    }
  });
}

// Start Scraping
startBtn.addEventListener('click', () => {
  checkActiveTab((isJustDial, activeTab) => {
    if (!isJustDial || !activeTab) {
      alert('Please open a JustDial search results page first.');
      return;
    }

    const limit = parseInt(limitInput.value) || 100;
    const selectedFields = getSelectedFields();

    // Verify at least one field is selected
    const activeFieldKeys = allFieldKeys.filter(key => selectedFields[key]);
    if (activeFieldKeys.length === 0) {
      alert('Please select at least one field to scrape.');
      return;
    }

    saveSettings();
    currentResults = [];

    statusText.innerText = 'Initializing scraper...';
    switchPanel(progressPanel);

    const tabId = activeTab.id;

    // Inject content.js
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }, () => {
      if (chrome.runtime.lastError) {
        showError('Injection failed: ' + chrome.runtime.lastError.message);
        return;
      }

      // Initialize scraper settings in content script
      chrome.tabs.sendMessage(tabId, {
        action: 'init',
        targetCount: limit,
        fields: selectedFields
      }, () => {
        // Signal background service worker that scrape has started
        chrome.runtime.sendMessage({
          action: 'startScrape',
          tabId: tabId,
          targetCount: limit,
          fields: selectedFields
        });
      });
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
  checkActiveTab((isJustDial) => {
    if (isJustDial) {
      switchPanel(inputPanel);
      collectedCount.innerText = '0';
      statusText.innerText = 'Initializing...';
    }
  });
});

// Download CSV
downloadBtn.addEventListener('click', () => {
  downloadCsv();
});

function downloadCsv() {
  if (currentResults.length === 0) {
    alert('No results to download.');
    return;
  }

  const selectedFields = getSelectedFields();
  
  const headersMap = {
    name: 'Business Name',
    phone: 'Phone Number',
    address: 'Address',
    rating: 'Rating',
    reviews: 'Reviews Count',
    category: 'Category',
    years: 'Years in Business',
    website: 'Website',
    whatsapp: 'WhatsApp Number',
    email: 'Email',
    hours: 'Opening Hours',
    location: 'Location',
    pincode: 'Pincode'
  };

  const activeFieldKeys = allFieldKeys.filter(key => selectedFields[key]);
  if (activeFieldKeys.length === 0) {
    alert('Please select at least one field to export.');
    return;
  }

  const headers = activeFieldKeys.map(key => headersMap[key]).join(',');
  let csvContent = "\ufeff" + headers + "\n"; // UTF-8 BOM

  currentResults.forEach(item => {
    const escapeCsv = (str) => {
      if (str === undefined || str === null) return '""';
      let stringVal = String(str);
      let cleaned = stringVal.replace(/\r?\n|\r/g, ' ').trim();
      if (cleaned.includes('"') || cleaned.includes(',') || cleaned.includes('\n')) {
        return `"${cleaned.replace(/"/g, '""')}"`;
      }
      return `"${cleaned}"`;
    };

    const row = activeFieldKeys.map(key => {
      let val = '';
      if (key === 'name') val = item.name;
      else if (key === 'phone') val = item.phone;
      else if (key === 'address') val = item.address;
      else if (key === 'rating') val = item.rating;
      else if (key === 'reviews') val = item.reviews;
      else if (key === 'category') val = item.category;
      else if (key === 'years') val = item.years_in_business;
      else if (key === 'website') val = item.website;
      else if (key === 'whatsapp') val = item.whatsapp;
      else if (key === 'email') val = item.email;
      else if (key === 'hours') val = item.opening_hours;
      else if (key === 'location') val = item.location;
      else if (key === 'pincode') val = item.pincode;
      return escapeCsv(val);
    }).join(',');

    csvContent += row + "\n";
  });

  const base64Data = btoa(unescape(encodeURIComponent(csvContent)));
  const dataUrl = 'data:text/csv;charset=utf-8;base64,' + base64Data;
  const filename = 'justdial_data.csv';

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
}

function fallbackDownload(url, filename) {
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Helpers
function switchPanel(activePanel) {
  inputPanel.classList.add('hidden');
  progressPanel.classList.add('hidden');
  resultsPanel.classList.add('hidden');
  errorPanel.classList.add('hidden');
  
  activePanel.classList.remove('hidden');
}

function restoreState(state) {
  currentResults = state.results;

  if (state.active) {
    collectedCount.innerText = state.results.length;
    statusText.innerText = state.status;
    switchPanel(progressPanel);
  } else if (state.status === 'Completed' || state.status === 'Stopped') {
    showResults(state.results);
  } else {
    checkActiveTab((isJustDial) => {
      if (isJustDial) {
        switchPanel(inputPanel);
      }
    });
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

function getSelectedFields() {
  const fields = {};
  allFieldKeys.forEach(key => {
    const el = document.getElementById(`field-${key}`);
    if (el) {
      fields[key] = el.checked;
    }
  });
  return fields;
}

function loadSettings() {
  chrome.storage.local.get(['limit', 'fields'], (data) => {
    if (data.limit) {
      limitInput.value = data.limit;
    }
    if (data.fields) {
      allFieldKeys.forEach(key => {
        const el = document.getElementById(`field-${key}`);
        if (el) {
          el.checked = !!data.fields[key];
        }
      });
    } else {
      allFieldKeys.forEach(key => {
        const el = document.getElementById(`field-${key}`);
        if (el) {
          el.checked = defaultFields.includes(key);
        }
      });
    }
  });
}

function saveSettings() {
  const limit = parseInt(limitInput.value) || 100;
  const fields = getSelectedFields();
  chrome.storage.local.set({ limit, fields });
}
