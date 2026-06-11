# JustDial Scraper Chrome Extension

Running the scraper as a Chrome Extension runs the scraper directly inside your **local residential browser context**, using your own residential IP address and user session. This bypasses JustDial's firewall (which blocks cloud server IP ranges like AWS, Heroku, or Render).

---

## 🚀 How to Install

1. Open **Google Chrome** on your computer.
2. Navigate to **`chrome://extensions/`** by typing it in the address bar.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. In the top-left corner, click the **Load unpacked** button.
5. Select the **`extension`** folder inside this project directory.
6. The extension is now loaded! Pin it to your toolbar by clicking the puzzle piece icon next to your profile picture.

---

## 🕷️ How to Use

1. Click the **JustDial Scraper** icon in your Chrome toolbar.
2. Enter the parameters:
   - **City**: e.g., `Mumbai`
   - **Keyword**: e.g., `Dentists`
   - **Record Limit**: e.g., `50`
3. Click **Start Scraping**.
4. A new background tab will open and automatically scroll through JustDial to load and collect listings.
5. Once completed (or if you click **Stop**), click **Download CSV** to download the results file.
