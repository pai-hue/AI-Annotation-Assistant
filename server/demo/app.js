"use strict";
const el = Object.fromEntries(["file", "generate", "clear", "status", "empty", "stage", "preview", "overlay", "metadata", "count", "result"].map(id => [id, document.getElementById(id)]));
let current = null;
let objects = [];
let loadVersion = 0;
let controller = null;
let activeUrl = null;
let imageName = "image";
let extensionRequest = null;
const bridgeChannel = "annotation-assistant-v1";
function bridgePost(data) {
  window.postMessage({channel: bridgeChannel, from: "page", ...data}, location.origin);
}
function status(message, error = false) {
  el.status.textContent = message;
  el.status.dataset.error = String(error);
}
function controls() {
  const busy = !!controller || !!extensionRequest || !!gesture;
  el.generate.disabled = !current || busy || objects.length > 0;
  el.clear.disabled = objects.length === 0;
  bridgePost({type: "state", busy, canGenerate: !el.generate.disabled});
  editorControls(busy);
}
function clearBoxes() {
  objects = [];
  el.overlay.replaceChildren();
  el.count.textContent = "0 个框";
  el.result.textContent = "暂无结果";
  resetEditor();
  controls();
}
el.clear.addEventListener("click", () => { if (controller || extensionRequest || gesture) return; clearBoxes(); markEdited(); status("已清空，可以重新生成测试框，或确认无目标后导出。"); });
el.file.addEventListener("change", async () => {
  const file = el.file.files[0];
  if (!file) return;
  if (dirty && !window.confirm("当前标注尚未导出，切换图片会丢失改动。继续吗？")) { el.file.value = ""; return; }
  const version = ++loadVersion;
  controller?.abort();
  controller = null;
  if (extensionRequest) clearTimeout(extensionRequest.timer);
  extensionRequest = null;
  current = null;
  clearBoxes();
  el.stage.hidden = true;
  el.empty.hidden = false;
  el.preview.removeAttribute("src");
  if (activeUrl) URL.revokeObjectURL(activeUrl);
  activeUrl = null;
  el.metadata.textContent = "尚未加载";
  if (!["image/png", "image/jpeg"].includes(file.type)) {
    status("请选择 PNG 或 JPEG 图片。", true); return;
  }
  status("正在加载图片…");
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (version !== loadVersion) { URL.revokeObjectURL(url); return; }
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > 1000000 || height > 1000000) throw new Error("图片尺寸不受支持。");
    activeUrl = url;
    imageName = file.name;
    current = {image_id: crypto.randomUUID(), image_width: width, image_height: height};
    el.preview.src = url;
    el.stage.style.width = `${width}px`;
    el.overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    el.stage.hidden = false;
    el.empty.hidden = true;
    el.metadata.textContent = `${file.name} · ${width} × ${height} 像素`;
    status("图片已加载，点击“生成测试框”。");
  } catch (error) {
    URL.revokeObjectURL(url);
    if (version === loadVersion) status("图片加载失败，请选择有效的 PNG 或 JPEG 图片。", true);
  }
  controls();
});
function validate(data, expected) {
  if (!data || data.schema_version !== "1.0" || data.source !== "mock" || data.review_status !== "pending" ||
      data.image_id !== expected.image_id || data.image_width !== expected.image_width || data.image_height !== expected.image_height ||
      !Array.isArray(data.objects)) throw new Error("接口返回格式不正确。");
  const ids = new Set();
  for (const box of data.objects) {
    if (!box || typeof box.id !== "string" || !box.id || ids.has(box.id) || box.class_id !== 0 || box.class_name !== "part_A" ||
        ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 ||
        box.x + box.width > expected.image_width || box.y + box.height > expected.image_height) throw new Error("接口返回了无效的标注框。");
    ids.add(box.id);
  }
}
function render(data) {
  objects = data.objects.map(box => ({...box, source: "mock", edited: false}));
  selectedId = null;
  markEdited();
}
el.generate.addEventListener("click", async () => {
  if (!current || controller || extensionRequest || gesture || objects.length) return;
  const expected = {...current};
  const request = new AbortController();
  controller = request;
  controls();
  status("正在请求模拟标注…");
  const timeout = setTimeout(() => request.abort(), 30000);
  try {
    const response = await fetch("/api/annotations/mock", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(expected), signal: request.signal});
    if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）。`);
    const data = await response.json();
    if (current?.image_id !== expected.image_id) return;
    validate(data, expected);
    render(data);
    status("模拟框已生成，尚未接入 AI。如需重新生成，请先清空框。");
  } catch (error) {
    if (current?.image_id === expected.image_id) status(error.name === "AbortError" ? "请求超时，请重试。" : `生成失败，请确认服务正常后重试。${error.message}`, true);
  } finally {
    clearTimeout(timeout);
    if (controller === request) controller = null;
    controls();
  }
});

// The page owns annotation state. The extension can only request work and return data.
window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || message.channel !== bridgeChannel || message.from !== "extension") return;
  if (message.type === "hello") { controls(); return; }
  if (message.type === "begin") {
    if (!current || controller || extensionRequest || gesture || objects.length ||
        typeof message.requestId !== "string" || !message.requestId || message.requestId.length > 100) {
      controls(); return;
    }
    const requestId = message.requestId;
    const expected = {...current};
    const timer = setTimeout(() => {
      if (extensionRequest?.requestId !== requestId) return;
      extensionRequest = null;
      status("扩展请求超时，请确认扩展及服务状态后重试。", true);
      controls();
    }, 30000);
    extensionRequest = {requestId, expected, timer};
    controls();
    status("正在通过扩展请求模拟标注…");
    bridgePost({type: "request", requestId, image: expected});
    return;
  }
  if (message.type !== "result" || !extensionRequest || message.requestId !== extensionRequest.requestId) return;
  const {expected, timer} = extensionRequest;
  clearTimeout(timer);
  extensionRequest = null;
  try {
    if (current?.image_id !== expected.image_id) return;
    if (message.response?.ok !== true) throw new Error(typeof message.response?.error === "string" ? message.response.error : "扩展返回结果无效。");
    validate(message.response.data, expected);
    render(message.response.data);
    status("扩展模拟框已生成，尚未接入 AI。如需重新生成，请先清空框。");
  } catch (error) { status(error.message, true); }
  finally { controls(); }
});
