# Stone design system

Command's look and feel since the October 2026 redesign. Calm, legible and quiet: one reading order per page, few signals, motion only where it means something.

## Theme

- Tokens live in `src/styles/stone-theme.css`. Everything else in `src/styles.css` reads them; do not add hex colors elsewhere.
- Two palettes on `<html data-theme="day|evening">`. Day is warm stone `#D5CFC4`; Evening is deep warm stone `#3A3631`. Never white, never near-black.
- `public/stone-theme.js` is a classic script loaded in `<head>` so the right palette paints first. Modes: **Auto** (default; Evening from 6:00 PM to 6:30 AM Eastern), **Day**, **Evening**. The mode is kept in `localStorage` (`cmd-theme-mode`) and, from Settings → Appearance, in `user_preferences.theme` (`auto`, `day`, `evening`). Older accounts may hold `system`, `dark` or `light`; Day and Auto carry over, and `dark` (the old default) is read as Auto.
- Scheduled switches cross-fade for 1.2 seconds (not on first paint, and not with reduced motion). Anything that draws its own colors must re-read tokens on the `cmd-themechange` event.
- Signal colors were adjusted from the original design so every text/background pair passes 4.5:1 (axe checks run in both themes). If you change a token, run `npx playwright test`.
- Fonts are self-hosted (`@fontsource-variable/schibsted-grotesk`, `@fontsource/ibm-plex-mono`) because the content security policy allows `font-src 'self'` only.

## Rules

- The `/` logo mark is the only orange (`--brand-orange`). No orange buttons, links, borders or highlights.
- Teal (`--accent`) is the one working accent: now, links, primary buttons, focus rings, the day line, selected states.
- `--overdue` is always paired with the word "Overdue" or "past due". Color never carries meaning alone.
- Priority and status are quiet mono meta text, not chips. Only overdue and "now" get color.
- Rows over cards. Row actions appear on hover or keyboard focus, and always on touch devices.
- Section labels (`.label`, mono, 12px, tracked) are used sparingly: one per real section.
- Touch targets are at least 44px; icon-only controls carry `aria-label`; `prefers-reduced-motion` removes all animation and transitions.
- Empty states say what is empty and what to do next.

## Shell

- 76px icon rail (Work Day, Tasks, Projects, Journal, People, More; Settings and the account menu at the bottom). Under 900px it becomes a bottom bar with a More sheet.
- One top-bar field, "Capture, search, or ask CMD…" (⌘K): capture as task, reminder or journal; jump to a page or record; ask CMD. Shift-⌘K opens quick capture.
- Library is hidden from navigation for now. To restore it, re-add its entry in `src/ui/navigation.ts`, add it to `railPages` in `src/app/Workspace.tsx`, and un-skip its end-to-end test.

## Pages

- **Work Day:** headline and lead from the SITREP, day line with meeting marks, Now (at most three), Replies You Owe, Tidy Up, and a ledger (This Week, Keeping Track, Open Work, Moving Around You). Focus dims everything except Now. Tidy Up opens the record for review; it never edits.
- **Lists (Tasks, Projects, Reminders, Waiting On, Learning, AI Lab, Initiatives):** title and primary action, one quiet filter row, rows with mono meta.
- **Journal:** capture field, then a dated feed (about 68 characters wide, hairlines between entries).
- **Project and initiative detail:** summary, what's next, open work, activity. **Person detail:** waiting on them, what you owe them, recent notes.
- **Settings:** grouped sections with mono headings and hairlines.

## Colors outside the theme file (audit)

Searching `src` and `public` for hex colors finds only these, each unable to read CSS variables:

| File | Why |
|---|---|
| `index.html` | Initial browser address-bar color before the switcher runs. |
| `public/stone-theme.js` | Browser address-bar color per theme (`META`). |
| `public/offline.html` and `public/offline.css` | Static offline page cached by the service worker; uses Stone Day values and the brand orange for the logo. |
| `public/manifest.webmanifest` | Install background and theme color (Stone Day). |
| `public/icon.svg` and PNG icons | App icon: Stone Evening ground with the brand-orange slash. |

## Naming

The assistant is called **CMD** everywhere a person sees or reads it, including its prompts and the connector name. Internal identifiers (`cora_*` tables, `/api/cora`, `handleCora`, file names) keep the old name to avoid breaking stored data and connected apps.
