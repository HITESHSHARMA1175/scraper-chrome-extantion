// content.js

let results = [];
let targetCount = 100;
let isStopped = false;

// Register message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'init') {
    targetCount = message.targetCount || 100;
    isStopped = false;
    results = [];
    sendResponse({ success: true });
    startScrapingLoop();
  }
  else if (message.action === 'stop') {
    isStopped = true;
    sendResponse({ success: true });
  }
  return true;
});

async function startScrapingLoop() {
  console.log("JustDial Scraper Extension initialized. Target:", targetCount);
  
  // Wait for page ready
  if (document.readyState !== 'complete') {
    await new Promise(resolve => window.addEventListener('load', resolve));
  }
  
  let lastHeight = document.body.scrollHeight;
  let lastLength = 0;
  let lastChangeTime = Date.now();
  
  while (!isStopped) {
    // Dismiss popup
    dismissPopup();

    // Scroll down a bit
    window.scrollBy(0, window.innerHeight / 2);
    await sleep(randomRange(800, 1500));
    
    // Extract current visible listings
    await extractData();
    
    // Send updates to background
    chrome.runtime.sendMessage({
      action: 'updateResults',
      results: results,
      status: `Scraping: collected ${results.length} / ${targetCount} listings...`
    });

    if (results.length >= targetCount) {
      console.log("Reached target count!");
      break;
    }

    let currentHeight = document.body.scrollHeight;
    let currentLength = results.length;
    
    if (currentLength > lastLength) {
      lastLength = currentLength;
      lastChangeTime = Date.now();
    }
    
    // Check if we hit the bottom of the page or no new items loaded for 30s
    if (currentHeight === lastHeight && (Date.now() - lastChangeTime > 30000)) {
      console.log("No new listings loaded. Ending scrape.");
      break;
    }
    
    lastHeight = currentHeight;
  }
  
  // Scrape finished
  chrome.runtime.sendMessage({
    action: 'scrapeCompleted',
    results: results
  });
}

function dismissPopup() {
  const closeSelectors = [
    '.jd_modal_close',
    '.maybelater',
    '.modal-close',
    '[class*="close-popup"]',
    '[class*="jd_modal_close"]'
  ];
  for (let sel of closeSelectors) {
    const el = document.querySelector(sel);
    if (el && isElementVisible(el)) {
      el.click();
      console.log("Dismissed popup using selector:", sel);
      break;
    }
  }
}

async function extractData() {
  const parentSelectors = [
    '.resultbox_info',
    'li.cntanr',
    'div.jsx-resultbox',
    'div.store-details',
    'div[class*="resultbox"]',
    'li[class*="cntanr"]'
  ];
  
  let parentElements = [];
  for (let sel of parentSelectors) {
    const elList = document.querySelectorAll(sel);
    if (elList && elList.length > parentElements.length) {
      parentElements = Array.from(elList);
    }
  }
  
  const seenNames = new Set(results.map(r => r.name.toLowerCase()));
  
  for (let parent of parentElements) {
    if (results.length >= targetCount || isStopped) break;
    
    try {
      // 1. Extract Name
      let name = "";
      const nameSelectors = [
        '.resultbox_title_anchor',
        'span.jcn a',
        'span[class*="jcn"] a',
        'h2[class*="store-name"]',
        'a[class*="title"]',
        'a'
      ];
      for (let sel of nameSelectors) {
        const el = parent.querySelector(sel);
        if (el && el.innerText.trim()) {
          name = el.innerText.trim();
          break;
        }
      }
      
      if (!name || seenNames.has(name.toLowerCase())) {
        continue;
      }
      
      // 2. Extract Address
      let address = "N/A";
      const addressSelectors = [
        '.resultbox_address',
        'span.cont_fl_addr',
        'span[class*="address"]',
        'span[class*="adr"]',
        '.address'
      ];
      for (let sel of addressSelectors) {
        const el = parent.querySelector(sel);
        if (el && el.innerText.trim()) {
          address = el.innerText.trim();
          break;
        }
      }
      
      // 3. Extract Phone
      let phone = "N/A";
      const phoneSelectors = [
        '.callcontent',
        'span[class*="call"]',
        'a[href^="tel:"]'
      ];
      for (let sel of phoneSelectors) {
        const el = parent.querySelector(sel);
        if (el) {
          // If click-to-reveal is needed, click it
          if (el.classList.contains('callcontent') || el.innerText.includes('Show Number')) {
            try {
              el.click();
              await sleep(300); // Briefly wait for DOM update
            } catch (clickErr) {}
          }
          if (el.innerText.trim()) {
            phone = el.innerText.trim();
          } else if (el.getAttribute('href') && el.getAttribute('href').startsWith('tel:')) {
            phone = el.getAttribute('href').replace('tel:', '').trim();
          }
          if (phone && phone !== 'N/A' && !phone.includes('Show Number')) {
            break;
          }
        }
      }
      
      // Add to results
      results.push({
        name: name,
        address: address,
        phone: phone
      });
      seenNames.add(name.toLowerCase());
      
    } catch (err) {
      console.error("Error extracting listing item:", err);
    }
  }
}

function isElementVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
