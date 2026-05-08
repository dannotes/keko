function urlToOriginPattern(url) {
  try { return new URL(url).origin + '/*'; } catch { return null; }
}

class KeKoBackground {
  constructor() {
    this.setupEventListeners();
    this.initializeAlarms();
  }

  async log(message, type = 'info') {
    const entry = { timestamp: new Date().toLocaleString(), message, type, id: Date.now() };
    const { debugLogs = [] } = await chrome.storage.local.get(['debugLogs']);
    debugLogs.push(entry);
    if (debugLogs.length > 50) debugLogs.splice(0, debugLogs.length - 50);
    await chrome.storage.local.set({ debugLogs });
    console.log(`[KeKo] ${message}`);
  }

  setupEventListeners() {
    chrome.runtime.onInstalled.addListener(() => this.initializeExtension());
    chrome.runtime.onStartup.addListener(() => this.initializeAlarms());
    chrome.alarms.onAlarm.addListener((alarm) => this.handleAlarm(alarm));
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });
  }

  async initializeExtension() {
    const defaults = {
      checkinTime: '10:30',
      checkoutTime: '19:00',
      checkinEnabled: false,
      checkoutEnabled: false,
      weekdaysOnly: true,
      kekaUrl: '',
      currentStatus: 'unknown',
      lastAction: 'Extension installed'
    };
    const existing = await chrome.storage.sync.get(Object.keys(defaults));
    const toSet = {};
    Object.keys(defaults).forEach(k => { if (existing[k] === undefined) toSet[k] = defaults[k]; });
    if (Object.keys(toSet).length > 0) await chrome.storage.sync.set(toSet);
    this.initializeAlarms();
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'updateSchedule':
          await this.updateSchedule(request.settings);
          sendResponse({ success: true });
          break;
        case 'manualAction':
          sendResponse(await this.performAction(request.type));
          break;
        case 'getStatus':
          sendResponse(await this.getStatus());
          break;
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }

  async updateSchedule(settings) {
    await chrome.alarms.clearAll();
    if (settings.checkinEnabled && settings.checkinTime)
      await this.createDailyAlarm('checkin', settings.checkinTime);
    if (settings.checkoutEnabled && settings.checkoutTime)
      await this.createDailyAlarm('checkout', settings.checkoutTime);
  }

  async createDailyAlarm(name, time) {
    const [hours, minutes] = time.split(':').map(Number);
    const alarmTime = new Date();
    alarmTime.setHours(hours, minutes, 0, 0);
    if (alarmTime <= new Date()) alarmTime.setDate(alarmTime.getDate() + 1);
    await chrome.alarms.create(name, { when: alarmTime.getTime(), periodInMinutes: 24 * 60 });
    await this.log(`Alarm set: ${name} at ${alarmTime.toLocaleString()}`);
  }

  async handleAlarm(alarm) {
    await this.log(`Alarm triggered: ${alarm.name}`);
    const { weekdaysOnly, holidays } = await chrome.storage.sync.get(['weekdaysOnly', 'holidays']);

    if (weekdaysOnly) {
      const day = new Date().getDay();
      if (day === 0 || day === 6) {
        await this.log(`Skipping ${alarm.name} — weekend`);
        this.notify(`KeKo: Skipped ${alarm.name} (weekend)`);
        return;
      }
    }

    if (holidays) {
      const today = new Date().toISOString().split('T')[0];
      const list = holidays.split('\n').map(h => h.trim()).filter(Boolean);
      if (list.includes(today)) {
        await this.log(`Skipping ${alarm.name} — holiday`);
        this.notify(`KeKo: Skipped ${alarm.name} (holiday)`);
        return;
      }
    }

    const result = await this.performAction(alarm.name);
    this.notify(result.success ? `KeKo: ${alarm.name} completed` : `KeKo: ${alarm.name} failed — ${result.error}`);
  }

  async performAction(actionType) {
    await this.log(`Starting ${actionType}`);
    const tab = await this.getOrCreateTab();
    if (!tab) return { success: false, error: 'Could not open Keka tab' };

    const result = await this.executeActionScript(tab.id, actionType);

    if (result.success) {
      await this.log(`${actionType} succeeded: ${result.message}`, 'success');
      await this.updateActionHistory(actionType);
      setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 3000);
    } else {
      await this.log(`${actionType} failed: ${result.error}`, 'error');
    }
    return result;
  }

  async getOrCreateTab() {
    const { kekaUrl = '' } = await chrome.storage.sync.get(['kekaUrl']);
    if (!kekaUrl) {
      this.notify('KeKo: Please set your Keka URL in Advanced Settings first.');
      return null;
    }
    const origin = urlToOriginPattern(kekaUrl);
    if (!origin) {
      this.notify('KeKo: Invalid Keka URL in settings. Please check Advanced Settings.');
      return null;
    }

    const existing = await chrome.tabs.query({ url: origin });
    if (existing.length > 0) {
      await chrome.tabs.update(existing[0].id, { active: true });
      await chrome.windows.update(existing[0].windowId, { focused: true });
      await new Promise(r => setTimeout(r, 2000));
      return existing[0];
    }

    const tab = await chrome.tabs.create({ url: kekaUrl, active: true });

    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve(), 20000);
        const listener = (tabId, info) => {
          if (tabId !== tab.id || info.status !== 'complete') return;
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.get(tab.id).then(t => {
            if (t.url.includes('login') || t.url.includes('microsoftonline')) {
              reject(new Error('Authentication required — please log in to Keka first'));
            } else {
              setTimeout(resolve, 4000); // Wait for Angular to render
            }
          });
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    } catch (err) {
      await this.log(err.message, 'error');
      this.notify(`KeKo: ${err.message}`);
      return null;
    }

    return tab;
  }

  async executeActionScript(tabId, actionType) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.log(`Attempt ${attempt}/${maxRetries} for ${actionType}`);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: kekaAction,
          args: [actionType, attempt]
        });

        const result = results?.[0]?.result;
        if (result?.success) return result;
        lastError = result;
        if (attempt < maxRetries) await new Promise(r => setTimeout(r, 3000));
      } catch (err) {
        lastError = { success: false, error: err.message };
        if (attempt < maxRetries) await new Promise(r => setTimeout(r, 3000));
      }
    }
    return lastError || { success: false, error: 'All attempts failed' };
  }

  async updateActionHistory(actionType) {
    const timestamp = new Date().toLocaleString();
    await chrome.storage.sync.set({
      lastAction: `${actionType} at ${timestamp}`,
      currentStatus: actionType === 'checkin' ? 'checked-in' : 'checked-out'
    });
  }

  async getStatus() {
    const data = await chrome.storage.sync.get(['currentStatus', 'lastAction']);
    return { status: data.currentStatus || 'unknown', lastAction: data.lastAction || 'No actions yet' };
  }

  async initializeAlarms() {
    const settings = await chrome.storage.sync.get(['checkinEnabled', 'checkoutEnabled', 'checkinTime', 'checkoutTime']);
    await this.updateSchedule(settings);
  }

  notify(message) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'KeKo',
      message
    }).catch(() => {});
  }
}

// ─── Injected into the Keka tab ──────────────────────────────────────────────
// Must be a top-level function (no closure over extension globals).
//
// Clock-in flow  (1 step):
//   Click <a>Remote Clock-In</a>  → done
//
// Clock-out flow (3 steps):
//   1. Click <button>Remote Clock-out</button>   (initial trigger)
//   2. Click <button>Clock-out</button>           (in-page confirmation)
//   3. Click <button.btn-primary>Confirm</button> (location modal)
//
function kekaAction(actionType, attempt) {
  return new Promise(resolve => {
    setTimeout(async () => {
      try {
        const component = document.querySelector('employee-attendance-request-actions');
        if (!component) {
          resolve({ success: false, error: `Angular component not found (attempt ${attempt})` });
          return;
        }

        // ── Detect current state ───────────────────────────────────────────
        const clockOutBtn = component.querySelector('button.btn-danger');
        const remoteClockInLink = Array.from(component.querySelectorAll('a')).find(a =>
          a.innerText?.trim().toLowerCase().includes('remote clock-in')
        );

        const isClockIn  = !!remoteClockInLink;  // links visible → clocked out
        const isClockOut = !!clockOutBtn;         // danger btn visible → clocked in

        // ── Skip if already in desired state ──────────────────────────────
        if (actionType === 'checkin' && isClockOut) {
          resolve({ success: true, skipped: true, message: 'Already clocked in — skipping' });
          return;
        }
        if (actionType === 'checkout' && isClockIn) {
          resolve({ success: true, skipped: true, message: 'Already clocked out — skipping' });
          return;
        }

        // ── CLOCK-IN: single click on the Remote Clock-In link ────────────
        if (actionType === 'checkin') {
          remoteClockInLink.click();

          // Wait for the "Remote Clock-out" button to appear (confirms success)
          let waited = 0;
          const check = setInterval(() => {
            waited += 1000;
            const confirmed = component.querySelector('button.btn-danger');
            if (confirmed) {
              clearInterval(check);
              resolve({ success: true, message: 'Clock-in successful', attempt });
            } else if (waited >= 15000) {
              clearInterval(check);
              resolve({ success: false, error: 'Clock-in: timed out waiting for confirmation' });
            }
          }, 1000);
          return;
        }

        // ── CLOCK-OUT: 3-step flow ────────────────────────────────────────
        if (actionType === 'checkout') {
          // Step 1: click "Remote Clock-out"
          clockOutBtn.click();
          await new Promise(r => setTimeout(r, 1500));

          // Step 2: click "Clock-out" confirmation button
          const confirmClockOutBtn = Array.from(component.querySelectorAll('button.btn-danger')).find(b =>
            b.innerText?.trim().toLowerCase() === 'clock-out'
          );
          if (!confirmClockOutBtn) {
            resolve({ success: false, error: 'Clock-out step 2: confirmation button not found' });
            return;
          }
          confirmClockOutBtn.click();
          await new Promise(r => setTimeout(r, 1500));

          // Step 3: click "Confirm" on the location modal
          let modalWaited = 0;
          const modalCheck = setInterval(() => {
            modalWaited += 500;
            const confirmBtn = document.querySelector('button.btn-primary.btn-sm');
            if (confirmBtn) {
              clearInterval(modalCheck);
              confirmBtn.click();

              // Wait for clock-in links to appear (confirms clocked out)
              let doneWaited = 0;
              const doneCheck = setInterval(() => {
                doneWaited += 1000;
                const clockInLink = Array.from(component.querySelectorAll('a')).find(a =>
                  a.innerText?.trim().toLowerCase().includes('remote clock-in')
                );
                if (clockInLink) {
                  clearInterval(doneCheck);
                  resolve({ success: true, message: 'Clock-out successful', attempt });
                } else if (doneWaited >= 15000) {
                  clearInterval(doneCheck);
                  resolve({ success: false, error: 'Clock-out: timed out after confirming location' });
                }
              }, 1000);
            } else if (modalWaited >= 8000) {
              clearInterval(modalCheck);
              // Modal may not appear — check if clock-out already completed
              const alreadyOut = Array.from(component.querySelectorAll('a')).find(a =>
                a.innerText?.trim().toLowerCase().includes('remote clock-in')
              );
              if (alreadyOut) {
                resolve({ success: true, message: 'Clock-out successful (no location modal)', attempt });
              } else {
                resolve({ success: false, error: 'Clock-out step 3: location modal did not appear' });
              }
            }
          }, 500);
          return;
        }

        resolve({ success: false, error: `Unknown action type: ${actionType}` });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    }, 1500);
  });
}

new KeKoBackground();
