class KeKoOptions {
  constructor() {
    this.kekaUrlInput    = document.getElementById('kekaUrl');
    this.weekdaysToggle  = document.getElementById('weekdaysToggle');
    this.holidaysArea    = document.getElementById('holidays');
    this.logBox          = document.getElementById('logBox');
    this.saveBtn         = document.getElementById('saveBtn');
    this.saveStatus      = document.getElementById('saveStatus');
    this.checkinHour     = document.getElementById('checkinHour');
    this.checkinMinute   = document.getElementById('checkinMinute');
    this.checkinPeriod   = document.getElementById('checkinPeriod');
    this.checkinToggle   = document.getElementById('checkinToggle');
    this.checkoutHour    = document.getElementById('checkoutHour');
    this.checkoutMinute  = document.getElementById('checkoutMinute');
    this.checkoutPeriod  = document.getElementById('checkoutPeriod');
    this.checkoutToggle  = document.getElementById('checkoutToggle');

    this.populateTimeSelects();
    this.load();
    this.loadLogs();
    this.bindEvents();
  }

  populateTimeSelects() {
    for (let h = 1; h <= 12; h++) {
      const val = String(h).padStart(2, '0');
      [this.checkinHour, this.checkoutHour].forEach(sel => {
        const o = document.createElement('option');
        o.value = o.textContent = val;
        sel.appendChild(o);
      });
    }
    for (let m = 0; m < 60; m++) {
      const val = String(m).padStart(2, '0');
      [this.checkinMinute, this.checkoutMinute].forEach(sel => {
        const o = document.createElement('option');
        o.value = o.textContent = val;
        sel.appendChild(o);
      });
    }
  }

  to12hr(time24) {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return { hour: String(hour).padStart(2, '0'), minute: String(m).padStart(2, '0'), period };
  }

  to24hr(hour, minute, period) {
    let h = parseInt(hour);
    if (period === 'AM' && h === 12) h = 0;
    if (period === 'PM' && h !== 12) h += 12;
    return `${String(h).padStart(2, '0')}:${minute}`;
  }

  async load() {
    const s = await chrome.storage.sync.get([
      'kekaUrl', 'weekdaysOnly', 'holidays',
      'checkinTime', 'checkoutTime', 'checkinEnabled', 'checkoutEnabled'
    ]);
    this.kekaUrlInput.value = s.kekaUrl || '';
    if (s.weekdaysOnly !== false) this.weekdaysToggle.classList.add('active');
    this.holidaysArea.value = s.holidays || '';

    const ci = this.to12hr(s.checkinTime || '10:30');
    this.checkinHour.value   = ci.hour;
    this.checkinMinute.value = ci.minute;
    this.checkinPeriod.value = ci.period;
    if (s.checkinEnabled) this.checkinToggle.classList.add('active');

    const co = this.to12hr(s.checkoutTime || '19:00');
    this.checkoutHour.value   = co.hour;
    this.checkoutMinute.value = co.minute;
    this.checkoutPeriod.value = co.period;
    if (s.checkoutEnabled) this.checkoutToggle.classList.add('active');
  }

  async save() {
    const settings = {
      kekaUrl:         this.kekaUrlInput.value.trim(),
      weekdaysOnly:    this.weekdaysToggle.classList.contains('active'),
      holidays:        this.holidaysArea.value.trim(),
      checkinTime:     this.to24hr(this.checkinHour.value, this.checkinMinute.value, this.checkinPeriod.value),
      checkoutTime:    this.to24hr(this.checkoutHour.value, this.checkoutMinute.value, this.checkoutPeriod.value),
      checkinEnabled:  this.checkinToggle.classList.contains('active'),
      checkoutEnabled: this.checkoutToggle.classList.contains('active'),
    };
    await chrome.storage.sync.set(settings);
    await chrome.runtime.sendMessage({ action: 'updateSchedule', settings });
    this.flash('Saved!');
  }

  flash(msg) {
    this.saveStatus.textContent = msg;
    this.saveStatus.classList.add('show');
    setTimeout(() => this.saveStatus.classList.remove('show'), 2000);
  }

  async loadLogs() {
    const { debugLogs = [] } = await chrome.storage.local.get(['debugLogs']);
    this.logBox.innerHTML = '';
    if (debugLogs.length === 0) {
      this.logBox.innerHTML = '<div class="log-entry" style="opacity:0.4">No logs yet.</div>';
      return;
    }
    [...debugLogs].reverse().forEach(entry => {
      const div = document.createElement('div');
      div.className = `log-entry ${entry.type || ''}`;
      const ts = document.createElement('span');
      ts.className = 'ts';
      ts.textContent = entry.timestamp;
      div.appendChild(ts);
      div.appendChild(document.createTextNode(entry.message));
      this.logBox.appendChild(div);
    });
  }

  async clearLogs() {
    if (!confirm('Clear all debug logs?')) return;
    await chrome.storage.local.set({ debugLogs: [] });
    this.loadLogs();
  }

  async exportLogs() {
    const { debugLogs = [] } = await chrome.storage.local.get(['debugLogs']);
    this.download(`keko-logs-${today()}.json`, JSON.stringify(debugLogs, null, 2));
  }

  async exportSettings() {
    const settings = await chrome.storage.sync.get();
    this.download(`keko-settings-${today()}.json`, JSON.stringify(settings, null, 2));
  }

  importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const settings = JSON.parse(await file.text());
        await chrome.storage.sync.set(settings);
        await this.load();
        chrome.runtime.sendMessage({ action: 'updateSchedule', settings });
        this.flash('Imported!');
      } catch {
        alert('Invalid settings file.');
      }
    });
    input.click();
  }

  async clearAllData() {
    if (!confirm('Clear ALL KeKo data and alarms? This cannot be undone.')) return;
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    await chrome.alarms.clearAll();
    await this.load();
    this.loadLogs();
    this.flash('Cleared!');
  }

  async viewAlarms() {
    const alarms = await chrome.alarms.getAll();
    const msg = alarms.length === 0
      ? 'No active alarms.'
      : alarms.map(a => `${a.name}: ${new Date(a.scheduledTime).toLocaleString()}`).join('\n');
    alert(msg);
  }

  download(filename, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = filename;
    a.click();
  }

  bindEvents() {
    this.checkinToggle.addEventListener('click', () => this.checkinToggle.classList.toggle('active'));
    this.checkoutToggle.addEventListener('click', () => this.checkoutToggle.classList.toggle('active'));
    this.weekdaysToggle.addEventListener('click', () => this.weekdaysToggle.classList.toggle('active'));
    this.saveBtn.addEventListener('click', () => this.save());
    document.getElementById('refreshLogs').addEventListener('click', () => this.loadLogs());
    document.getElementById('clearLogs').addEventListener('click', () => this.clearLogs());
    document.getElementById('exportLogs').addEventListener('click', () => this.exportLogs());
    document.getElementById('exportSettings').addEventListener('click', () => this.exportSettings());
    document.getElementById('importSettings').addEventListener('click', () => this.importSettings());
    document.getElementById('clearAllData').addEventListener('click', () => this.clearAllData());
    document.getElementById('viewAlarms').addEventListener('click', () => this.viewAlarms());
  }
}

function today() { return new Date().toISOString().split('T')[0]; }

document.addEventListener('DOMContentLoaded', () => new KeKoOptions());
