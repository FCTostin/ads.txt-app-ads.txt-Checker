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

// Значения по умолчанию теперь в ЧАСАХ (1 час = 60 минут)
const DEFAULTS = {
  sellersUrl: "https://adwmg.com/sellers.json",
  cacheTtlHour: 1, // 1 час
  badgeEnable: true,
  scanMode: "background",
  scanTiming: "immediate",
  scanDelay: 10
};

// Ключ для хранения в storage остается cacheTtlMin для обратной совместимости с background.js
const CACHE_TTL_MIN_KEY = "cacheTtlMin";

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
    ["sellersUrl", CACHE_TTL_MIN_KEY, "badgeEnable", "scanMode", "scanTiming", "scanDelay"],
    (res) => {
      sellersUrlInput.value = res.sellersUrl || DEFAULTS.sellersUrl;

      // Читаем старый TTL в МИНУТАХ, переводим в ЧАСЫ для отображения
      let cacheTtlMin = res[CACHE_TTL_MIN_KEY];
      let cacheTtlHour;
      if (cacheTtlMin != null) {
        // Делим на 60, чтобы получить часы, округляем для простоты отображения
        cacheTtlHour = Math.round(cacheTtlMin / 60);
        // Минимальное значение 1 час, если было меньше
        if (cacheTtlHour < 1) cacheTtlHour = DEFAULTS.cacheTtlHour;
      } else {
        cacheTtlHour = DEFAULTS.cacheTtlHour;
      }
      cacheTtlInput.value = cacheTtlHour;

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

  // Берем значение в ЧАСАХ из поля ввода
  let cacheTtlHour = parseInt(cacheTtlInput.value, 10);
  if (Number.isNaN(cacheTtlHour) || cacheTtlHour <= 0) cacheTtlHour = DEFAULTS.cacheTtlHour;
  // Переводим в МИНУТЫ для сохранения в storage (обратная совместимость)
  const cacheTtlMin = cacheTtlHour * 60;

  const badgeEnable = !!badgeEnableInput.checked;
  const scanMode = scanModeSelect.value === "content" ? "content" : "background";
  const scanTiming = scanTimingSelect.value === "delayed" ? "delayed" : "immediate";
  let scanDelay = parseInt(scanDelayInput.value, 10);
  if (Number.isNaN(scanDelay) || scanDelay < 0) scanDelay = DEFAULTS.scanDelay;

  // Сохраняем в storage в МИНУТАХ
  chrome.storage.local.set({
    sellersUrl,
    [CACHE_TTL_MIN_KEY]: cacheTtlMin,
    badgeEnable,
    scanMode,
    scanTiming,
    scanDelay
  }, () => {
    setStatus("Настройки сохранены.");
    // Notify background to apply changes immediately
    // Отправляем в background тоже в МИНУТАХ для обратной совместимости
    chrome.runtime.sendMessage({
      type: "optionsUpdated",
      sellersUrl,
      cacheTtlMin, // Отправляем в минутах!
      badgeEnable,
      scanMode,
      scanTiming,
      scanDelay
    }, () => {});
  });
}

function resetOptions() {
  sellersUrlInput.value = DEFAULTS.sellersUrl;
  cacheTtlInput.value = DEFAULTS.cacheTtlHour; // Сбрасываем в часы
  badgeEnableInput.checked = DEFAULTS.badgeEnable;
  scanModeSelect.value = DEFAULTS.scanMode;
  scanTimingSelect.value = DEFAULTS.scanTiming;
  scanDelayInput.value = DEFAULTS.scanDelay;
  setStatus("Значения сброшены (не сохранены).");
}

saveBtn.addEventListener("click", saveOptions);
resetBtn.addEventListener("click", resetOptions);
document.addEventListener("DOMContentLoaded", loadOptions);