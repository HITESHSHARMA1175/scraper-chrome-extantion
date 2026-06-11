// content.js

let results = [];
let targetCount = 100;
let isStopped = false;
let selectedFields = {};

// Register message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'init') {
    targetCount = message.targetCount || 100;
    selectedFields = message.fields || {};
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
  console.log("JustDial Scraper active. Target:", targetCount, "Fields:", selectedFields);
  
  if (document.readyState !== 'complete') {
    await new Promise(resolve => window.addEventListener('load', resolve));
  }
  
  let lastHeight = document.body.scrollHeight;
  let lastLength = 0;
  let lastChangeTime = Date.now();
  
  while (!isStopped) {
    dismissPopup();

    // Scroll down to load lazy elements
    window.scrollBy(0, window.innerHeight / 2);
    await sleep(randomRange(1000, 1800));
    
    // Extract current visible listings
    await extractData();
    
    // Update progress state to background
    chrome.runtime.sendMessage({
      action: 'updateResults',
      results: results,
      status: `Scraped: ${results.length} / ${targetCount}`
    });

    if (results.length >= targetCount) {
      console.log("Target count reached!");
      break;
    }

    let currentHeight = document.body.scrollHeight;
    let currentLength = results.length;
    
    if (currentLength > lastLength) {
      lastLength = currentLength;
      lastChangeTime = Date.now();
    }
    
    // Check if bottom reached or no new results loaded for 20s
    if (currentHeight === lastHeight && (Date.now() - lastChangeTime > 20000)) {
      console.log("No more listings loading. Stopping.");
      break;
    }
    
    lastHeight = currentHeight;
  }
  
  // Trigger CSV Auto-Download if not stopped
  if (!isStopped && results.length > 0) {
    try {
      triggerDownload();
    } catch (err) {
      console.error("Auto-download failed:", err);
    }
  }

  // Notify finish
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
      console.log("Dismissed popup:", sel);
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
      // 1. Business Name
      let name = "";
      const nameSelectors = [
        '.resultbox_title_anchor',
        'span.jcn a',
        'span[class*="jcn"] a',
        'h2[class*="store-name"]',
        'a[class*="title"]',
        'h2',
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

      // Check cache text of parent for extracting other details
      const cardText = parent.innerText || '';

      // 2. Phone Number
      let phone = "N/A";
      if (selectedFields['phone'] || selectedFields['whatsapp']) {
        const phoneSelectors = [
          '.callcontent',
          'span[class*="call"]',
          'a[href^="tel:"]',
          '.resultbox_call_btn',
          '[class*="contact"]'
        ];
        for (let sel of phoneSelectors) {
          const el = parent.querySelector(sel);
          if (el) {
            // Click to reveal hidden numbers
            if (el.classList.contains('callcontent') || el.innerText.includes('Show Number')) {
              try {
                el.click();
                await sleep(350); // wait for text to populate
              } catch (clickErr) {}
            }
            if (el.innerText.trim() && !el.innerText.includes('Show Number')) {
              phone = el.innerText.trim();
            } else if (el.getAttribute('href') && el.getAttribute('href').startsWith('tel:')) {
              phone = el.getAttribute('href').replace('tel:', '').trim();
            }
            if (phone && phone !== 'N/A' && !phone.includes('Show Number')) {
              break;
            }
          }
        }
      }

      // 3. Address
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

      // 4. Rating
      let rating = "N/A";
      const ratingSelectors = [
        '.resultbox_totalrating',
        '.resultbox_rating',
        '.rating_value',
        'span.green-box',
        'span.rating-value',
        'span[class*="rating"]',
        'span[class*="rate"]'
      ];
      for (let sel of ratingSelectors) {
        const el = parent.querySelector(sel);
        if (el && el.innerText.trim()) {
          const text = el.innerText.trim();
          const ratingMatch = text.match(/\b[1-5]\.[0-9]\b/);
          if (ratingMatch) {
            rating = ratingMatch[0];
            break;
          } else if (!isNaN(parseFloat(text)) && parseFloat(text) >= 1 && parseFloat(text) <= 5) {
            rating = parseFloat(text).toFixed(1);
            break;
          }
        }
      }

      // 5. Reviews Count
      let reviews = "N/A";
      const reviewsSelectors = [
        '.resultbox_countrating',
        '.resultbox_count',
        '.resultbox_votes',
        'span.rt_count',
        'span[class*="count"]',
        'span[class*="vote"]'
      ];
      for (let sel of reviewsSelectors) {
        const el = parent.querySelector(sel);
        if (el && el.innerText.trim()) {
          const text = el.innerText.trim();
          const votesMatch = text.match(/\b\d+\b/);
          if (votesMatch) {
            reviews = votesMatch[0];
            break;
          }
        }
      }

      // 6. Category
      let category = "N/A";
      const categorySelectors = [
        '.resultbox_category',
        '.resultbox_subtext',
        'span[class*="category"]',
        'a[class*="category"]'
      ];
      for (let sel of categorySelectors) {
        const el = parent.querySelector(sel);
        if (el && el.innerText.trim()) {
          category = el.innerText.trim();
          break;
        }
      }

      // 7. Years in Business
      let years_in_business = "N/A";
      const yearsMatch = cardText.match(/\b(\d+)\s+Years?\s+in\s+Business\b/i);
      if (yearsMatch) {
        years_in_business = yearsMatch[1];
      }

      // 8. Website
      let website = "N/A";
      const websiteSelectors = [
        'a[class*="web"]',
        'a[href*="website"]',
        'span[class*="web"] a',
        'a.resultbox_web'
      ];
      for (let sel of websiteSelectors) {
        const el = parent.querySelector(sel);
        if (el && el.getAttribute('href')) {
          const href = el.getAttribute('href');
          if (href && !href.includes('justdial.com')) {
            website = href;
            break;
          }
        }
      }
      if (website === "N/A") {
        const links = parent.querySelectorAll('a');
        for (let link of links) {
          const href = link.getAttribute('href');
          if (href && href.startsWith('http') && !href.includes('justdial.com') && !href.includes('whatsapp') && !href.includes('wa.me')) {
            website = href;
            break;
          }
        }
      }

      // 9. WhatsApp Number
      let whatsapp = "N/A";
      const whatsappSelectors = [
        'a[href*="wa.me"]',
        'a[href*="whatsapp"]',
        '[class*="whatsapp"] a',
        '[class*="whatsapp"]'
      ];
      for (let sel of whatsappSelectors) {
        const el = parent.querySelector(sel);
        if (el) {
          let href = el.getAttribute('href') || '';
          if (href) {
            const phoneMatch = href.match(/(?:wa\.me|phone=)(\+?\d+)/);
            if (phoneMatch) {
              whatsapp = phoneMatch[1];
              break;
            }
          }
          if (el.innerText && el.innerText.match(/\b\d{10,}\b/)) {
            whatsapp = el.innerText.match(/\b\d{10,}\b/)[0];
            break;
          }
        }
      }
      if (whatsapp === "N/A" && phone !== "N/A" && cardText.toLowerCase().includes('whatsapp')) {
        whatsapp = phone;
      }

      // 10. Email (if available)
      let email = "N/A";
      const mailtoEl = parent.querySelector('a[href^="mailto:"]');
      if (mailtoEl) {
        email = mailtoEl.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
      } else {
        const emailMatch = cardText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
        if (emailMatch) {
          email = emailMatch[0];
        }
      }

      // 11. Opening Hours
      let opening_hours = "N/A";
      const hoursSelectors = [
        '.resultbox_openstatus',
        '.open-status',
        'span[class*="open"]',
        'span[class*="hour"]'
      ];
      for (let sel of hoursSelectors) {
        const el = parent.querySelector(sel);
        if (el && el.innerText.trim()) {
          const text = el.innerText.trim();
          if (text.toLowerCase().includes('open') || text.toLowerCase().includes('close')) {
            opening_hours = text;
            break;
          }
        }
      }
      if (opening_hours === "N/A") {
        const match = cardText.match(/\b(?:Open|Closed)(?:\s+(?:until|at|now|24\s*Hrs|hours))?[^\n,]*/i);
        if (match) {
          opening_hours = match[0].trim();
        }
      }

      // 12. Location
      let location = "N/A";
      const locSelectors = [
        '.resultbox_location',
        'span[class*="location"]',
        'span.resultbox_loc',
        'span[class*="locality"]'
      ];
      for (let sel of locSelectors) {
        const el = parent.querySelector(sel);
        if (el && el.innerText.trim()) {
          location = el.innerText.trim();
          break;
        }
      }
      if (location === "N/A" && address !== "N/A") {
        const parts = address.split(',');
        if (parts.length > 0) {
          location = parts[0].trim();
        }
      }

      // 13. Pincode
      let pincode = "N/A";
      const pinMatch = cardText.match(/\b\d{6}\b/);
      if (pinMatch) {
        pincode = pinMatch[0];
      }

      // Record to results
      results.push({
        name,
        phone,
        address,
        rating,
        reviews,
        category,
        years_in_business,
        website,
        whatsapp,
        email,
        opening_hours,
        location,
        pincode
      });
      
      seenNames.add(name.toLowerCase());
      
    } catch (err) {
      console.error("Error parsing card listing element:", err);
    }
  }
}

function triggerDownload() {
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

  const allKeys = ['name', 'phone', 'address', 'rating', 'reviews', 'category', 'years', 'website', 'whatsapp', 'email', 'hours', 'location', 'pincode'];
  const activeFieldKeys = allKeys.filter(key => selectedFields[key]);
  
  if (activeFieldKeys.length === 0) return;

  const headers = activeFieldKeys.map(key => headersMap[key]).join(',');
  let csvContent = "\ufeff" + headers + "\n"; // UTF-8 BOM

  results.forEach(item => {
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
  
  const link = document.createElement('a');
  link.setAttribute('href', dataUrl);
  link.setAttribute('download', 'justdial_data.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
