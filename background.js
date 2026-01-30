// background.js — badge counts matched seller_ids using the active sellers.json cache
// - executeScript in page returns seller_id array found in ads.txt/app-ads.txt
// - background compares those ids to cached sellers.json (stored in chrome.storage.local)
// - if cache missing/stale, tries to fetchAndCacheSellers before counting
// - respects runtime option badgeEnabled and scanMode/scanTiming from storage

const DEFAULT_SELLERS_URL = "https://adwmg.com/sellers.json";
const CACHE_KEY = "adwmg_sellers_cache";
const CACHE_TS_KEY = "adwmg_sellers_ts";
const SETTINGS_KEYS = ["sellersUrl", "cacheTtlMin", "badgeEnable", "scanMode", "scanTiming", "scanDelay"];

const BADGE_BG_COLOR = "#21aeb3";
const SCAN_COOLDOWN_MS = 60 * 1000; // minimal interval between scans per tab
const FETCH_TIMEOUT_MS = 8000;
const FETCH_RETRIES = 1;

// runtime maps and settings
const countsByTab = Object.create(null);
const lastScanAt = Object.create(null);
const scheduledTimers = Object.create(null);

let badgeEnabled = true;
let sellersUrl = DEFAULT_SELLERS_URL;
let cacheTtlMs = 1000 * 60 * 60;
let scanMode = "background";
let scanTiming = "immediate";
let scanDelay = 10;

// ---- network helpers ----
async function fetchWithTimeoutAndRetry(url, { timeout = FETCH_TIMEOUT_MS, retries = FETCH_RETRIES, fetchOptions = {} } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal, ...fetchOptions });
      clearTimeout(id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      clearTimeout(id);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
  }
}

// fetch sellers.json and store in storage
async function fetchAndCacheSellers(force = false) {
  if (!sellersUrl) return null;
  try {
    const res = await fetchWithTimeoutAndRetry(sellersUrl, { timeout: FETCH_TIMEOUT_MS, retries: FETCH_RETRIES });
    const data = await res.json();
    const sellers = Array.isArray(data.sellers) ? data.sellers : [];
    const items = {};
    items[CACHE_KEY] = sellers;
    items[CACHE_TS_KEY] = Date.now();
    await new Promise((resolve) => chrome.storage.local.set(items, resolve));
    return sellers;
  } catch (err) {
    if (force) return null;
    return null;
  }
}

// get cached sellers (may be empty)
function getCachedSellers() {
  return new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY, CACHE_TS_KEY], (res) => {
      resolve({
        sellers: Array.isArray(res[CACHE_KEY]) ? res[CACHE_KEY] : [],
        ts: res[CACHE_TS_KEY] || 0
      });
    });
  });
}

// ---- settings init ----
function initSettingsFromStorage() {
  chrome.storage.local.get(SETTINGS_KEYS, (res) => {
    sellersUrl = (res && typeof res.sellersUrl === "string" && res.sellersUrl.trim()) ? res.sellersUrl.trim() : DEFAULT_SELLERS_URL;
    // cacheTtlMin приходит в минутах
    const ttlMin = (res && typeof res.cacheTtlMin === "number") ? res.cacheTtlMin : 60;
    cacheTtlMs = Math.max(1, ttlMin) * 60 * 1000;
    badgeEnabled = (res && typeof res.badgeEnable === "boolean") ? res.badgeEnable : true;
    scanMode = (res && res.scanMode === "content") ? "content" : "background";
    scanTiming = (res && res.scanTiming === "delayed") ? "delayed" : "immediate";
    scanDelay = (res && typeof res.scanDelay === "number") ? Math.max(0, res.scanDelay) : 10;

    if (!badgeEnabled) chrome.action.setBadgeText({ text: "" });
    console.debug("background init:", { sellersUrl, cacheTtlMs, badgeEnabled, scanMode, scanTiming, scanDelay });
  });
}
initSettingsFromStorage();
chrome.storage.onChanged.addListener((changes) => {
  let needInit = false;
  for (const k of SETTINGS_KEYS) if (changes[k]) needInit = true;
  if (needInit) initSettingsFromStorage();
});

// ---- badge helper ----
function applyBadgeForTab(tabId) {
  if (!badgeEnabled) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const count = countsByTab[tabId] || 0;
  const text = count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ text });
  if (text) chrome.action.setBadgeBackgroundColor({ color: BADGE_BG_COLOR });
}

// cancel scheduled timers
function cancelScheduled(tabId) {
  const t = scheduledTimers[tabId];
  if (t) {
    clearTimeout(t);
    delete scheduledTimers[tabId];
  }
}

// ---- scanning logic ----
// We will execute a small function in the page which returns an array of seller_id strings found in ads.txt/app-ads.txt
// background will then compare that set to cached sellers.json to count matches
async function executeExtractSellerIds(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (timeoutMs) => {
        // runs in page context
        function fetchWithTimeout(url, timeout) {
          return new Promise((resolve) => {
            const controller = new AbortController();
            const id = setTimeout(() => {
              controller.abort();
              resolve(null);
            }, timeout);
            fetch(url, { signal: controller.signal, credentials: "same-origin" })
              .then(r => {
                clearTimeout(id);
                if (!r.ok) return resolve(null);
                r.text().then(t => resolve(t)).catch(() => resolve(null));
              })
              .catch(() => {
                clearTimeout(id);
                resolve(null);
              });
          });
        }

        function extractIdsFromText(text) {
          const set = new Set();
          if (!text) return set;
          for (const raw of text.split("\n")) {
            if (!/adwmg/i.test(raw)) continue;
            const parts = raw.split(",").map(p => p.trim());
            if (parts.length < 2) continue;
            const id = parts[1].replace(/\D/g, "");
            if (id.length > 0) set.add(id);
          }
          return set;
        }

        async function tryFetch(name) {
          try {
            const origin = location.origin;
            if (!/^https?:\/\//i.test(origin)) return null;
            const url = origin.replace(/\/$/, "") + "/" + name;
            return await fetchWithTimeout(url, timeoutMs);
          } catch {
            return null;
          }
        }

        return (async () => {
          try {
            const [ads, appads] = await Promise.all([tryFetch("ads.txt"), tryFetch("app-ads.txt")]);
            const ids = new Set();
            for (const s of Array.from(extractIdsFromText(ads))) ids.add(s);
            for (const s of Array.from(extractIdsFromText(appads))) ids.add(s);
            return { ok: true, ids: Array.from(ids) };
          } catch {
            return { ok: false, ids: [] };
          }
        })();
      },
      args: [FETCH_TIMEOUT_MS],
      world: "MAIN"
    });

    if (!Array.isArray(results) || results.length === 0) return { ok: false, ids: [] };
    const res0 = results[0] && results[0].result;
    if (!res0 || res0.ok !== true) return { ok: false, ids: [] };
    return { ok: true, ids: Array.isArray(res0.ids) ? res0.ids : [] };
  } catch (err) {
    console.warn("executeExtractSellerIds failed:", err && err.message);
    return { ok: false, ids: [] };
  }
}

async function doScanForTab(tabId) {
  if (!badgeEnabled) return null;
  // cooldown
  if (Date.now() - (lastScanAt[tabId] || 0) < SCAN_COOLDOWN_MS) return null;
  lastScanAt[tabId] = Date.now();

  // sanity check tab
  const tab = await new Promise((resolve) => chrome.tabs.get(tabId, (t) => resolve(chrome.runtime.lastError ? null : t)));
  if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) return null;

  // get seller ids from page
  const pageRes = await executeExtractSellerIds(tabId);
  const pageIds = Array.isArray(pageRes.ids) ? pageRes.ids : [];

  // load cached sellers
  let cached = await getCachedSellers();
  // if empty/stale, try to fetch
  if ((!cached.sellers || cached.sellers.length === 0) || (Date.now() - (cached.ts || 0) > cacheTtlMs)) {
    const fetched = await fetchAndCacheSellers().catch(() => null);
    if (fetched && Array.isArray(fetched)) {
      cached.sellers = fetched;
      cached.ts = Date.now();
    } else {
      // keep whatever cached.sellers was (may be empty)
    }
  }

  // build set of seller_ids from cached sellers
  const sellersSet = new Set((cached.sellers || []).map(s => String(s.seller_id)));
  // compute intersection
  let matches = 0;
  for (const id of pageIds) {
    if (sellersSet.has(String(id))) matches++;
  }

  countsByTab[tabId] = matches;
  // update badge if this tab is active
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].id === tabId) applyBadgeForTab(tabId);
  });

  return matches;
}

// schedule scan per options
function scheduleScan(tabId) {
  cancelScheduled(tabId);
  if (!badgeEnabled) return;
  const delayMs = (scanTiming === "delayed") ? Math.max(0, scanDelay) * 1000 : 0;
  if (delayMs === 0) {
    doScanForTab(tabId).catch(() => {});
  } else {
    scheduledTimers[tabId] = setTimeout(() => {
      delete scheduledTimers[tabId];
      doScanForTab(tabId).catch(() => {});
    }, delayMs);
  }
}

// lifecycle hooks
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!badgeEnabled) { chrome.action.setBadgeText({ text: "" }); return; }
  applyBadgeForTab(activeInfo.tabId);
  scheduleScan(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!badgeEnabled) { chrome.action.setBadgeText({ text: "" }); return; }
  if (changeInfo.status === "complete") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id === tabId) scheduleScan(tabId);
    });
  }
  if (changeInfo.status === "loading" || changeInfo.url) {
    delete countsByTab[tabId];
    cancelScheduled(tabId);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id === tabId) applyBadgeForTab(tabId);
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete countsByTab[tabId];
  delete lastScanAt[tabId];
  cancelScheduled(tabId);
});

// messages: getSellersCache / refreshSellers / optionsUpdated / setBadge / scanResult fallback
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Обязательно возвращаем true, чтобы sendResponse можно было вызвать позже.
  const isAsync = true;
  
  (async () => {
    let response = {};
    if (!message || !message.type) { 
      // response = {}; // уже установлено
    } else if (message.type === "getSellersCache") {
      const cached = await getCachedSellers();
      if (!cached.ts || (Date.now() - cached.ts) > cacheTtlMs) {
        fetchAndCacheSellers().catch(() => {});
      }
      response = { sellers: cached.sellers || [], ts: cached.ts || 0 };
    } else if (message.type === "refreshSellers") {
      const sellers = await fetchAndCacheSellers(true).catch(() => null);
      if (sellers) response = { ok: true, sellers }; else response = { ok: false };
    } else if (message.type === "optionsUpdated") {
      if (typeof message.sellersUrl === "string") sellersUrl = message.sellersUrl || DEFAULT_SELLERS_URL;
      if (typeof message.cacheTtlMin === "number") cacheTtlMs = Math.max(1, message.cacheTtlMin) * 60 * 1000;
      if (typeof message.badgeEnable === "boolean") badgeEnabled = message.badgeEnable;
      if (typeof message.scanMode === "string") scanMode = (message.scanMode === "content") ? "content" : "background";
      if (typeof message.scanTiming === "string") scanTiming = (message.scanTiming === "delayed") ? "delayed" : "immediate";
      if (typeof message.scanDelay === "number") scanDelay = Math.max(0, message.scanDelay);

      chrome.storage.local.set({
        sellersUrl,
        cacheTtlMin: Math.round(cacheTtlMs / 60000),
        badgeEnable,
        scanMode,
        scanTiming,
        scanDelay
      }, () => {});

      if (typeof message.sellersUrl === "string") {
        fetchAndCacheSellers().catch(() => {});
      }

      if (!badgeEnabled) {
        for (const k in countsByTab) if (Object.prototype.hasOwnProperty.call(countsByTab, k)) delete countsByTab[k];
        chrome.action.setBadgeText({ text: "" });
      }
      response = { ok: true };
    } else if (message.type === "setBadge") {
      if (!badgeEnabled) { 
        chrome.action.setBadgeText({ text: "" }); 
        response = { ok: true, ignored: true };
      } else {
        const count = Number.isFinite(message.count) ? Math.max(0, message.count) : 0;
        const text = count > 0 ? String(count) : "";
        chrome.action.setBadgeText({ text });
        if (text) chrome.action.setBadgeBackgroundColor({ color: BADGE_BG_COLOR });
        response = { ok: true };
      }
    } else if (message.type === "scanResult") {
      const tabId = sender && sender.tab && sender.tab.id;
      const count = Number.isFinite(message.count) ? Math.max(0, message.count) : 0;
      if (typeof tabId === "number") {
        countsByTab[tabId] = count;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs[0] && tabs[0].id === tabId) applyBadgeForTab(tabId);
        });
      }
      response = { ok: true };
    }

    // Один и единственный вызов sendResponse
    sendResponse(response);
  })().catch((error) => {
    // В случае ошибки, выводим только сообщение об ошибке, чтобы избежать ReferenceError
    // при попытке доступа к глобальным переменным в невалидном контексте.
    console.error("Async response failed:", error && error.message || "Unknown error");
    sendResponse({ ok: false, error: error && error.message || "Unknown error" });
  });

  // indicate we'll respond asynchronously
  return isAsync;
});