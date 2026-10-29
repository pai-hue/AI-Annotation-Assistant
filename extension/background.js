"use strict";
// Never accept a request URL from the page: the backend is fixed.
const API_URL = "http://127.0.0.1:18000/api/annotations/mock";
const YOLO_URL = "http://127.0.0.1:18000/api/annotations/yolo";
const YOLO_STATUS_URL = "http://127.0.0.1:18000/api/ai/status";
const YOLO_MODELS_URL = "http://127.0.0.1:18000/api/yolo/models";
const YOLO_MODEL_SWITCH_URL = "http://127.0.0.1:18000/api/yolo/model";
const MAX_DATA_URL = 2796236; // 2 MiB image, base64 + data-URL prefix.
// Toolbar action opens the current tab's side panel (Edge/Chrome 114+).
try { chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}); } catch {}
function allowedSender(sender) {
  try {
    const url = new URL(sender.url);
    const local = url.origin === "http://127.0.0.1:18000" && url.pathname.startsWith("/demo/");
    const platform = url.origin === "https://www.threetone.com.cn" && /^\/train\/annotation\/[^/]+\/editor$/.test(url.pathname);
    return sender.id === chrome.runtime.id && sender.frameId === 0 && (local || platform);
  } catch { return false; }
}
function validImage(image) {
  return image && typeof image.image_id === "string" && image.image_id.trim().length > 0 && image.image_id.length <= 256 &&
    [image.image_width, image.image_height].every(n => Number.isInteger(n) && n > 0 && n <= 1000000);
}
function validProjectId(image) {
  return typeof image.project_id === "string" && image.project_id.trim().length > 0 && image.project_id.length <= 200;
}
function validAIImage(image) {
  if (!validImage(image) || !validProjectId(image) || ![image.input_width,image.input_height].every(n=>Number.isInteger(n) && n>0 && n<=1600) ||
      typeof image.image_data_url !== "string" || image.image_data_url.length > MAX_DATA_URL ||
      !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.image_data_url) ||
      !Array.isArray(image.classes) || !image.classes.length || image.classes.length>100) return false;
  const ids=new Set();
  if(!image.classes.every(c=>{
    if(!c || !Number.isInteger(c.id) || c.id<0 || c.id>1000000 || ids.has(c.id) ||
        typeof c.name!=="string" || !c.name.trim() || c.name.length>100) return false;
    ids.add(c.id);return true;
  })) return false;
  if(image.enabled_class_ids !== undefined &&
     (!Array.isArray(image.enabled_class_ids) || !image.enabled_class_ids.length ||
      image.enabled_class_ids.some(id=>!Number.isInteger(id) || !ids.has(id)) ||
      new Set(image.enabled_class_ids).size !== image.enabled_class_ids.length)) return false;
  return true;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- Side panel <-> content script routing (sender.tab is undefined for panel messages). ---
  if (message?.type === "TAB_STATE") {
    if (sender?.tab && sender.tab.id != null) {
      try { chrome.runtime.sendMessage({type:"PANEL_STATE", tabId:sender.tab.id, state:message.state}).catch(()=>{}); } catch {}
    }
    return false;
  }
  if (message?.type === "PANEL_GET_STATE") {
    if (!Number.isInteger(message.tabId)) { sendResponse({ok:false, error:"invalid tab"}); return false; }
    chrome.tabs.sendMessage(message.tabId, {type:"PANEL_HELLO"}, response => {
      if (chrome.runtime.lastError || !response) sendResponse({ok:true, state:null});
      else sendResponse({ok:true, state:response});
    });
    return true;
  }
  if (message?.type === "PANEL_COMMAND") {
    const tabId = message.tabId, command = message.command;
    if (!Number.isInteger(tabId) || !command || typeof command !== "object") { sendResponse({ok:false, error:"invalid command"}); return false; }
    chrome.tabs.sendMessage(tabId, {type:"PANEL_COMMAND", command}, response => {
      if (chrome.runtime.lastError || !response) sendResponse({ok:false, error:"panel_page_disconnected"});
      else sendResponse({ok:true, state:response});
    });
    return true;
  }

  if (message?.type === "PANEL_YOLO_STATUS") {
    fetch(YOLO_STATUS_URL, {method:"GET", credentials:"omit", redirect:"error"})
      .then(async response => {
        if (!response.ok) throw new Error("service");
        sendResponse({ok:true, data: await response.json()});
      })
      .catch(() => sendResponse({ok:false, error:"读取 YOLO 状态失败，请确认本机后端已启动。"}));
    return true;
  }
  if (message?.type === "PANEL_YOLO_MODELS") {
    fetch(YOLO_MODELS_URL, {method:"GET", credentials:"omit", redirect:"error"})
      .then(async response => {
        if (!response.ok) throw new Error("service");
        sendResponse({ok:true, data: await response.json()});
      })
      .catch(() => sendResponse({ok:false, error:"读取权重列表失败，请确认本机后端已启动。"}));
    return true;
  }
  if (message?.type === "PANEL_YOLO_SWITCH") {
    if (typeof message.path !== "string" || !message.path.trim() || message.path.length > 512 ||
        message.path.includes("..") || message.confirm !== true) {
      sendResponse({ok:false, error:"切换参数无效"}); return false;
    }
    fetch(YOLO_MODEL_SWITCH_URL, {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({path: message.path, confirm: true}),
      credentials:"omit", redirect:"error"})
      .then(async response => {
        let data = null;
        try { data = await response.json(); } catch {}
        if (!response.ok) {
          const detail = typeof data?.detail === "string" && data.detail.length < 300
            ? data.detail : "切换失败，已保留原权重";
          sendResponse({ok:false, error: detail});
          return;
        }
        sendResponse({ok:true, data});
      })
      .catch(() => sendResponse({ok:false, error:"切换失败，请确认本机后端已启动。"}));
    return true;
  }

  // --- API relay (mock / YOLO) from the page's content script. ---
  const yolo = message?.type === "ANNOTATION_YOLO";
  if (!allowedSender(sender) || !["ANNOTATION_MOCK","ANNOTATION_YOLO"].includes(message?.type) ||
      !validImage(message.image) ||
      (yolo && (!sender.url.startsWith("https://www.threetone.com.cn/") || !validAIImage(message.image)))) {
    sendResponse({ok: false, error: "请求来源或图片参数无效。"});
    return false;
  }
  const body = {
    image_id: message.image.image_id,
    image_width: message.image.image_width,
    image_height: message.image.image_height,
  };
  if(yolo) {
    body.input_width=message.image.input_width;body.input_height=message.image.input_height;
    body.image_data_url=message.image.image_data_url;
    body.classes=message.image.classes.map(c=>({id:c.id,name:c.name}));
    body.project_id=message.image.project_id;
    if(message.image.enabled_class_ids !== undefined) body.enabled_class_ids=message.image.enabled_class_ids;
  }
  const url = yolo ? YOLO_URL : API_URL;
  const controller = new AbortController();
  // Leave time for the content script to relay the error before the page's 30s timeout.
  const timer = setTimeout(() => controller.abort(), 25000);
  (async () => {
    try {
      const response = await fetch(url, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
        signal: controller.signal, credentials: "omit", redirect: "error",
      });
      if (!response.ok) {
        if(yolo) {
          let data;
          try {data=await response.json();} catch {}
          const knownCodes=["not_configured","invalid_key","access_denied","model_unavailable","quota_or_rate_limit",
            "provider_request","provider_error","timeout","network_error","invalid_model_result","model_refusal",
            "invalid_request","invalid_image","image_too_large","invalid_origin","invalid_content_type"];
          const fallback="YOLO 请求失败，请确认本机后端用含 Ultralytics 的 Python 启动且权重路径正确。";
          const detail=knownCodes.includes(data?.code) && typeof data.detail==="string" && data.detail.length<300 ? data.detail : fallback;
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
