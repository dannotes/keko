class KeKoPopup {
  constructor() {
    this.elements = {
      status: document.getElementById('status'),
      statusText: document.getElementById('statusText'),
      lastAction: document.getElementById('lastAction'),
      checkinToggle: document.getElementById('checkinToggle'),
      checkoutToggle: document.getElementById('checkoutToggle'),
      checkinHour: document.getElementById('checkinHour'),
      checkinMinute: document.getElementById('checkinMinute'),
      checkinPeriod: document.getElementById('checkinPeriod'),
      checkoutHour: document.getElementById('checkoutHour'),
      checkoutMinute: document.getElementById('checkoutMinute'),
      checkoutPeriod: document.getElementById('checkoutPeriod'),
      manualCheckin: document.getElementById('manualCheckin'),
      manualCheckout: document.getElementById('manualCheckout'),
      settingsLink: document.getElementById('settingsLink'),
    };

    this.populateTimeSelects();
    this.loadSettings();
    this.loadStatus();
    this.bindEvents();
  }

  populateTimeSelects() {
    for (let h = 1; h <= 12; h++) {
      const opt = v => { const o = document.createElement('option'); o.value = o.textContent = String(v).padStart(2, '0'); return o; };
      this.elements.checkinHour.appendChild(opt(h));
      this.elements.checkoutHour.appendChild(opt(h));
    }
    for (let m = 0; m < 60; m++) {
      const opt = v => { const o = document.createElement('option'); o.value = o.textContent = String(v).padStart(2, '0'); return o; };
      this.elements.checkinMinute.appendChild(opt(m));
      this.elements.checkoutMinute.appendChild(opt(m));
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

  async loadSettings() {
    const s = await chrome.storage.sync.get([
      'checkinTime', 'checkoutTime', 'checkinEnabled', 'checkoutEnabled'
    ]);

    const ci = this.to12hr(s.checkinTime || '10:30');
    this.elements.checkinHour.value = ci.hour;
    this.elements.checkinMinute.value = ci.minute;
    this.elements.checkinPeriod.value = ci.period;

    const co = this.to12hr(s.checkoutTime || '19:00');
    this.elements.checkoutHour.value = co.hour;
    this.elements.checkoutMinute.value = co.minute;
    this.elements.checkoutPeriod.value = co.period;

    if (s.checkinEnabled) this.elements.checkinToggle.classList.add('active');
    if (s.checkoutEnabled) this.elements.checkoutToggle.classList.add('active');
  }

  async loadStatus() {
    const { status, lastAction } = await chrome.runtime.sendMessage({ action: 'getStatus' });
    this.updateStatusUI(status, lastAction);
  }

  updateStatusUI(status, lastAction) {
    this.elements.status.className = 'status';
    if (status === 'checked-in') {
      this.elements.status.classList.add('checked-in');
      this.elements.statusText.textContent = 'Status: Checked In';
    } else if (status === 'checked-out') {
      this.elements.status.classList.add('checked-out');
      this.elements.statusText.textContent = 'Status: Checked Out';
    } else {
      this.elements.statusText.textContent = 'Status: Unknown';
    }
    this.elements.lastAction.textContent = lastAction || '';
  }

  async saveSettings() {
    const settings = {
      checkinTime: this.to24hr(
        this.elements.checkinHour.value,
        this.elements.checkinMinute.value,
        this.elements.checkinPeriod.value
      ),
      checkoutTime: this.to24hr(
        this.elements.checkoutHour.value,
        this.elements.checkoutMinute.value,
        this.elements.checkoutPeriod.value
      ),
      checkinEnabled: this.elements.checkinToggle.classList.contains('active'),
      checkoutEnabled: this.elements.checkoutToggle.classList.contains('active'),
    };
    await chrome.storage.sync.set(settings);
    await chrome.runtime.sendMessage({ action: 'updateSchedule', settings });
  }

  async manualAction(type) {
    const btn = type === 'checkin' ? this.elements.manualCheckin : this.elements.manualCheckout;
    btn.disabled = true;
    btn.textContent = 'Working…';
    try {
      const result = await chrome.runtime.sendMessage({ action: 'manualAction', type });
      if (result.success) {
        await this.loadStatus();
      } else {
        alert(`Failed: ${result.error}`);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = type === 'checkin' ? 'Clock In' : 'Clock Out';
    }
  }

  bindEvents() {
    this.elements.checkinToggle.addEventListener('click', () => {
      this.elements.checkinToggle.classList.toggle('active');
      this.saveSettings();
    });
    this.elements.checkoutToggle.addEventListener('click', () => {
      this.elements.checkoutToggle.classList.toggle('active');
      this.saveSettings();
    });

    ['checkinHour', 'checkinMinute', 'checkinPeriod', 'checkoutHour', 'checkoutMinute', 'checkoutPeriod'].forEach(id => {
      this.elements[id].addEventListener('change', () => this.saveSettings());
    });

    this.elements.manualCheckin.addEventListener('click', () => this.manualAction('checkin'));
    this.elements.manualCheckout.addEventListener('click', () => this.manualAction('checkout'));

    this.elements.settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

document.addEventListener('DOMContentLoaded', () => new KeKoPopup());
