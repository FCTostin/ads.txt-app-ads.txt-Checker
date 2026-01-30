(() => {
  const adsTab = document.getElementById("ads-tab");
  const appAdsTab = document.getElementById("appads-tab");
  const sellerTab = document.getElementById("seller-tab");
  const output = document.getElementById("output");
  const filterCheckbox = document.getElementById("filter-checkbox");
  const filterBlock = document.getElementById("filter-block");
  const linkBlock = document.getElementById("link-block");
  const openOptionsBtn = document.getElementById("openOptionsBtn");

  let adsText = "";
  let appAdsText = "";
  let adsUrl = "";
  let appAdsUrl = "";
  let sellersData = [];
  let current = "seller";

  async function fetchWithTimeoutAndRetry(url, { timeout = 8000, retries = 1, fetchOptions = {} } = {}) {
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
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }

  function isHttpOrigin(base) {
    return typeof base === "string" && /^https?:\/\//i.test(base);
  }

  function getActiveTabOrigin() {
    return new Promise(resolve => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          try {
            const tabUrl = tabs && tabs[0] && tabs[0].url ? tabs[0].url : "";
            const url = new URL(tabUrl);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
              resolve("");
              return;
            }
            resolve(url.origin);
          } catch {
            resolve("");
          }
        });
      } catch {
        resolve("");
      }
    });
  }

  async function fetchTxtFile(base, name) {
    if (!base || !isHttpOrigin(base)) return { text: `File ${name} not found.`, finalUrl: "" };
    const url = `${base.replace(/\/$/, "")}/${name}`;
    try {
      const res = await fetchWithTimeoutAndRetry(url, { timeout: 8000, retries: 1 });
      const text = await res.text();
      return { text, finalUrl: res.url || url };
    } catch {
      return { text: `File ${name} not found.`, finalUrl: "" };
    }
  }

  function renderTextSafe(container, text, highlightRegex = /(adwmg\.com)/gi) {
    container.innerHTML = ""; // clear
    if (!text) return;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNode = document.createElement("div");
      let lastIndex = 0;
      highlightRegex.lastIndex = 0;
      let match;
      while ((match = highlightRegex.exec(line)) !== null) {
        const before = line.substring(lastIndex, match.index);
        if (before) lineNode.appendChild(document.createTextNode(before));
        const b = document.createElement("b");
        b.textContent = match[0];
        lineNode.appendChild(b);
        lastIndex = highlightRegex.lastIndex;
      }
      const rest = line.substring(lastIndex);
      if (rest) lineNode.appendChild(document.createTextNode(rest));
      container.appendChild(lineNode);
    }
  }

  function filterAndRender(text, container) {
    if (!filterCheckbox.checked) {
      renderTextSafe(container, text);
      return;
    }
    const filtered = (text || "").split("\n").filter(l => /adwmg/i.test(l));
    if (filtered.length === 0) {
      container.textContent = "No matches found.";
    } else {
      renderTextSafe(container, filtered.join("\n"));
    }
  }

  function extractAdwmgSellerIds(text) {
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

  function findSellerMatchesForAdwmg() {
    const ids = new Set([
      ...extractAdwmgSellerIds(adsText),
      ...extractAdwmgSellerIds(appAdsText),
    ]);
    if (ids.size === 0) return [];
    return sellersData
      .filter(rec => ids.has(String(rec.seller_id)))
      .map(rec => ({
        domain: rec.domain || "-",
        seller_id: rec.seller_id || "-",
        seller_type: rec.seller_type || "-",
      }));
  }

  function setLinkBlock(url) {
    linkBlock.textContent = "";
    if (!url) return;
    try {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.textContent = url;
      linkBlock.appendChild(a);
    } catch {
    }
  }

  function updateBadge(count) {
    chrome.runtime.sendMessage({ type: "setBadge", count }, () => { /* ignore */ });
  }

  function showCurrent() {
    setLinkBlock("");

    if (current === "ads") {
      filterBlock.style.display = "block";
      setLinkBlock(adsUrl);
      filterAndRender(adsText, output);

    } else if (current === "appads") {
      filterBlock.style.display = "block";
      setLinkBlock(appAdsUrl);
      filterAndRender(appAdsText, output);

    } else {
      filterBlock.style.display = "none";
      const matches = findSellerMatchesForAdwmg();
      if (matches.length === 0) {
        output.textContent = "No adwmg.com matches found.";
      } else {
        output.textContent = matches.map(m => `${m.domain} (${m.seller_id}) — ${m.seller_type}`).join("\n");
      }
      updateBadge(matches.length);
    }
  }

  function setActive(tab) {
    current = tab;
    [adsTab, appAdsTab, sellerTab].forEach(b => b.classList.remove("active"));
    if (tab === "ads") adsTab.classList.add("active");
    if (tab === "appads") appAdsTab.classList.add("active");
    if (tab === "seller") sellerTab.classList.add("active");
    showCurrent();
  }

  adsTab.addEventListener("click", () => setActive("ads"));
  appAdsTab.addEventListener("click", () => setActive("appads"));
  sellerTab.addEventListener("click", () => setActive("seller"));
  filterCheckbox.addEventListener("change", showCurrent);

  if (openOptionsBtn) {
    openOptionsBtn.addEventListener("click", () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        const id = chrome.runtime.id;
        window.open(`chrome-extension://${id}/options.html`);
      }
    });
  }

  async function loadData() {
    output.textContent = "Loading...";
    const origin = await getActiveTabOrigin();

    const [adsRes, appRes] = await Promise.all([
      fetchTxtFile(origin, "ads.txt"),
      fetchTxtFile(origin, "app-ads.txt")
    ]);

    adsText = adsRes.text;
    adsUrl = adsRes.finalUrl || (origin ? `${origin}/ads.txt` : "");
    appAdsText = appRes.text;
    appAdsUrl = appRes.finalUrl || (origin ? `${origin}/app-ads.txt` : "");

    chrome.runtime.sendMessage({ type: "getSellersCache" }, (response) => {
      try {
        sellersData = Array.isArray(response && response.sellers) ? response.sellers : [];
      } catch {
        sellersData = [];
      }
      showCurrent();
    });

    chrome.runtime.sendMessage({ type: "refreshSellers" }, () => { /* ignore */ });
  }

  filterCheckbox.checked = true;
  loadData();
})();