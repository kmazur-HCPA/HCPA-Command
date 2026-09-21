# Phase 0 wireframe

Open [work-day.html](work-day.html) in a browser. This is a self-contained, dependency-free design demonstration. It uses synthetic records, performs no network requests, writes no persistent browser storage, and resets on reload. It is not the Phase 1 application scaffold.

Review these decisions:

1. Mini portrait uses one vertical sequence: orientation, up to three priorities, Reminders, Waiting On.
2. Wider layouts gain a navigation rail and secondary column; narrow viewports still reflow.
3. Both themes share hierarchy; orange highlights are restrained. Final tokens must pass contrast checks during implementation.
4. Capture is always available. Reminders stay on Work Day; Captures will become Journal in Phase 5.
5. Cora and Calendar occupy no space until they can provide real information.

Try completing work, snoozing a reminder, searching Tasks, capturing text, and switching appearance/layout. Snoozing changes the sample state only; no clock, scheduled job, authentication, offline persistence, or real record storage is implemented.

Full task editing, expanded reminder management, priority selection, sign-in and recovery screens belong to later implementation phases. The wireframe demonstrates the primary layout and a few representative interactions, not every required feature.

## Review evidence — September 21, 2026

Headless Chromium checks passed for task completion, reminder snoozing, plain-text capture (including markup-like text), task search and demo reset, with no JavaScript runtime errors. Portrait and landscape layout modes produced no page-level horizontal overflow at 320, 390, 744, 1133 and 1440 pixel viewport widths. Dark portrait and light landscape screenshots were visually reviewed.

These checks validate this demonstration only. They do not establish production performance, WCAG conformance, Safari/PWA behavior, authentication, or actual iPad mini usability. Those remain implementation and device acceptance checks.
