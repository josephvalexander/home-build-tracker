# Home Build Tracker

A free, installable web app (PWA) for tracking the construction expenses of a new home. It works on iPhone and in desktop browsers, saves entries on the device so it works offline on site, and backs up and syncs through your own Google Drive.

- **Home**: spent vs budget, amount due, stage progress, spending by category, upcoming dues, recent entries
- **Expenses**: add or edit entries with amount, paid / due later, category, stage, vendor, milestone, qty × rate, payment mode, date and bill photos or PDFs; search and filter
- **Vendors**: agreed amount, paid, balance, payment milestones, transaction history
- **Budget & stages**: total budget, budget per stage (reorder, rename, add, delete), categories
- **Sync**: Google Drive folder `My Drive › Home Build Tracker` holds `data.json` and a `bills` folder

Plain HTML, CSS and JavaScript — no build step, no dependencies, no server.

**Cost: ₹0.** GitHub Pages hosting, Google Cloud OAuth and the Drive API are all free for this use. Your data lives in your Google Drive's existing free storage.

---

## 1. Put the code on GitHub Pages

The repository is **public** (free GitHub Pages needs that — only the code is public; your data never goes to GitHub).

Deployment is automatic: every push to `main` runs `.github/workflows/deploy.yml`, which stamps a unique build id into the files and publishes the site. In the repo, **Settings › Pages › Build and deployment › Source** must be set to **GitHub Actions**.

The app is live at `https://josephvalexander.github.io/home-build-tracker/`. Progress of each deploy shows under the repo's **Actions** tab.

The app works straight away without Google — entries are saved on the device. Set up step 2 to turn on backup and phone ↔ desktop sync.

## 2. Create the Google sign-in (one time, ~10 minutes)

1. Open <https://console.cloud.google.com/> and create a project, e.g. **Home Build Tracker**.
2. **APIs & Services › Library** → search **Google Drive API** → **Enable**.
3. **Google Auth Platform** (OAuth consent screen):
   - **Branding**: app name *Home Build Tracker*, your email as support and developer contact.
   - **Audience**: User type **External**. Leave it in **Testing** and under *Test users* add your own Gmail address.
   - **Data access**: **Add or remove scopes** → tick `.../auth/drive.file` ("See, edit, create and delete only the specific Google Drive files you use with this app") → Save.
4. **Clients › Create client** → Application type **Web application**:
   - **Authorized JavaScript origins**: `https://josephvalexander.github.io`
   - **Authorized redirect URIs**: `https://josephvalexander.github.io/home-build-tracker/` (exactly this, including the trailing `/`)
   - Create, then copy the **Client ID**.
5. Paste it into `js/config.js`:
   ```js
   GOOGLE_CLIENT_ID: '1234567890-abc123.apps.googleusercontent.com',
   ```
   Commit and push.

Because the app is in *Testing* and uses only the `drive.file` permission, no Google review is needed. The first time you connect, Google shows a "Google hasn't verified this app" screen — tap **Continue**. `drive.file` means the app can only see the files it creates, never the rest of your Drive.

## 3. Install it

**iPhone** — open the URL in **Safari** → Share button → **Add to Home Screen**. Always open it from the home-screen icon: iOS protects an installed app's storage, but may clear a website's storage after a few weeks without use.

**Windows** — open the URL in Chrome or Edge → click the install icon in the address bar (or menu › *Install app*). It opens in its own window.

Then in the app go to **Settings › Connect Google Drive** on each device.

## How sync works

- Every save goes to the device first (instant, works offline), then syncs to Drive a few seconds later when online. The pill at the top shows the status.
- Opening the app (or switching back to it) pulls the latest data from Drive, so an entry made on the phone appears on the desktop.
- Each record keeps a last-modified time; if the same entry was edited on two devices, the newer edit wins. Deletes sync too.
- Bill photos are compressed on the phone (about 1600 px, roughly 200–400 KB) before saving. They're stored in the Drive `bills` folder and downloaded to another device the first time you open them.
- Google's sign-in from a browser lasts about an hour. When it has expired the pill shows **Tap to sync** — one tap re-signs you in silently and syncs. Entries are never lost while waiting; they stay on the device.

## Releasing an update

Just push to `main`. The workflow replaces `__BUILD__` in `sw.js` and `js/config.js` with a new build id (date, run number and commit), so each deployment is a new service worker. Installed apps check for a new version whenever they're opened or brought back to the front (and every 15 minutes while open), download it in the background, then refresh themselves and show "Updated to the latest version". If you're in the middle of filling a form, the refresh waits until you leave it. The current build id is shown in **Settings › About**.

## Testing locally (optional)

```bash
python3 -m http.server 8080
```
Open <http://localhost:8080/>. To test Google sign-in locally, also add `http://localhost:8080` as a JavaScript origin and `http://localhost:8080/` as a redirect URI on the OAuth client.

## Files

```
index.html             app shell
css/app.css            styles (mobile first, desktop layout from 900 px)
js/app.js              screens, routing, forms
js/db.js               on-device storage (IndexedDB)
js/drive.js            Google sign-in and Drive sync
js/util.js             money/date formatting helpers
js/config.js           your Google Client ID
sw.js                  offline support and updates
manifest.webmanifest   install metadata
icons/                 app icons
```
