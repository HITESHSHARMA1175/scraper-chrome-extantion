// content.js

let results = [];
let targetCount = 100;
let isStopped = false;
let selectedFields = {};
let scrapeMode = 'fast';

// Register message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'init') {
    targetCount = message.targetCount || 100;
    selectedFields = message.fields || {};
    scrapeMode = message.mode || 'fast';
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
  console.log("JustDial Scraper active. Mode:", scrapeMode, "Target:", targetCount, "Fields:", selectedFields);
  
  if (document.readyState !== 'complete') {
    await new Promise(resolve => window.addEventListener('load', resolve));
  }
  
  let lastHeight = document.body.scrollHeight;
  let lastLength = 0;
  let lastChangeTime = Date.now();
  
  while (!isStopped) {
    dismissPopup();

    // Scroll down to trigger lazy loading
    window.scrollBy(0, window.innerHeight / 2);
    await sleep(randomRange(1200, 2000));
    
    // Extract current visible listings
    await extractData();
    
    // Update progress state to background
    chrome.runtime.sendMessage({
      action: 'updateResults',
      results: results,
      status: scrapeMode === 'deep'
        ? `Deep Scraping: collected ${results.length} / ${targetCount}`
        : `Scraped: ${results.length} / ${targetCount}`
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
    
    // Check if bottom reached or no new results loaded for 25s
    if (currentHeight === lastHeight && (Date.now() - lastChangeTime > 25000)) {
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

  // Notify background service worker of completion
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

// Validation routines
function isValidBusinessName(name) {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed === "") return false;
  
  // Ignore "+X More" entries and items starting/ending with "More"
  if (/\+\d+\s+More/i.test(trimmed)) return false;
  if (/^\d+\s+More/i.test(trimmed)) return false;
  if (trimmed.toLowerCase().endsWith('more')) return false;

  // Ignore junk items
  const junkPhrases = [
    'show number', 'get this list', 'top 10', "t&c's privacy policy", 
    't&c', 'privacy policy', 'get quotes', 'more...', 'add listing', 
    'advertise', 'sign up', 'login', 'pure veg', 'ratings', 'reviews', 
    'suggestions', 'verified', 'trusted'
  ];
  const lowerName = trimmed.toLowerCase();
  for (let junk of junkPhrases) {
    if (lowerName === junk || lowerName === 'n/a') {
      return false;
    }
  }
  return true;
}

// Advertisement Filter
function isAdvertisement(parent) {
  const adClasses = ['.ad-label', '.sponsored-label', '.resultbox_ad', '.ad-tag', '.ad-listed', '[class*="sponsored"]', '.sponsored', '.ad'];
  for (let cls of adClasses) {
    if (parent.querySelector(cls)) return true;
  }
  const badges = parent.querySelectorAll('span, div, p');
  for (let badge of badges) {
    const text = badge.innerText.trim();
    if (text === 'Ad' || text === 'AD' || text === 'Sponsored') {
      return true;
    }
  }
  return false;
}

// Regex Address Cleaner separating quoted review snippets and suggestion text
function cleanAddress(rawAddress) {
  if (!rawAddress || rawAddress === 'N/A') return 'N/A';
  let cleaned = rawAddress.trim();
  
  // 1. Remove quoted review snippets
  cleaned = cleaned.replace(/"[^"]*"/g, '');
  
  // 2. Remove suggestions
  cleaned = cleaned.replace(/\b\d+\s+Suggestions?\b/i, '');

  // 3. Remove ratings, reviews, and votes counts
  cleaned = cleaned.replace(/\b\d+\s+Rating[s]?\b/i, '');
  cleaned = cleaned.replace(/\b\d+\s+Review[s]?\b/i, '');
  cleaned = cleaned.replace(/\b\d+\s+Vote[s]?\b/i, '');
  
  // 4. Remove promotional words
  const promoKeywords = ['get quotes', 'enquire now', 'ratings', 'votes', 'suggestions'];
  promoKeywords.forEach(keyword => {
    cleaned = cleaned.replace(new RegExp(keyword, 'gi'), '');
  });

  // 5. Clean punctuation spacing
  cleaned = cleaned.replace(/,\s*,/g, ',');
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.trim();
  
  if (cleaned.startsWith(',')) cleaned = cleaned.substring(1).trim();
  if (cleaned.endsWith(',')) cleaned = cleaned.substring(0, cleaned.length - 1).trim();
  
  return cleaned || 'N/A';
}

// AJAX Deep Profile Fetcher parsing missing details
async function fetchProfileDetails(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const htmlText = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    
    const profileData = {};
    
    // 1. Website
    const webSelectors = [
      'a.website-link',
      'a[class*="web"]',
      'a[href*="website"]',
      'a.comp-web',
      'a[href^="http"]:not([href*="justdial.com"]):not([href*="facebook"]):not([href*="twitter"]):not([href*="instagram"]):not([href*="linkedin"]):not([href*="whatsapp"]):not([href*="wa.me"])'
    ];
    for (let sel of webSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.getAttribute('href')) {
        profileData.website = el.getAttribute('href').trim();
        break;
      }
    }

    // 2. Email
    const mailEl = doc.querySelector('a[href^="mailto:"]');
    if (mailEl) {
      profileData.email = mailEl.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
    } else {
      const textContent = doc.body ? doc.body.innerText : '';
      const emailMatch = textContent.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
      if (emailMatch) {
        profileData.email = emailMatch[0];
      }
    }

    // 3. Rating
    const ratingSel = ['.rating-value', '.rate_value', '.rating_value', '.votes_count', 'span[class*="rating"]', 'div[class*="rating"]', '.green-box'];
    for (let sel of ratingSel) {
      const el = doc.querySelector(sel);
      if (el && el.innerText.trim()) {
        const ratingMatch = el.innerText.trim().match(/\b[1-5]\.[0-9]\b/);
        if (ratingMatch) {
          profileData.rating = ratingMatch[0];
          break;
        }
      }
    }

    // 4. Reviews Count
    const reviewsSel = ['.votes_count', '.reviews_count', 'span[class*="vote"]', 'span[class*="review"]', '.votes_count_val'];
    for (let sel of reviewsSel) {
      const el = doc.querySelector(sel);
      if (el && el.innerText.trim()) {
        const votesMatch = el.innerText.trim().match(/\b\d+\b/);
        if (votesMatch) {
          profileData.reviews = votesMatch[0];
          break;
        }
      }
    }

    // 5. WhatsApp
    const waSel = ['a[href*="wa.me"]', 'a[href*="whatsapp"]', '[class*="whatsapp"] a', '[class*="whatsapp"]'];
    for (let sel of waSel) {
      const el = doc.querySelector(sel);
      if (el) {
        const href = el.getAttribute('href') || '';
        const phoneMatch = href.match(/(?:wa\.me|phone=)(\+?\d+)/);
        if (phoneMatch) {
          profileData.whatsapp = phoneMatch[1];
          break;
        }
      }
    }

    // 6. Category
    const catSel = ['.category_link', '.category_text', 'span[class*="category"]', 'a[class*="category"]', '.comp-cat'];
    for (let sel of catSel) {
      const el = doc.querySelector(sel);
      if (el && el.innerText.trim()) {
        profileData.category = el.innerText.trim();
        break;
      }
    }

    // 7. Years in Business
    const yrsMatch = doc.body ? doc.body.innerText.match(/\b(\d+)\s+Years?\s+in\s+Business\b/i) : null;
    if (yrsMatch) {
      profileData.years_in_business = yrsMatch[1];
    }

    // 8. Address / Location / Pincode
    const addrSelectors = ['.address_info', '.addr_text', '.store-address', '.comp-addr', '.contact-info'];
    let detailAddr = "";
    for (let sel of addrSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.innerText.trim()) {
        detailAddr = el.innerText.trim();
        break;
      }
    }
    if (detailAddr) {
      profileData.address = cleanAddress(detailAddr);
      const pinMatch = detailAddr.match(/\b\d{6}\b/);
      if (pinMatch) {
        profileData.pincode = pinMatch[0];
      }
      const parts = detailAddr.split(',');
      if (parts.length > 0) {
        profileData.location = parts[0].trim();
      }
    }
    
    return profileData;
  } catch (err) {
    console.error("Error fetching or parsing profile page:", url, err);
    return null;
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
      // 1. Business Name and URL
      let name = "";
      let detailUrl = "";
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
        if (el) {
          if (el.innerText.trim()) {
            name = el.innerText.trim();
          }
          if (el.tagName === 'A' && el.getAttribute('href')) {
            detailUrl = el.href;
          }
          if (name) break;
        }
      }

      if (!detailUrl) {
        const a = parent.querySelector('a');
        if (a && a.getAttribute('href')) {
          detailUrl = a.href;
        }
      }

      // Check Business Name validity
      if (!isValidBusinessName(name) || seenNames.has(name.toLowerCase())) {
        continue;
      }

      // Skip Advertisements
      if (isAdvertisement(parent)) {
        console.log("Skipped advertisement:", name);
        continue;
      }

      const cardText = parent.innerText || '';

      // 2. Phone Number (Clicking to reveal is optional and based on checkbox setting)
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
            if (el.classList.contains('callcontent') || el.innerText.includes('Show Number')) {
              try {
                el.click();
                await sleep(350);
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
          address = cleanAddress(el.innerText.trim());
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

      // Deep Scraping Profile Merge
      if (scrapeMode === 'deep' && detailUrl) {
        // Send state updates with profile info
        chrome.runtime.sendMessage({
          action: 'updateResults',
          results: results,
          status: `Deep Scraping: profile ${results.length + 1} / ${targetCount} (${name})`
        });
        
        await sleep(randomRange(500, 1000)); // rate limiting delay
        const profileDetails = await fetchProfileDetails(detailUrl);
        if (profileDetails) {
          if (profileDetails.website && profileDetails.website !== 'N/A') website = profileDetails.website;
          if (profileDetails.email && profileDetails.email !== 'N/A') email = profileDetails.email;
          if (profileDetails.rating && profileDetails.rating !== 'N/A') rating = profileDetails.rating;
          if (profileDetails.reviews && profileDetails.reviews !== 'N/A') reviews = profileDetails.reviews;
          if (profileDetails.whatsapp && profileDetails.whatsapp !== 'N/A') whatsapp = profileDetails.whatsapp;
          if (profileDetails.category && profileDetails.category !== 'N/A') category = profileDetails.category;
          if (profileDetails.years_in_business && profileDetails.years_in_business !== 'N/A') years_in_business = profileDetails.years_in_business;
          if (profileDetails.address && profileDetails.address !== 'N/A') address = profileDetails.address;
          if (profileDetails.pincode && profileDetails.pincode !== 'N/A') pincode = profileDetails.pincode;
          if (profileDetails.location && profileDetails.location !== 'N/A') location = profileDetails.location;
        }
      }

      // Push sanitised results
      results.push({
        name,
        phone,
        address,
        rating,
        reviews,
        website,
        whatsapp,
        email,
        location,
        category,
        years_in_business,
        opening_hours,
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
    website: 'Website',
    whatsapp: 'WhatsApp Number',
    email: 'Email',
    location: 'Location',
    category: 'Category',
    years: 'Years In Business',
    hours: 'Opening Hours',
    pincode: 'Pincode'
  };

  const allKeys = ['name', 'phone', 'address', 'rating', 'reviews', 'website', 'whatsapp', 'email', 'location', 'category', 'years', 'hours', 'pincode'];
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
      else if (key === 'website') val = item.website;
      else if (key === 'whatsapp') val = item.whatsapp;
      else if (key === 'email') val = item.email;
      else if (key === 'location') val = item.location;
      else if (key === 'category') val = item.category;
      else if (key === 'years') val = item.years_in_business;
      else if (key === 'hours') val = item.opening_hours;
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
