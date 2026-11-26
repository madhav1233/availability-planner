# Availability planner

A shared monthly calendar for a project team. Everyone signs in, adds their own blocks of time ("Travel", "Working, free on evenings", "Free all day, prefers evenings"…), and the planner shows who's free each day, when they'd rather work, and whether they can be reached.

- **Hosting:** GitHub Pages (the `docs/` folder).
- **Accounts and data:** Firebase Authentication + Cloud Firestore, free Spark plan.
- **Who can do what** (enforced by `firestore.rules`, not just the page):
  - Anyone can create an account, but they only get a "waiting for approval" screen.
  - Only the admin can approve, decline or remove people.
  - Approved people can see everyone's blocks but **create, change and delete only their own**.
  - Only the admin can create, edit or delete **Types**.
  - People's emails are visible only to themselves and the admin.

The rules are tested in `tests/rules.test.mjs`; GitHub Actions runs those tests on every push (see the Actions tab).

---

## One-time setup (about 15 minutes)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> → **Create a project**. Any name, e.g. `availability-planner`. You can switch Google Analytics off.
2. You stay on the free **Spark** plan; no card needed.

### 2. Turn on sign-in
1. **Build → Authentication → Get started**.
2. **Sign-in method** tab: enable **Email/Password**. Optionally also enable **Google** (pick a support email).
3. **Settings** tab → **Authorized domains** → **Add domain** → `madhav1233.github.io`.

### 3. Create the database and paste the rules
1. **Build → Firestore Database → Create database**.
2. Location: `australia-southeast1` (Sydney) or `australia-southeast2` (Melbourne). This can't be changed later.
3. Start in **production mode**.
4. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.

### 4. Connect the website to Firebase
1. Project settings (gear icon) → **Your apps** → the **Web** icon `</>` → register an app (no need for Firebase Hosting).
2. Copy the `firebaseConfig` values into [`docs/config.js`](docs/config.js) and commit.
   These values are not secret. Firebase expects them to be public; the rules are what protect the data.

### 5. Switch on GitHub Pages
Repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, Branch **main**, folder **/docs** → Save.
After a minute the site is at `https://madhav1233.github.io/<repo-name>/`.

### 6. Make yourself the admin
1. Open the site, **Create account**. You'll land on "Waiting for approval"; it shows **your user ID**. Copy it.
2. In Firebase: **Firestore Database → Data → Start collection** → Collection ID `admins` → Document ID = **your user ID** → add any field (e.g. `note` = `owner`) → Save.
3. Reload the site. You're approved automatically and see the **Types** and **Team** panels.
4. Click **Add the starter types** (or make your own).

### 7. Invite the team
Send them the link. They create an account, you approve them under **Team → Waiting for approval**, and their page opens automatically.

---

## Day to day
- **Remove someone:** Team → Remove (click twice to confirm). Their blocks are deleted and they lose access at once.
- **Declined by mistake:** they appear under "Declined or removed"; click Approve.
- **Rename a type:** Types → Edit. A type that's in use can't be deleted, only renamed.
- **Change the page title or the name shown as approver:** `planner` in `docs/config.js`.
- **Change the brand colour:** `--sky` near the top of `docs/index.html` (currently EEEWA light blue, `#4CB8E6`). Everyone can pick Light, Dark or Match device under **Your account → Appearance**.

## Optional hardening
- In Google Cloud console → APIs & Services → Credentials, restrict the browser API key to `https://madhav1233.github.io/*`.
- Firebase → Authentication → Settings: keep **Email enumeration protection** on (default for new projects).
- To add another admin, create `admins/<their user ID>` the same way.

## Running the rule tests locally
Needs Node 20+ and Java 21+.
```bash
npm ci
npm test
```

## Files
| Path | What it is |
|---|---|
| `docs/index.html`, `docs/app.js` | The website |
| `docs/config.js` | Your Firebase settings + page title |
| `firestore.rules` | Who can read and write what |
| `tests/rules.test.mjs` | Tests that prove the rules do what this README says |
| `.github/workflows/rules.yml` | Runs those tests on GitHub |
