// options.js — чтение/сохранение новых настроек + уведомление background
const sellersUrlInput = document.getElementById("sellersUrl");
const cacheTtlInput = document.getElementById("cacheTtl");
const badgeEnableInput = document.getElementById("badgeEnable");
const scanModeSelect = document.getElementById("scanMode");
const scanTimingSelect = document.getElementById("scanTiming");
const scanDelayInput = document.getElementById("scanDelay");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");

const DEFAULTS = {
  sellersUrl: "https://adwmg.com/sellers.json",
  cacheTtlMin: 60,
  badgeEnable: true,
  scanMode: "background",
  scanTiming: "immediate",
  scanDelay: 10
};

function setStatus(msg, short = false) {
  statusEl.textContent = msg;
  if (!short) {
    setTimeout(() => {
      if (statusEl.textContent === msg) statusEl.textContent = "";
    }, 4000);
  }
}

function loadOptions() {
  chrome.storage.local.get(
    ["sellersUrl", "cacheTtlMin", "badgeEnable", "scanMode", "scanTiming", "scanDelay"],
    (res) => {
      sellersUrlInput.value = res.sellersUrl || DEFAULTS.sellersUrl;
      cacheTtlInput.value = res.cacheTtlMin != null ? res.cacheTtlMin : DEFAULTS.cacheTtlMin;
      badgeEnableInput.checked = res.badgeEnable != null ? res.badgeEnable : DEFAULTS.badgeEnable;
      scanModeSelect.value = res.scanMode || DEFAULTS.scanMode;
      scanTimingSelect.value = res.scanTiming || DEFAULTS.scanTiming;
      scanDelayInput.value = res.scanDelay != null ? res.scanDelay : DEFAULTS.scanDelay;
      setStatus("Настройки загружены.", true);
    }
  );
}

function saveOptions() {
  const sellersUrl = String(sellersUrlInput.value).trim() || DEFAULTS.sellersUrl;
  let cacheTtlMin = parseInt(cacheTtlInput.value, 10);
  if (Number.isNaN(cacheTtlMin) || cacheTtlMin <= 0) cacheTtlMin = DEFAULTS.cacheTtlMin;
  const badgeEnable = !!badgeEnableInput.checked;
  const scanMode = scanModeSelect.value === "content" ? "content" : "background";
  const scanTiming = scanTimingSelect.value === "delayed" ? "delayed" : "immediate";
  let scanDelay = parseInt(scanDelayInput.value, 10);
  if (Number.isNaN(scanDelay) || scanDelay < 0) scanDelay = DEFAULTS.scanDelay;

  chrome.storage.local.set({
    sellersUrl,
    cacheTtlMin,
    badgeEnable,
    scanMode,
    scanTiming,
    scanDelay
  }, () => {
    setStatus("Настройки сохранены.");
    // Notify background to apply changes immediately
    chrome.runtime.sendMessage({
      type: "optionsUpdated",
      sellersUrl,
      cacheTtlMin,
      badgeEnable,
      scanMode,
      scanTiming,
      scanDelay
    }, () => {});
  });
}

function resetOptions() {
  sellersUrlInput.value = DEFAULTS.sellersUrl;
  cacheTtlInput.value = DEFAULTS.cacheTtlMin;
  badgeEnableInput.checked = DEFAULTS.badgeEnable;
  scanModeSelect.value = DEFAULTS.scanMode;
  scanTimingSelect.value = DEFAULTS.scanTiming;
  scanDelayInput.value = DEFAULTS.scanDelay;
  setStatus("Значения сброшены (не сохранены).");
}

saveBtn.addEventListener("click", saveOptions);
resetBtn.addEventListener("click", resetOptions);
document.addEventListener("DOMContentLoaded", loadOptions);