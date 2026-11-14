/*
 * Compact RAM storage
 */

const CONFIG = {
  SWITCH_ID: 0,
  RETENTION_DAYS: 7,
  ENDPOINT: "stats"
};

const INTERVAL_MINUTES = 15;
const INTERVAL_MS = 15 * 60 * 1000;
const SLOTS_PER_DAY = 96;
const MILLIWH_PER_WH = 1000;
const UNKNOWN = -1;

let days = [];
let values = [];
let lastEnergy = null;
let lastBoundary = null;
let endpointPath = "";
let deviceIP = "";

function pad(value) {
  return value < 10 ? "0" + value : "" + value;
}

function getDateKey(date) {
  return (
    date.getFullYear() + "-" +
    pad(date.getMonth() + 1) + "-" +
    pad(date.getDate())
  );
}

function formatDateKey(key) {
  return (
    key.substring(8, 10) + "/" +
    key.substring(5, 7) + "/" +
    key.substring(0, 4)
  );
}

function getSlotIndex(timestamp) {
  let date = new Date(timestamp);
  return date.getHours() * 4 + Math.floor(date.getMinutes() / 15);
}

function findDayIndex(key) {
  for (let i = 0; i < days.length; i++) {
    if (days[i] === key) return i;
  }
  return -1;
}

function removeOldestDay() {
  if (days.length === 0) return;
  for (let i = 1; i < days.length; i++) {
    days[i - 1] = days[i];
  }
  days.length--;

  let remaining = values.length - SLOTS_PER_DAY;
  for (let i = 0; i < remaining; i++) {
    values[i] = values[i + SLOTS_PER_DAY];
  }
  values.length = remaining;
}

function ensureDay(timestamp) {
  let key = getDateKey(new Date(timestamp));
  let index = findDayIndex(key);
  if (index !== -1) return index;

  days.push(key);
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    values.push(UNKNOWN);
  }
  cleanHistory();
  return findDayIndex(key);
}

// =====================================================
// HISTORY CLEANUP (mJS Safe using timestamp math)
// =====================================================

function cleanHistory() {
  let now = Date.now();
  // Subtrai os dias de retenção diretamente em milissegundos (Dias * 24h * 60m * 60s * 1000ms)
  let cutoffMs = now - ((CONFIG.RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000);
  let cutoffDate = new Date(cutoffMs);

  // Zera manualmente as horas/minutos/segundos no objeto Date para alinhar ao dia
  let cutoff = cutoffDate.getFullYear() + "-" +
    pad(cutoffDate.getMonth() + 1) + "-" +
    pad(cutoffDate.getDate());

  while (days.length > 0 && days[0] < cutoff) {
    removeOldestDay();
  }
}

function storeEnergy(timestamp, wh) {
  let dayIndex = ensureDay(timestamp);
  if (dayIndex < 0) return;

  let slotIndex = getSlotIndex(timestamp);
  if (slotIndex < 0 || slotIndex >= SLOTS_PER_DAY) return;

  let index = dayIndex * SLOTS_PER_DAY + slotIndex;
  if (wh === null) {
    values[index] = UNKNOWN;
    return;
  }

  let milliWh = Math.round(wh * MILLIWH_PER_WH);
  if (values[index] !== UNKNOWN) {
    milliWh += values[index];
  }
  values[index] = milliWh;
}

function getEnergy() {
  let status = Shelly.getComponentStatus("switch", CONFIG.SWITCH_ID);
  if (!status || !status.aenergy || typeof status.aenergy.total !== "number") {
    return null;
  }
  return status.aenergy.total;
}

function sampleEnergy() {
  let now = Date.now();
  let boundary = Math.floor(now / INTERVAL_MS) * INTERVAL_MS;
  let energy = getEnergy();

  if (energy === null) {
    scheduleNextSample();
    return;
  }

  if (lastEnergy === null) {
    storeEnergy(boundary - INTERVAL_MS, null);
    lastEnergy = energy;
    lastBoundary = boundary;
    scheduleNextSample();
    return;
  }

  let periods = Math.round((boundary - lastBoundary) / INTERVAL_MS);
  if (periods < 1) {
    scheduleNextSample();
    return;
  }

  let difference = energy - lastEnergy;

  if (difference < 0) {
    for (let i = periods; i >= 1; i--) {
      storeEnergy(boundary - (i * INTERVAL_MS), null);
    }
  } else if (difference === 0) {
    for (let i = periods; i >= 1; i--) {
      storeEnergy(boundary - (i * INTERVAL_MS), 0);
    }
  } else if (periods === 1) {
    storeEnergy(boundary - INTERVAL_MS, difference);
  } else {
    for (let i = periods; i >= 1; i--) {
      storeEnergy(boundary - (i * INTERVAL_MS), null);
    }
  }

  lastEnergy = energy;
  lastBoundary = boundary;
  cleanHistory();
  scheduleNextSample();
}

function scheduleNextSample() {
  let now = Date.now();
  let delay = INTERVAL_MS - (now % INTERVAL_MS);
  Timer.set(delay, false, sampleEnergy);
}

function generateJSON() {
  let parts = [
    '{"interval_minutes":', INTERVAL_MINUTES,
    ',"slots_per_day":', SLOTS_PER_DAY,
    ',"retention_days":', CONFIG.RETENTION_DAYS,
    ',"days":['
  ];

  for (let d = 0; d < days.length; d++) {
    if (d > 0) parts.push(',');

    let dayBlock = '{"date":"' + formatDateKey(days[d]) + '","values_wh":[';
    let base = d * SLOTS_PER_DAY;

    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      if (i > 0) dayBlock += ',';
      let value = values[base + i];
      if (value === UNKNOWN) {
        dayBlock += 'null';
      } else {
        dayBlock += String(value / MILLIWH_PER_WH);
      }
    }
    dayBlock += ']}';
    parts.push(dayBlock);
  }

  parts.push(']}');
  return parts.join('');
}

endpointPath = HTTPServer.registerEndpoint(
  CONFIG.ENDPOINT,
  function(request, response) {
    if (request.method !== "GET") {
      response.code = 405;
      response.body = "Method not allowed";
      response.headers = [["Content-Type", "text/plain"]];
      response.send();
      return;
    }

    response.code = 200;
    response.body = generateJSON();
    response.headers = [["Content-Type", "application/json"]];
    response.send();
  }
);

function updateDeviceIP() {
  let wifiStatus = Shelly.getComponentStatus("wifi");
  if (wifiStatus && typeof wifiStatus.sta_ip === "string" && wifiStatus.sta_ip.length > 0) {
    deviceIP = wifiStatus.sta_ip;
    console.log("JSON Endpoint ready at: http://" + deviceIP + endpointPath);
    return;
  }
  Timer.set(5000, false, updateDeviceIP);
}

updateDeviceIP();
scheduleNextSample();
