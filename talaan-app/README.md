# Talaan — Gabay sa Paggawa Nito Bilang Totoong Website (Turso edition)

Sundan mo lang ang mga hakbang na ito. Puro click-and-paste, maliban sa
2-3 file na i-e-edit mo sa GitHub website mismo.

**Paano gumagana ngayon:** ang login (Google sign-in) ay hawak ni
Firebase, pero ang datos mismo (learners, grades, attendance, atbp.)
ay nakatago sa **Turso** — isang SQLite database sa cloud. Hindi
direktang nakikipag-usap ang browser sa Turso; dumadaan muna ito sa
isang maliit na "gatekeeper" function (`api/data.js`) na siyang
nag-che-check kung may valid na Google login bago payagan ang
pagbasa/pagsulat ng data. Kaya ligtas ang password ng Turso mo kahit
public ang GitHub repo mo.

## Hakbang 1 — Gumawa ng Google login (Firebase Authentication)

1. Pumunta sa **https://console.firebase.google.com** at mag-sign in
   gamit ang Gmail mo.
2. **"Add project"** → pangalanan ("talaan" o kahit ano) → puwedeng
   i-off ang Google Analytics → Create.
3. Sa kaliwang menu: **Build > Authentication > Get started** → sa
   listahan ng providers, i-click **"Google"** → i-enable → piliin ang
   support email mo → **Save**.
4. Bumalik sa **Project Overview** (bahay icon) → i-click ang web icon
   **`</>`** para gumawa ng Web App → pangalanan → **"Register app"**.
5. Kopyahin ang buong `firebaseConfig = { apiKey: "...", ... }` na
   lalabas — gagamitin natin ito sa Hakbang 3. Tandaan din ang
   **`projectId`** dito — kakailanganin natin ulit mamaya.

## Hakbang 2 — Gumawa ng libreng database (Turso)

1. Pumunta sa **https://turso.tech** → **"Sign up"** (puwedeng gamit
   GitHub account).
2. Kapag naka-login ka na, hanapin ang **"Create Database"** button sa
   dashboard. Pangalanan ng "talaan-db", piliin ang lokasyon (kahit
   alin), i-create.
3. Kapag gawa na ang database, hahanapin mo ang:
   - **Database URL** (nagsisimula sa `libsql://...`)
   - **Auth Token** — kadalasan may button na **"Create Token"** o
     "Generate Token" sa database page mo; i-click iyon at kopyahin
     ang lumabas na token (mahaba itong text, magsisimula sa `eyJ...`).
4. I-save mo muna ang dalawang value na ito sa isang notepad — hindi
   na natin ito ilalagay sa code, dito lang sa Vercel settings mamaya
   (Hakbang 5) para hindi ito makita ng iba.

## Hakbang 3 — I-upload ang project sa GitHub

1. Pumunta sa **https://github.com** → gumawa ng libreng account kung
   wala ka pa.
2. I-click ang berdeng **"New"** → pangalanan ng `talaan-app` → piliin
   Public o Private → **"Create repository"**.
3. Sa page ng bagong repo, i-click ang **"uploading an existing file"**.
4. I-drag-and-drop ang **LAHAT ng laman** ng folder na ito: ang `src`
   folder, ang `api` folder, `index.html`, `package.json`,
   `vite.config.js`, `.gitignore`. (Huwag isama ang `node_modules` o
   `dist` kung meron.)
5. **"Commit changes"**.

## Hakbang 4 — I-paste ang Firebase config

1. Sa GitHub, buksan ang **`src/firebase.js`** → i-click ang pencil
   icon (Edit) sa kanan.
2. Palitan ang `const firebaseConfig = { ... };` ng kinopya mong
   config mula sa Hakbang 1, Step 5.
3. **"Commit changes"**.

## Hakbang 5 — I-deploy sa Vercel at ilagay ang mga sikretong susi

1. Pumunta sa **https://vercel.com** → mag-sign up gamit ang GitHub
   account mo.
2. **"Add New" > "Project"** → piliin ang `talaan-app` repo mo →
   **"Import"**.
3. **BAGO mag-Deploy**, i-expand ang seksyong **"Environment Variables"**
   sa import page (o puntahan mo ito sa Project Settings > Environment
   Variables kung na-deploy mo na). Idagdag ang lahat ng ito:

   | Name | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | yung `libsql://...` mula sa Hakbang 2 |
   | `TURSO_AUTH_TOKEN` | yung mahabang token mula sa Hakbang 2 |
   | `FIREBASE_PROJECT_ID` | yung `projectId` mula sa Hakbang 1 |
   | `ALLOWED_EMAIL_DOMAIN` | (opsyonal) hal. `deped.gov.ph` — iwanan blangko kung sinuman may Google account ay puwede |

4. I-click **"Deploy"**. Maghintay ng 1-2 minuto — may lalabas na link
   tulad ng `https://talaan-app.vercel.app`.
5. Bumalik sa Firebase Console > **Authentication > Settings >
   Authorized domains** → i-click **"Add domain"** → i-type ang
   Vercel domain mo (hal. `talaan-app.vercel.app`) → Add. *(Kailangan
   ito para gumana ang "Sign in with Google" sa live site mo.)*

Tapos na! Bawat pagbabago mo sa GitHub (halimbawa kung i-edit mo pa
ulit ang code gamit ako) ay awtomatikong mag-a-update sa live site —
walang karagdagang hakbang.

## Paalala

- Libre ang Firebase Authentication, ang Vercel hosting, at ang
  starter/free tier ng Turso — sapat na para sa isang klase o paaralan.
- Kailangang naka-login (Google) bago makapasok sa app. Kung sino man
  ang naka-login ay puwedeng mag-edit ng lahat ng klase — walang
  per-teacher permission pa. Gamitin ang `ALLOWED_EMAIL_DOMAIN` kung
  gusto mong limitahan sa email ng paaralan lang.
- Ang `TURSO_AUTH_TOKEN` at `TURSO_DATABASE_URL` ay hindi kailanman
  nasa code o sa browser — nasa Vercel Environment Variables lang sila,
  kaya ligtas kahit public ang GitHub repo mo.
- Puwede kang maglagay ng sariling domain (hal. talaan.mypaaralan.com)
  sa Vercel Project Settings > Domains, kung meron kang binili nang
  domain — ilagay lang din ito sa Firebase Authorized domains.
