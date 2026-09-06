Investigation complete. Here's what I found.

---

# Authentication Investigation — ScreenFlow

## 1. Where authentication begins

There are **three independent client entry points** and **one server**. There is no single shared auth layer.

| Client | Entry point | Auth module |
|---|---|---|
| Desktop (Electron) | `apps/desktop/src/App.jsx:69` (`MainApp` mount effect) | `packages/ui/auth.js` |
| Chrome extension | `apps/chrome-extension/src/App.jsx:23` (popup mount effect) | `packages/ui/auth.js` |
| VS Code extension | `apps/vscode-extension/src/panel.js:529` (`checkAuth` IIFE inside webview HTML) | **its own inline copy** — imports nothing |

Server begins at `apps/server/index.js:20` → `app.use('/api/auth', authRoutes)`.

## 2. Complete flow

**Cold start / session restore**
1. `getStoredToken()` (`packages/ui/auth.js:34`) reads `localStorage['screenflow-token']`.
2. If present → `getMe(token)` (`auth.js:25`) → `GET /api/auth/me` with `Authorization: Bearer <jwt>`.
3. Server (`routes/auth.js:57-70`) checks the `Bearer ` prefix, `jwt.verify()`, then `User.findById(decoded.id).select('-password')`. Returns `{ email, createdAt }`.
4. Any failure → `clearToken()`; `authChecked` flips true; React renders `AuthView` instead of the app.
5. `if (!authChecked) return null` (`App.jsx:126` desktop / `:63` chrome) — a blank frame is the loading state.

**Login / signup**
1. `AuthView.handleSubmit` → `login()` / `signup()` → `POST /api/auth/login|signup`.
2. `signup` (`routes/auth.js:13`): length check ≥6 → `User.findOne` duplicate check → `User.create`. The bcrypt hash happens in the model's `pre('save')` hook (`models/User.js:24-28`, cost 12).
3. `login` (`routes/auth.js:37`): `User.findOne({email: lower.trim()})` → `user.comparePassword()` → `bcrypt.compare`.
4. `signToken()` (`routes/auth.js:8`): `jwt.sign({id, email}, JWT_SECRET, {expiresIn: '7d'})`, HS256 default.
5. Client writes `localStorage.setItem('screenflow-token', data.token)` **directly in AuthView**, not via `storeToken()`.
6. `onAuth(data)` sets React `user` state → app renders.

**Authorized API calls (server side)**
`requireAuth` in `apps/server/routes/recordings.js:17-26` — the only actual middleware. Sets `req.user` to the raw decoded JWT payload; handlers use `req.user.id` as the Mongo `userId`.

**Logout** — `clearToken()` + `setUser(null)`. Purely client-side.

## 3. Important files

- `apps/server/routes/auth.js` — signup / login / me, `signToken`
- `apps/server/routes/recordings.js` — `requireAuth`, all ownership scoping
- `apps/server/models/User.js` — bcrypt hashing, email normalization
- `apps/server/models/Recording.js` — `userId` ownership field, `shareId`
- `packages/ui/auth.js` — the shared client SDK + token storage
- `apps/{desktop,chrome-extension}/src/App.jsx` — the auth gate
- `apps/{desktop,chrome-extension}/src/components/AuthView.jsx` — the form
- `apps/vscode-extension/src/panel.js:440-537` — a *separate* auth implementation
- `apps/server/.env` — secrets (see §6)

## 4. Important functions

`signToken` · `requireAuth` · `userSchema.pre('save')` · `comparePassword` · `getMe` / `getStoredToken` / `storeToken` / `clearToken` · `AuthView.handleSubmit` · the `checkAuth` IIFE in `panel.js`.

## 5. Where state lives

| State | Location | Lifetime |
|---|---|---|
| Password hash | MongoDB `users.password` (bcrypt, cost 12) | permanent |
| JWT | `localStorage['screenflow-token']` (desktop + chrome) | 7 days, no server record |
| JWT (VS Code) | `vscode.setState({token, email})` — webview state | dies with the panel |
| User identity | React `user` state | per-render |
| Ownership | `Recording.userId` ObjectId | permanent |

**No cookies. No sessions. No server-side token store.** Nothing is revocable.

## 6. Security considerations

**Critical**
- **`apps/server/.env` is committed and not gitignored** (`.gitignore` only lists `node_modules/ dist/ out/ .DS_Store *.log`). It contains a live MongoDB Atlas connection string with credentials (`nishi:DHTiXkyUwhwRr6XF@cluster0...`) and the JWT secret. Both should be treated as compromised and rotated.
- **Hardcoded fallback secret** `'screenflow_jwt_secret'` in *two* places (`routes/auth.js:6`, `routes/recordings.js:10`). If `.env` fails to load, the server silently signs and accepts tokens anyone can forge. The `.env` value is also literally `screenflow_jwt_secret_change_in_production`.
- **IDOR in chunk upload** (`recordings.js:72-90`): `requireAuth` runs, but the handler never checks that `sessionId` belongs to `req.user.id`. Any authenticated user can write `chunk-*.bin` files into another user's session directory. `finalize` (`:105`) then concatenates *every* `chunk-*` file it finds — so a second user can inject bytes into someone else's recording before they finalize.

**Notable**
- `app.use(cors())` = `Access-Control-Allow-Origin: *`. Any website can call the API. Safe-ish only because the token is a header, not a cookie.
- No rate limiting on `/login` or `/signup`.
- User enumeration: signup returns `409 Email already registered`.
- JWT in `localStorage` is XSS-readable, and there's no revocation — logout leaves a valid 7-day token.
- Errors that aren't handled (invalid email format, duplicate-email race) fall into the generic `catch` and return `500 Server error` instead of `400`/`409`.

**Done correctly**
- bcrypt cost 12; password never returned (`.select('-password')`).
- Every recordings query is scoped `{_id, userId: req.user.id}` — except the chunk route.
- `storageKey` (an absolute server path) is stripped from list responses.
- `sessionId` is regex-sanitized before path joining, in both multer and the handlers.
- Electron main windows use `contextIsolation: true, nodeIntegration: false, sandbox: true`.

## 7. Non-obvious discoveries

1. **The authenticated API is entirely dead code.** `CloudUploader` (`packages/cloud/index.js`) is the only consumer of `/api/recordings/*`, and it is **imported nowhere**. `LibraryPanel` reads recordings from the local filesystem over IPC. In practice the JWT is used for exactly one thing: `GET /api/auth/me`. Auth is a login wall, not an access-control system.
2. **`packages/cloud/index.js` cannot be parsed.** Lines 133-231 are an orphaned fragment of an older class pasted below `export default CloudUploader;` (line 131), including a stray `}` at line 229 and a **second `export default` at line 231** — a duplicate default export is a hard `SyntaxError`. The moment anyone imports this module, the build breaks. This is likely *why* nothing imports it.
3. **`CloudUploader` would fail even if it parsed.** In `upload()` (`:50-53`) the FormData appends `chunk` (the file) *before* `chunkIndex`. Multer populates `req.body` only from fields seen earlier in the multipart stream, so `req.body.chunkIndex` is `undefined` in the `filename` callback (`recordings.js:39`) → `NaN` → every chunk rejected with `Invalid chunkIndex`.
4. **The docs actively contradict the code.** `docs/ARCHITECTURE.md:258` states *"JWT storage: In-memory only (React state), not localStorage"* — it is in localStorage in both GUI clients. It also claims `contextIsolation: true` on **all** windows; `regionOverlayWindow` uses `contextIsolation: false` (`main/index.js:643`). `README.md:250` documents `POST /api/auth/register`; the route is `/signup`. The docs call the User field `passwordHash`; it's `password`. The docs describe `POST /api/recordings/chunk`; it's `PUT /api/recordings/chunk/:sessionId`.
5. **Desktop sub-windows bypass the auth gate entirely.** `App()` returns early for `#/capture`, `#/hud`, and `#/toolbar` (`App.jsx:31-51`) *before* `MainApp` — those routes never check a token.
6. **`user` has two different shapes.** After login it's `{token, email}` (so the JWT lives in React state too); after session restore it's `{email, createdAt}`. Both happen to expose `.email`, which is all the UI reads.
7. **`allowDownload` and the share flow are decorative.** `GET /share/:shareId` returns metadata JSON only. There is no route and no `express.static` that serves the actual video file.
8. **VS Code auth is a third, divergent implementation** — no `/me` on a fresh panel unless prior state survived, no shared code, and token persistence tied to webview lifetime rather than disk.

## 8. Easy things to get wrong

- **Changing `requireAuth` won't secure `/me`.** `routes/auth.js:57` re-implements verification inline. Two copies of the logic, two copies of `JWT_SECRET`.
- **Changing the token storage key** requires touching four places: `packages/ui/auth.js` (×3) and *both* `AuthView.jsx` files, which bypass `storeToken()` and hardcode `'screenflow-token'` — and neither is wrapped in the `try/catch` that `storeToken` has.
- **Adding a client won't inherit auth.** The VS Code extension proves the pattern: nothing forces use of `packages/ui/auth.js`.
- **`API_URL` is hardcoded to `http://localhost:4000`** in `packages/ui/auth.js:1` and `panel.js:442`. No env override. Shipping to prod means editing source, plus the VS Code webview CSP (`panel.js:38`, `connect-src http://localhost:4000`).
- **Mongoose middleware ordering is load-bearing.** `minlength: 6` validates the *plaintext* only because Mongoose runs validation as a pre-save hook before user hooks. Reordering or switching to `updateOne` would silently validate the 60-char bcrypt hash instead — or skip hashing entirely, since `pre('save')` doesn't fire on update queries.
- **`dotenv` load order is load-bearing.** `index.js:8` loads `.env` before `require`ing the routes at lines 10-11, which read `process.env.JWT_SECRET` at module scope. Requiring a route module directly (a test, a script) gets the insecure fallback secret and mints tokens the server won't accept — or worse, accepts.
- **Adding a `GET /:id` route to `recordings.js` would shadow the public `GET /share/:shareId`** at line 199, since it's registered last.
- **`req.user` is the raw JWT payload**, not a User document. It has `id`, `email`, `iat`, `exp` — no roles, no freshness. A deleted user's token keeps working on every recordings route for the full 7 days; only `/me` does a DB lookup.

---

I made no changes to the repository. Want me to publish this as a shareable artifact page?