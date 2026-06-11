# JustDial Scraper — Chrome Extension

A lightweight, powerful Manifest V3 Google Chrome Extension that extracts business names, addresses, and phone numbers from JustDial listing pages. 

Because it runs directly inside your local residential browser, it uses your own local IP address and session cookies. This successfully bypasses cloud IP blacklist blocks (like AWS, Heroku, or Render) and anti-bot layers.

---

## ✨ Features
- **Residential Scraping**: Bypasses cloud host IP block firewalls by running locally.
- **Excel-Compatible Export**: Downloads directly as a SpreadsheetML Excel sheet (`.xls`) to prevent Microsoft Excel from dropping leading zeros in phone numbers.
- **Glassmorphism Dark Theme**: Modern, premium dark UI with status indicators and micro-animations.
- **Background Scrape State**: Scraping runs in a background service worker. If the popup closes, the scraper keeps working in the tab and retains your data.
- **Popup Bypassing & Auto-Scrolling**: Automatically dismisses "maybe later" modals and scrolls down to trigger lazy loading.

---

## 🚀 How to Install

1. Open **Google Chrome** on your computer.
2. Navigate to **`chrome://extensions/`** by typing it in the address bar.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. In the top-left corner, click the **Load unpacked** button.
5. Select the **`extension`** folder inside this repository.
6. The extension is now loaded! Pin it to your toolbar by clicking the puzzle piece icon next to your profile picture.

---

## 🕷️ How to Use

1. Click the **JustDial Scraper** icon in your Chrome toolbar.
2. Enter the search parameters:
   - **City**: e.g., `Mumbai`
   - **Keyword**: e.g., `Bike Dealers`
   - **Record Limit**: e.g., `50`
3. Click **Start Scraping**.
4. A new background tab will open and automatically scroll through JustDial to load and collect listings.
5. Once completed (or if you click **Stop**), click **Download Excel** to save the spreadsheet to your device.
