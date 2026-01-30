// 💉 content_script.js (Исправлен)
(async () => {
  if (window.top !== window) return;
  if (!/^https?:\/\//i.test(location.protocol)) return;

  function fetchWithTimeout(url, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const id = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);
      fetch(url, { signal: controller.signal, credentials: "same-origin" })
        .then(r => {
          clearTimeout(id);
          if (!r.ok) return resolve(null);
          return r.text().then(t => resolve(t)).catch(() => resolve(null));
        })
        .catch(() => {
          clearTimeout(id);
          resolve(null);
        });
    });
  }

  async function tryFetch(name) {
    try {
      const origin = location.origin;
      const url = origin.replace(/\/$/, "") + "/" + name;
      return await fetchWithTimeout(url, 8000);
    } catch {
      return null;
    }
  }

  function countAdwmgLines(text) {
    if (!text) return 0;
    return text.split("\n").filter(l => /adwmg/i.test(l)).length;
  }

  try {
    const [ads, appads] = await Promise.all([tryFetch("ads.txt"), tryFetch("app-ads.txt")]);
    const count = (ads ? countAdwmgLines(ads) : 0) + (appads ? countAdwmgLines(appads) : 0);
    
    // Добавлена пустая функция обратного вызова для обработки runtime.lastError
    chrome.runtime.sendMessage({ type: "scanResult", count }, () => {
      if (chrome.runtime.lastError) {
        // Игнорируем ошибку, чтобы она не появлялась в консоли
        return;
      }
    });
  } catch (e) {
  }
})();