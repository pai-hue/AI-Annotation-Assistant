"use strict";
// Never accept a request URL from the page: the backend is fixed.
const API_URL = "http://127.0.0.1:8000/api/annotations/mock";
const AI_URL = "http://127.0.0.1:8000/api/annotations/ai";
const MAX_DATA_URL = 2796236; // 2 MiB image, base64 + data-URL prefix.
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
function validAIImage(image) {
  if (!validImage(image) || ![image.input_width,image.input_height].every(n=>Number.isInteger(n) && n>0 && n<=1600) ||
      typeof image.image_data_url !== "string" || image.image_data_url.length > MAX_DATA_URL ||
      !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.image_data_url) ||
      !Array.isArray(image.classes) || !image.classes.length || image.classes.length>100) return false;
  const ids=new Set();
  return image.classes.every(c=>{
    if(!c || !Number.isInteger(c.id) || c.id<0 || c.id>1000000 || ids.has(c.id) ||
        typeof c.name!=="string" || !c.name.trim() || c.name.length>100) return false;
    ids.add(c.id);return true;
  });
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const ai = message?.type === "ANNOTATION_AI";
  if (!allowedSender(sender) || !["ANNOTATION_MOCK","ANNOTATION_AI"].includes(message?.type) ||
      !validImage(message.image) || (ai && (!sender.url.startsWith("https://www.threetone.com.cn/") || !validAIImage(message.image)))) {
    sendResponse({ok: false, error: "请求来源或图片参数无效。"});
    return false;
  }
  const {image_id, image_width, image_height} = message.image;
  const body = {image_id,image_width,image_height};
  if(ai) {
    body.input_width=message.image.input_width;body.input_height=message.image.input_height;
    body.image_data_url=message.image.image_data_url;
    body.classes=message.image.classes.map(c=>({id:c.id,name:c.name}));
  }
  const controller = new AbortController();
  // Leave time for the content script to relay the error before the page's 30s timeout.
  const timer = setTimeout(() => controller.abort(), 25000);
  (async () => {
    try {
      const response = await fetch(ai ? AI_URL : API_URL, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
        signal: controller.signal, credentials: "omit", redirect: "error",
      });
      if (!response.ok) {
        if(ai) {
          let data;
          try {data=await response.json();} catch {}
          const knownCodes=["not_configured","invalid_key","access_denied","model_unavailable","quota_or_rate_limit",
            "provider_request","provider_error","timeout","network_error","invalid_model_result","model_refusal",
            "invalid_request","invalid_image","image_too_large","invalid_origin","invalid_content_type"];
          const detail=knownCodes.includes(data?.code) && typeof data.detail==="string" && data.detail.length<300 ? data.detail : "AI 请求失败，请检查本机服务与模型配置。";
          sendResponse({ok:false,error:detail});return;
        }
        throw new Error(`服务返回 HTTP ${response.status}。`);
      }
      sendResponse({ok: true, data: await response.json()});
    } catch (error) {
      sendResponse({ok: false, error: error.name === "AbortError" ? "请求超时，请重试。" : "请求失败，请确认本机后端已启动。"});
    } finally { clearTimeout(timer); }
  })();
  return true;
});
