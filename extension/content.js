"use strict";
(() => {
  // Match patterns do not restrict ports; enforce the exact local origin here.
  if (location.origin !== "http://127.0.0.1:8000" || !location.pathname.startsWith("/demo/")) return;
  const toolbar = document.querySelector(".toolbar");
  if (!toolbar || document.getElementById("extension-generate")) return;
  const channel = "annotation-assistant-v1";
  const button = document.createElement("button");
  button.id = "extension-generate";
  button.textContent = "扩展：生成测试框";
  button.disabled = true;
  toolbar.append(button);
  let pending = null;
  const post = data => window.postMessage({channel, from: "extension", ...data}, location.origin);
  button.addEventListener("click", () => {
    if (button.disabled || pending) return;
    pending = crypto.randomUUID();
    button.disabled = true;
    post({type: "begin", requestId: pending});
  });
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== channel || message.from !== "page") return;
    if (message.type === "state") {
      if (!message.busy) pending = null;
      button.disabled = message.canGenerate !== true;
    }
    if (message.type !== "request" || !pending || message.requestId !== pending) return;
    const requestId = pending;
    // Catch extension invalidation after a developer reload as well as async errors.
    try {
      chrome.runtime.sendMessage({type: "ANNOTATION_MOCK", image: message.image}, response => {
        const runtimeError = chrome.runtime.lastError;
        if (requestId !== pending) return;
        post({type: "result", requestId, response: runtimeError ? {ok: false, error: "扩展连接失效，请刷新网页后重试。"} : response});
      });
    } catch {
      post({type: "result", requestId, response: {ok: false, error: "扩展已更新，请刷新网页后重试。"}});
    }
  });
  const indicator = document.getElementById("extension-status");
  if (indicator) indicator.textContent = "扩展已连接 · 请使用“扩展：生成测试框”验证扩展链路";
  post({type: "hello"});
})();
