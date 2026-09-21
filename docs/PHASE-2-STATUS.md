# Phase 2 — Mini-first PWA shell

**Status:** Implemented; physical-device acceptance remains. Kevin authorized this phase after making the initial commit and connecting Netlify to the repository.

## Delivered

- Responsive workspace and Settings navigation: portrait bottom bar, landscape/desktop rail, keyboard focus management, skip link and safe-area spacing.
- Dark, light and device themes using the existing persisted preference. Restrained motion, visible focus, touch-sized controls, readable empty/loading/error/connection states.
- Install manifest, raster and vector icons, Apple touch icon, standalone display and installation guidance.
- Service worker with an exact static-resource allowlist. It never caches API responses, authenticated requests, application HTML or recovery URLs. Offline navigation displays a neutral reconnect page, not private content.
- Explicit “Update and reload” flow. A newly downloaded worker waits until the user selects the update; no automatic reload while working.
- User-scoped draft-storage utility, tested for reload recovery, isolation, failed storage and acknowledgement races. This is infrastructure for later editors, not an offline capture feature. Future editors must authorize before reading drafts, surface storage errors, preserve unsaved edits, and guard logout/update until the user saves, exports or deliberately discards them.

Only functional Workspace and Settings destinations appear. Work Day, Tasks, Capture and Cora are deliberately not interactive yet. The phone layout is ready for Capture when its workflow is implemented in the later phase; no empty Capture destination is presented.

## Verification

Local checks cover TypeScript, lint, production build, 41 unit/database tests, 14 browser workflows and two built-PWA browser tests. Viewports include 390×844, 744×1133, 1133×744 and 1440×900. Browser checks include keyboard focus, doubled text, reduced motion, persisted theme, sign-out, access revocation, static-cache privacy, offline navigation and explicit update activation.

PWA tests build with synthetic configuration and disposable browser profiles. They do not contact or mutate the hosted production database. The payload remains below the existing 190 KiB gzip JavaScript/CSS budget. Browser emulation does not establish physical iPad installation, keyboard or operating-system behavior.

## Kevin’s device acceptance

1. Open the deployed site in Safari on the Mini; install with Share → Add to Home Screen, using Open as Web App when offered.
2. Launch from the icon, sign in and relaunch. Check portrait/landscape, keyboard opening, bottom safe area and readable text at the preferred system size.
3. Change themes in Settings, navigate using keyboard/focus where available, and verify sign-out returns to the sign-in screen.
4. Disconnect and relaunch: only the neutral offline page should appear. Reconnect and choose Try again.
5. On a later release, confirm the update notice waits for “Update and reload.” Repeat the layout/install checks on iPhone.

Do not treat these device checks as completed by desktop automation. Phase 3 follows acceptance of this shell.

## Deployment and maintenance

Netlify now builds from the repository as configured by Kevin. The build generates the worker after Vite emits hashed assets; `sw.js` and the manifest inherit revalidation headers, while hashed assets remain immutable. CSP explicitly allows same-origin workers and manifests. No new hosted resources, dependencies, database migration, auth method or email service were introduced.

Continue the Phase 1 recovery and custom-domain work as tracked separately. Self-service email recovery and MFA remain deferred.

Implementation references: [web app manifests](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [service worker lifecycle](https://web.dev/learn/pwa/service-workers), and [assets and data caching](https://web.dev/learn/pwa/assets-and-data).
