# ChordTile: Pre-Launch Audit Report

**Date:** 2026-11-04
**Scope:** The whole repository (`index`, `player`, `help`, `licenses` and `account` pages, the legacy redirect pages, the Supabase schema and edge functions, and the Stripe integration). It also covers the live Supabase project's configuration, read-only through the Supabase management API.
**Method:**
- Code review.
- Automated browser tests with Playwright 1.x and Chromium, run against the **production build** (`vite build` + `vite preview`) and the **development build** (`vite`).
- axe-core 4.10.2 for WCAG.
- Lighthouse 12.2.1 for performance, SEO and best practices.
- `npm audit`, `tsc --noEmit` and the existing Vitest suite.

Every result below was measured in this session. Anything that could not be tested is listed as such in section D and section K.

---

## A. Executive Summary

**Overall assessment.** ChordTile is a well-built, focused product.

The core journey (open the site → load a Guitar Pro file → see the colour chart and synced tab → play, slow down, loop, expand a bar, learn section by section) works end to end. It worked in every automated run, on desktop and on mobile.

The code is typed and consistent, and has no known-vulnerable dependencies. Database access is protected by row-level security. The interface is consistent across the six tested screen sizes and has no horizontal overflow.

**General product quality.** High for an early-stage SaaS.
- After the fixes in this audit, axe reports **0 WCAG 2.2 AA violations** on all five pages, at both desktop and mobile widths.
- Lighthouse scores **100** for Accessibility and Best Practices on every page.
- Layout shift (CLS) is **0** everywhere.

**Main risks.**
1. **CRITICAL – payments are in Stripe *test mode* in the production config.** All three Payment Links and the billing-portal link in `.env.production` are `test_` links. Real customers cannot pay. Anyone can get Premium with Stripe's public test card, because the deployed webhook accepts any paid checkout as a lifetime purchase. This must be fixed by the owner in Stripe before launch.
2. **HIGH – the account, sync and payment flows could not be tested end to end.** The sandbox has no network access to Supabase or Stripe. Creating real accounts would also touch production data, which the audit rules forbid. These flows were reviewed in code, and their error handling was tested offline. A real sign-up → trial → purchase → sync → delete-account run on the live site is still required (checklist in K).
3. **MEDIUM – the player is slow on throttled mobile.** On Lighthouse's Slow-4G and 4× CPU profile, LCP is 7.1 s and the performance score is 60–69. The cause is the 1.1 MB alphaTab engine plus the 1 MB sound bank. Desktop scores 96.
4. **MEDIUM – two edge-function fixes from this audit are not deployed yet.** As instructed, nothing was deployed.

**Launch readiness:** **CONDITIONALLY READY FOR LAUNCH.** Ready once the Stripe items in K are done and the live account and payment checklist passes (details in L).

---

## B. Technology and Architecture Overview

**Stack**

| Area | Technology |
|---|---|
| Front end | Vite 7 multi-page site in TypeScript (no framework). Five HTML entry points; relative base `./`. |
| Hosting | GitHub Pages: static, deployed from `main` by `.github/workflows/deploy.yml` after `npm test` and `npm run build`. |
| Score engine | alphaTab 1.8.4, vendored to `public/vendor/alphatab` by `npm run vendor`. Renders the tab and synthesises audio in a Web Worker with the SoundFont `sonivox.sf3`. |
| Accounts and data | Supabase: Auth, a `songs` table, a private storage bucket `songs`, and an `entitlements` table with a trial trigger. Edge functions: `stripe-webhook` and `delete-account`. |
| Payments | Stripe Payment Links plus the customer portal. The webhook writes entitlements. |
| PDF | jsPDF and html2canvas, both lazy-loaded. |
| Tests | Vitest (68 unit tests) and the new Playwright journey script `qa/e2e.cjs`. CI runs typecheck, tests and build. |

**Main components**
- `src/main.ts` (about 1,600 lines): the player app, which covers the chart, tab, transport, practice tools, library, settings, tour and the Tile by Tile learn mode.
- `src/app/*`:
  - Pure modules: `plan`, `metro-grid`, `notes`, `count`, `sync`, `auth-errors`.
  - Integration modules: `cloud`, `billing`, `library`, `metro-inject` and `pdf`.
- `src/landing.ts`, `src/account.ts`, `src/doc.ts`: the other pages.

**Architecture assessment**
- Appropriate for the product. Files are parsed only in the browser, and the static hosting is cheap and robust.
- Supabase access uses RLS and owner-only storage folders.
- The metronome is injected into alphaTab's own audio stream, which gives sample-accurate timing.
- Feature gating (`plan.ts`) is pure and unit-tested.

**Technical debt**
- `src/main.ts` is a single large module. It works and is readable, but splitting the library, settings, tour and learn mode into modules would reduce risk for future changes.
- alphaTab is loaded as a 1.1 MB render-blocking classic script, because Vite hoists the app module into `<head>`, so `defer` would break it (verified, see F).
- No E2E test runs in CI yet. `qa/e2e.cjs` is ready but needs `playwright` as a dev dependency.
- GitHub Pages cannot set HTTP security headers (see E).

---

## C. UI/UX Assessment

**Visual quality.**
- The red, black and white brand is applied consistently: shared radius and height tokens (`--r-*`, `--h-ctl*`) and the same button family across pages.
- Dark and light themes both work.
- The landing page shows the product in an animated demo, without scrolling, on desktop.

**Navigation.**
- Every page links back to the player and to the help and legal pages.
- The legacy Portuguese URLs (`ajuda`, `leitor`, `licencas`, `learn`) redirect correctly (tested).
- 26 internal links checked: **0 broken**, all anchors resolve.
- Before this audit there was no 404 page. One was added.

**Responsiveness.** Tested on 5 pages × 6 viewports (1920×1080, 1440×900, 1024×768, 768×1024, 390×844, 360×800), with touch and mobile emulation below 800 px.

| Check | Result |
|---|---|
| Horizontal overflow | **0 pages** |
| Overlapping controls | Only expected overlays: the fixed bottom dock over the scrolling chart, the eye icon inside the password field, and a wrapped inline link |
| Touch targets | Below 24 px before this audit: the landing nav links (13 px tall), footer links, "Try the sample" link, "Forgot your password?" button and the logo-only home link on mobile. All fixed. |

What still flags as under 24 px are all exempt: inline links inside sentences, the visually hidden file input, and the track `<select>` (the clickable target is its 44 px label).

**Usability.**
- First visit starts a short tour that can be skipped.
- Locked features explain why they are locked and offer the next step. As a guest, clicking Loop shows "Create your free account — Loop, speed, the metronome and the other practice tools need a free account" (tested).
- Errors are specific and in plain language (see D).

**Design inconsistencies found**
- The focus ring was missing on the four landing "steps" buttons (`all: unset` removed it). Fixed.
- The track select and text inputs show focus only as a border-colour change. That is intentional (requested earlier: no ring on dropdowns and inputs). It is weaker than an outline, but still visible. Logged as LOW.

---

## D. Functional Assessment

Run with `node qa/e2e.cjs <base> <label>` (Playwright, Chromium, 1440×900).

| # | Journey / feature | Dev build (all unlocked) | Production build (guest, cloud unreachable) |
|---|---|---|---|
| 1 | Landing renders, one `h1`, load CTA | PASS | PASS |
| 2 | Landing → import valid `.gp5` → opens in player (52 bars, title "Exemplo") | PASS | PASS |
| 3 | Landing rejects an empty file with a message | PASS | PASS |
| 4 | "Try the sample" opens the demo song | PASS | PASS |
| 5 | Player imports `.gp3` and `.gp4` | PASS | PASS |
| 6 | Corrupt file → clear error, current song kept | PASS | PASS |
| 7 | 21 MB file refused before parsing *(new guard)* | PASS | PASS |
| 8 | Empty file refused *(new guard)* | PASS | PASS |
| 9 | Play → time advances (2,415 ms in 2.5 s) → pause holds → resume continues | PASS | PASS |
| 10 | Space toggles play/pause | PASS | PASS |
| 11 | Guest gating shows sign-up prompt; Esc closes it | n/a (unlocked) | PASS |
| 12 | Speed menu 50 % sets `playbackSpeed` to 0.5 | PASS | gated (as designed) |
| 13 | Loop / metronome / count-in toggles | PASS | gated (as designed) |
| 14 | Next / previous bar | PASS | PASS |
| 15 | Tab view renders | PASS | PASS |
| 16 | Expand bar → modal → Esc closes | PASS | Premium-gated |
| 17 | Note on a bar survives reload | PASS | account-gated |
| 18 | Setting "squares per row" survives reload | PASS | PASS |
| 19 | Theme survives reload | PASS | PASS |
| 20 | My songs lists the song; delete (with in-place confirm) removes it | PASS (1 → 0) | PASS (1 → 0) |
| 21 | PDF export downloads `exemplo-chart.pdf` (242 KB) | PASS | Premium-gated |
| 22 | Learn mode (`?learn`): step 1 → 2 | PASS | gate shown (as designed) |
| 23 | Help, licenses and account pages load (HTTP 200) | PASS | PASS |
| 24 | Legacy URLs redirect | PASS | PASS |
| 25 | 404 page present in build | PASS | PASS |
| 26 | No uncaught JS errors in the whole run | PASS | PASS |

**Totals:** dev 26/26 PASS, production 26/26 PASS.

**Account form, production build, server unreachable** (`auth.cjs`)

| Case | Result |
|---|---|
| Empty or invalid email | "Enter a valid email address." |
| Short password | "Use at least 8 characters." |
| Password with no number | "Use letters and at least one number." |
| Show-password toggle | Works |
| Sign in with no network | After 0.7 s: "Couldn't reach the server. Check your connection and try again." The submit button is re-enabled. |

**Keyboard** (`kbd.cjs`)
- 23–25 tab stops per page, all with a visible focus indicator (inputs use a border change).
- Esc closes Settings and focus returns to the Settings button.

**Earlier sessions (same codebase):** metronome alignment against alphaTab's own click is a constant 0.18 ms offset with zero jitter. Mobile flows (dock, bar bar, modal, library, settings, paywall, tour) were checked on iPhone SE, iPhone 14 and its landscape view, and Pixel 7.

**Untested: needs live services or real accounts**
- Sign-up email confirmation, sign-in with a real account, password reset email, email change.
- The 14-day trial trigger, and Free and Premium gating with a real entitlement.
- Cloud sync of songs between two devices; the song-limit enforcement on the server.
- Stripe checkout, the webhook writing the entitlement, the customer portal, subscription cancel and renew.
- Account deletion (the `delete-account` edge function).

**Critical user journey (registration → importing and using a tab)**
- The **guest** half was tested and passes: import, play, practise, save to My songs.
- The **registration** half is untestable here. Its client-side validation and failure paths pass.

---

## E. Security Assessment

| ID | Finding | Risk | Status |
|---|---|---|---|
| SEC-1 | Stripe Payment Links and portal URL in `.env.production` are **test-mode** (`buy.stripe.com/test_…`, `billing.stripe.com/p/login/test_…`). With a test-mode webhook secret, test card 4242… gives anyone lifetime Premium; real cards cannot pay. | **CRITICAL** | **Owner action** (K-1). Values not reproduced here. |
| SEC-2 | `stripe-webhook` grants **lifetime** for *any* `mode=payment` paid checkout on the account. A future one-off product, such as a gift card, would also unlock lifetime. | LOW (no such product today) | Recommendation: check the price ID. |
| SEC-3 | Webhook signature comparison was not constant-time. | LOW | **Fixed** (not deployed) |
| SEC-4 | `delete-account`: storage cleanup loop could spin forever if `remove` failed, and errors were ignored. | MEDIUM | **Fixed**: bounded to 50 rounds, list and remove errors abort (not deployed) |
| SEC-5 | Supabase Auth **leaked-password protection is disabled** (Supabase security advisor, live project). | MEDIUM | **Owner action** (K-3): one switch in the dashboard |
| SEC-6 | No client-side size check: a huge file was read fully into memory, which can freeze the tab. | MEDIUM | **Fixed**: refuses files over 20 MB (same as the bucket limit) and empty files, on both upload paths |
| SEC-7 | No HTTP security headers (CSP, X-Frame-Options, and so on); GitHub Pages cannot set them. | LOW | Recommendation: a `<meta http-equiv="Content-Security-Policy">` needs `worker-src blob:`, the Supabase origin and an inline-script hash. It must be tested carefully, so it was not added blindly. |
| SEC-8 | `songs` table text columns have no length limits; the bucket has no MIME restriction. | LOW | Recommendation: add `check (char_length(title) <= 200)` and similar in a new migration (not run: no DB changes without approval). |
| SEC-9 | Supabase session token in `localStorage` (supabase-js default). | INFO | Acceptable given no XSS sinks (below). |

**Verified as sound**
- **XSS:** all 21 `innerHTML` uses were reviewed.
  - Every one is a static string, a hard-coded demo string, or user and file text passed through `esc()`.
  - Song titles, section names, notes and track names use `textContent`.
  - No `eval`, `new Function` or `document.write`.
- **RLS:** enabled on `songs` and `entitlements` in the live project, confirmed through the management API.
  - Policies are owner-only.
  - Inserts are gated on Premium through `private.is_premium()`, which is in a schema the client cannot reach.
  - Storage paths are limited to the owner's folder.
- **Advisors:** the Supabase performance advisor reports no issues.
- **Secrets:** the front end holds only the public anon key. Service-role and webhook secrets exist only in edge-function env vars, and none appear in the repository.
- **Edge-function auth:** `delete-account` has `verify_jwt` on; `stripe-webhook` has it off but checks the signature (with a 5-minute tolerance).
- **Dependencies:** `npm audit` reports **0 vulnerabilities**, dev dependencies included.

---

## F. Performance Assessment

**Lighthouse 12.2.1, production build** (`vite preview`, no gzip; GitHub Pages serves gzip, so real transfer sizes are smaller). Mobile uses Lighthouse's default Slow-4G and 4× CPU throttling.

| Page | Device | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|---|
| index | mobile | 100 | 100 | 100 | 92 | 0.9 s | 1.1 s | 20 ms | 0 |
| index | desktop | 100 | 100 | 100 | 92 | 0.4 s | 0.4 s | 0 ms | 0 |
| player | mobile | 60–69 (3 runs) | 100 | 100 | 92 | 1.4–3.6 s | 7.1 s | 300–370 ms | 0 |
| player | desktop | 96 | 100 | 100 | 92 | 0.7 s | 1.4 s | 10 ms | 0.001 |
| help | mobile | 99 | 100 | 100 | 92 | 1.7 s | 1.7 s | 0 ms | 0.001 |
| help | desktop | 100 | 100 | 100 | 92 | 0.4 s | 0.4 s | 0 ms | 0 |
| licenses | mobile | 99 | 100 | 100 | 92 | 1.7 s | 1.7 s | 0 ms | 0 |
| licenses | desktop | 100 | 100 | 100 | 92 | 0.4 s | 0.4 s | 0 ms | 0 |
| account | mobile | 99 | 100 | 100 | 58* | 1.6 s | 2.1 s | 0 ms | 0 |
| account | desktop | 100 | 100 | 100 | 58* | 0.4 s | 0.5 s | 0 ms | 0 |

\* The account page is intentionally `noindex`. The 92 everywhere else is the robots.txt check against the local preview server (see H).

**Before → after this audit**

| Page | Metric | Before | After | What changed |
|---|---|---|---|---|
| Player, mobile | CLS | **1.086** | **0** | Space is reserved for the chart and the song meta line before the song loads, and the tour highlight moves by `transform` instead of `left`/`top`. |
| Player, mobile | Performance | 32 | 60–69 | Same fixes |
| Help, mobile | CLS | **0.211** | **0.001** | Metric-matched fallback fonts (`size-adjust` / `ascent-override`), so the Roboto swap no longer moves text |
| Help, mobile | Performance | 89 | 99 | Same fix |

**Bundle (production)**

| Asset | Size | Loading |
|---|---|---|
| Player JS | 75 KB (27 KB gzip) | |
| Supabase client | 229 KB (60 KB gzip) | |
| jsPDF | 386 KB | Lazy |
| html2canvas | 201 KB | Lazy |
| alphaTab | 1.12 MB | Blocking |
| Sound bank | 977 KB | |
| CSS | 54 + 18 KB | |
| `dist` total | 5.2 MB | |

**Bottlenecks**
- The player's LCP on slow mobile is bound by downloading and parsing alphaTab, then parsing the song and rendering the chart.
- Making alphaTab `defer` was tried. It cut LCP to 4.0 s but **broke the app**: Vite hoists the module script into `<head>`, so it runs before a deferred classic script. The change was reverted.

**Recommended optimisations** (not done: architectural)
- Load alphaTab with a dynamic `import()` or `<link rel="preload">` and start the app after it.
- Fetch the sound bank only on the first Play.
- Measure on the real gzip-serving host. The local preview server sends alphaTab uncompressed, about 1.1 MB compared with an estimated 300 KB gzipped.

---

## G. Accessibility Assessment

axe-core 4.10.2 (rulesets wcag2a/aa, 21a/aa, 22aa and best-practice) at 1440 and 390 px, plus Lighthouse.

**Fixed in this audit**

| WCAG | Issue | Fix |
|---|---|---|
| 1.4.3 contrast | Landing grey text `#8c8c8c` on white = 3.36:1 (inactive step text, footer) | `--ink-3` → `#6b6b6b` (≥ 4.5:1) |
| 1.4.3 contrast | Help colour key: "A" chip, dark text on violet = 4.31:1 | Note label ink `#121212` → `#000` (4.84:1) |
| 4.1.2 name | Mobile Settings button had no accessible name (label hidden) — *critical* | `aria-label="Settings"` |
| 2.4.4 / 4.1.2 | Mobile logo-only home link had no name | `aria-label="ChordTile home"` |
| 2.1.1 keyboard | Scrollable tab panel and help tables not focusable | `tabindex="0"` + `role="region"` + label |
| 1.3.1 | Landing had no `<main>` landmark; player dock outside landmarks | `<main class="page">`; dock `role="region"` |
| 1.3.1 / 2.4.6 | Account page (signed out) had no `h1` | Sign-in title rendered as `h1` there |
| 1.3.1 | Empty table header in help | Visually hidden "Feature" |
| 4.1.2 | `aria-label` on plain `div`s (note key, bar modal parts) | `role="group"` |
| 2.4.7 focus visible | Landing step buttons had no focus ring | `:focus-visible` outline |
| 2.5.8 target size | Nav, footer and "Try the sample" links, "Forgot password" button, mobile logo were under 24 px | Padding or min-size added |

**Result:** **0 axe violations** on all 5 pages at both widths, and Lighthouse Accessibility 100 everywhere.

**Remaining improvements (LOW)**
- Give inputs and selects a stronger keyboard focus indicator, for example an outline only in `html[data-input=keyboard]`.
- Test with a real screen reader (VoiceOver or NVDA), especially the chart grid and the bar modal.
- `prefers-reduced-motion` is respected for the tour. Check the landing animation too.

---

## H. SEO Assessment

**Technical SEO**
- Static HTML with real text content, `lang="en"`, viewport meta, theme colour, favicon (ICO and SVG), Apple touch icon and web manifest.
- Each page has a unique `<title>` and meta description. Fast pages.

**Added in this audit**
- `<link rel="canonical">` on every page (base `https://msantos51.github.io/ChordTile/`, as documented in the README).
- Open Graph (`og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image`) and `twitter:card` on the public pages.
- `noindex` on `account.html`.
- `public/sitemap.xml` with the 4 public pages.
- `public/404.html`: a self-contained page with absolute links, so it also works for nested missing paths on GitHub Pages.

**Indexability**
- All public pages are indexable. The account page is `noindex`.
- **robots.txt:** GitHub Pages *project* sites live under `/ChordTile/`. Crawlers only read `https://msantos51.github.io/robots.txt`, which this repository cannot control. A `/ChordTile/robots.txt` would be ignored, so none was added. Submit the sitemap in Google Search Console instead.

**Missing elements**
- A proper 1200×630 social preview image: the OG image is currently the 512 px app icon.
- Structured data (`SoftwareApplication` JSON-LD).
- A custom domain, which would also allow a real robots.txt and keep URLs stable.
- **Confirm the canonical domain.** If the site will move to a custom domain, update the canonical and OG URLs and the sitemap.

---

## I. Bug and Issue Register

| ID | Sev. | Page / component | Description | Steps to reproduce | Expected | Actual (before) | Solution | Status |
|---|---|---|---|---|---|---|---|---|
| SEC-1 | CRITICAL | Payments / `.env.production` | Stripe links are test-mode | Open "Go Premium" on the live site | Live checkout | Test-mode checkout; test card unlocks Premium | Create live Payment Links and portal; use live webhook secret; rebuild | **Owner** |
| QA-1 | HIGH | Accounts, sync, payments | Not verifiable from the audit environment | — | Verified end to end | Untested | Run the live checklist in K-4 | **Owner** |
| PERF-1 | HIGH | Player (mobile) | Layout shift CLS 1.09 on load | Lighthouse mobile on `player.html` | CLS < 0.1 | 1.086 | Reserve chart and meta space; tour moves by `transform` | **Fixed** (0) |
| A11Y-1 | HIGH | Player (mobile) | Settings button had no accessible name | axe at 390 px | Named | "button-name" (critical) | `aria-label` | **Fixed** |
| SEC-4 | MEDIUM | `delete-account` | Possible endless cleanup loop; errors swallowed | Storage `remove` fails | Error returned | Loops forever | Bounded loop + error checks | **Fixed**, needs deploy |
| SEC-5 | MEDIUM | Supabase Auth | Leaked-password protection off | Supabase security advisor | Enabled | Disabled | Auth → Providers → Email → enable | **Owner** |
| SEC-6 | MEDIUM | File import | No size or empty-file check | Load a 21 MB file | Refused with message | Read into memory | 20 MB and empty guards | **Fixed** |
| PERF-2 | MEDIUM | Help (mobile) | Font swap layout shift | Lighthouse mobile `help.html` | CLS < 0.1 | 0.211 | Metric-matched fallback fonts | **Fixed** (0.001) |
| PERF-3 | MEDIUM | Player (mobile) | LCP 7.1 s on Slow 4G | Lighthouse mobile | < 2.5 s | 7.1 s | Lazy-load alphaTab and sound bank (see F) | Open |
| A11Y-2 | MEDIUM | Landing, help | Text contrast < 4.5:1 | axe | ≥ 4.5:1 | 3.36:1 / 4.31:1 | Darker grey, black note ink | **Fixed** |
| A11Y-3 | MEDIUM | Player, help | Scrollable regions not keyboard-reachable | Tab through page | Focusable | Skipped | `tabindex` + region | **Fixed** |
| SEO-1 | MEDIUM | All pages | No canonical, OG tags, sitemap or 404 page | View source; open a bad URL | Present | Missing | Added | **Fixed** |
| A11Y-4 | LOW | Landing, help, account, player | No `main`, `h1`, empty `th`, prohibited `aria-label` | axe | Clean | Moderate or minor violations | See G | **Fixed** |
| A11Y-5 | LOW | Landing | Steps buttons lacked focus ring | Keyboard Tab | Visible | None | `:focus-visible` | **Fixed** |
| A11Y-6 | LOW | Several | Targets < 24 px | Measure | ≥ 24 px | 13–22 px | Padding or min-size | **Fixed** |
| A11Y-7 | LOW | Inputs, selects | Focus shown only by border colour | Keyboard Tab | Strong indicator | Subtle | Keyboard-only outline (design decision) | Open |
| SEC-2 | LOW | `stripe-webhook` | Any one-off payment gives lifetime | — | Only the lifetime price | Any payment | Check price ID | Open |
| SEC-3 | LOW | `stripe-webhook` | Non-constant-time signature compare | — | Constant time | Early exit | XOR compare | **Fixed**, needs deploy |
| SEC-7 | LOW | Hosting | No CSP or security headers | Response headers | CSP present | None | Meta CSP (careful testing) | Open |
| SEC-8 | LOW | DB schema | No text-length or MIME limits | — | Limits | None | New migration | Open (needs approval) |
| SEO-2 | LOW | Social | OG image is the 512 px icon | Share link | 1200×630 card | Small icon | Design an OG image | Open |
| TECH-1 | LOW | `src/main.ts` | Very large single module | — | — | ~1,600 lines | Gradual extraction | Open |
| TECH-2 | LOW | CI | E2E journeys not in CI | — | Run on each PR | Manual | Add `playwright` dev dependency and a job | Open |

---

## J. Changes Implemented

**Files modified**

| File | Change |
|---|---|
| `index.html` | `<main>` landmark; canonical and OG tags |
| `player.html` | `aria-label` on Settings and logo link; tab panel focusable region; dock region; `role="group"` on labelled divs; canonical and OG |
| `help.html` | Focusable table regions; hidden header text; canonical and OG |
| `licenses.html` | Canonical and OG |
| `account.html` | Canonical and `noindex` |
| `src/styles.css` | Darker note ink; `.sr-only`; 24 px "Forgot password" target; 32 px logo link; tour positioned by `transform`; reserved space before the song loads; metric-matched fallback fonts |
| `src/landing.css` | Contrast (`--ink-3`); larger link targets; steps focus ring; fallback fonts |
| `src/app/auth-ui.ts` | Optional heading level |
| `src/account.ts` | Sign-in title as `h1` on the account page |
| `src/main.ts` | 20 MB and empty-file guards; tour positioned by `transform` |
| `src/landing.ts` | 20 MB and empty-file guards |
| `supabase/functions/delete-account/index.ts` | Bounded cleanup loop with error checks |
| `supabase/functions/stripe-webhook/index.ts` | Constant-time signature compare |
| `public/404.html`, `public/sitemap.xml` | New |
| `qa/e2e.cjs` | New: the Playwright journey suite used for section D |

**Tests run after the changes**
- `tsc --noEmit`: OK.
- `vitest`: 68/68 pass.
- `vite build`: OK.
- E2E: dev 26/26, production 26/26.
- axe: 0 violations on 5 pages × 2 widths.
- Responsive sweep: 5 pages × 6 viewports, with 0 overflow, 0 console errors and 0 failed requests.
- Lighthouse: the table in F.
- Keyboard and form checks: section D.

No product features, business rules, prices or brand colours were changed. The only colour change is a slightly darker grey for small landing text (needed for contrast) and pure black instead of near-black for note labels.

---

## K. Remaining Work

**Needs your attention**
1. **Stripe live mode (SEC-1, blocker).**
   - In Stripe live mode, create the monthly, yearly and lifetime Payment Links (redirect to `…/player.html?checkout=success`) and the customer portal link.
   - Replace the four `VITE_STRIPE_*` values in `.env.production`.
   - Set the **live** webhook signing secret and Stripe secret key in the Supabase edge-function secrets.
   - Point the live webhook to `stripe-webhook`. Rebuild and deploy.
2. **Deploy the two edge-function fixes:**
```bash
supabase functions deploy delete-account
```
```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```
3. **Enable leaked-password protection** in Supabase Auth (SEC-5).
4. **Live acceptance run** on the deployed site, with a fresh test email:
   - sign up → confirmation email → sign in → 14-day trial shows → import 3 songs;
   - a 4th song is refused on the free plan after the trial;
   - sync to a second browser; password reset email; email change;
   - a live purchase of each plan (refund afterwards) → Premium appears → the portal opens → cancelling restores Free at period end;
   - delete account → songs and files gone.

**External dependencies:** Supabase (Auth, DB, Storage, Edge Functions), Stripe, GitHub Pages, and the HaveIBeenPwned check once enabled.

**Not testable in this audit:** everything in D "Untested", real-device Safari/iOS audio and gestures, and screen readers.

**Decisions that need your approval**
- (a) Whether lifetime should be granted only for a specific price ID (SEC-2).
- (b) Adding a DB migration with text-length limits (SEC-8).
- (c) A meta Content-Security-Policy (SEC-7).
- (d) The lazy-loading rework of alphaTab and the sound bank (PERF-3).
- (e) A keyboard-only focus outline on inputs and selects (A11Y-7). You earlier asked for no ring on dropdowns.
- (f) The final public domain, for canonical and OG URLs.
- (g) The final name of the learn method (currently "Tile by Tile").

---

## L. Final Launch Recommendation

### CONDITIONALLY READY FOR LAUNCH

Everything that could be measured here meets a professional bar:
- The core journey works in both builds (26/26 + 26/26).
- There are no accessibility violations, no layout shift and no broken links.
- There are no vulnerable dependencies, and row-level security is enabled in the live project.

The site is **not** ready to take money or accounts yet, for two reasons:
- Payments are wired to Stripe **test mode**, which also lets anyone unlock Premium for free.
- The account, sync and payment flows have **not been verified live**.

Once K-1 to K-4 are done and the live acceptance run passes, the product can launch. PERF-3 (slow mobile first load of the player) is the main remaining quality gap, and it can follow shortly after launch.
