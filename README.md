# KeKo — Keka Attendance Automation

A Chrome extension that automates clock-in and clock-out on Keka HR, built for the Eastern Enterprise Keka instance.

## Features

- **Scheduled automation** — set a daily clock-in and clock-out time; runs automatically via Chrome alarms
- **Weekend skip** — weekdays-only mode skips Saturday and Sunday automatically
- **Holiday list** — paste YYYY-MM-DD dates to skip specific days
- **Manual triggers** — clock in or out on demand from the popup
- **Smart state detection** — skips the action if you're already in the desired state (no double check-ins)
- **3-step clock-out flow** — handles Keka's confirmation + location modal automatically
- **Retry logic** — 3 attempts with delays before marking an action as failed
- **Desktop notifications** — success/failure/skip alerts via Chrome notifications
- **Debug logs** — last 50 events accessible in Advanced Settings
- **Export/Import settings** — backup and restore your configuration as JSON

## Installation

This extension is not on the Chrome Web Store. Load it unpacked:

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `extension/` folder

## Setup

1. Click the KeKo icon in your Chrome toolbar
2. Open **Advanced Settings** (gear icon or options page)
3. Paste your Keka attendance URL — e.g. `https://yourcompany.keka.com/#/me/attendance/logs`
4. Save settings
5. Back in the popup, set your check-in and check-out times and enable automation

> The Keka URL must point to your attendance page. The extension will only run on `*.keka.com` tabs.

## How it works

The background service worker schedules Chrome alarms for the configured times. When an alarm fires it:

1. Opens (or reuses) a Keka tab at your saved URL
2. Waits for Angular to render the attendance component
3. Injects a content script that clicks the correct buttons
4. Sends a desktop notification with the result
5. Closes the tab after 3 seconds on success

Clock-in is a single click. Clock-out is a 3-step flow: trigger → in-page confirmation → location modal confirm.

## Permissions used

| Permission | Reason |
|---|---|
| `storage` | Save schedule settings and logs |
| `alarms` | Daily scheduled triggers |
| `tabs` | Open and close the Keka tab |

## Project structure

```
extension/
├── manifest.json      # MV3 extension manifest
├── background.js      # Service worker — alarms, tab management, action logic
├── popup.html/.js     # Main UI — status, manual triggers, schedule toggles
├── options.html/.js   # Advanced settings — URL, holidays, logs, data management
└── icons/             # 16×48×128 PNG icons
```
