"use strict";
// Never accept a request URL from the page: the backend is fixed.
const API_URL = "http://127.0.0.1:8000/api/annotations/mock";
function allowedSender(sender) {
  try {
    const url = new URL(sender.url);
    const local = url.origin === "http://127.0.0.1:8000" && url.pathname.startsWith("/demo/");
    const platform = url.origin === "https://www.threetone.com.cn" && /^\/train\/annotation\/[^/]+\/editor$/.test(url.pathname);
    return sender.id === chrome.runtime.id && sender.frameId === 0 && (local || platform);
  } catch { return false; }
}
function validImage(image) {
  return image && typeof image.image_id === "string" && image.image_id.trim().length > 0 && image.image_id.length <= 256 &&
    [image.image_width, image.image_height].every(n => Number.isInteger(n) && n > 0 && n <= 1000000);
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!allowedSender(sender) || message?.type !== "ANNOTATION_MOCK" || !validImage(message.image)) {
    sendResponse({ok: false, error: "请求来源或图片参数无效。"});
    return false;
  }
  const {image_id, image_width, image_height} = message.image;
  const controller = new AbortController();
  // Leave time for the content script to relay the error before the page's 30s timeout.
  const timer = setTimeout(() => controller.abort(), 25000);
  (async () => {
    try {
      const response = await fetch(API_URL, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({image_id, image_width, image_height}),
        signal: controller.signal, credentials: "omit", redirect: "error",
      });
      if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}。`);
      sendResponse({ok: true, data: await response.json()});
    } catch (error) {
      sendResponse({ok: false, error: error.name === "AbortError" ? "请求超时，请重试。" : "请求失败，请确认本机后端已启动。"});
    } finally { clearTimeout(timer); }
  })();
  return true;
});
