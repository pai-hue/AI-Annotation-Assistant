"use strict";
// FramePilot side panel. This is a thin view/controller: the authoritative per-tab
// state lives in the tab's content script, and the background routes messages.
// The side panel never triggers a paid request by itself; every command is routed
// to the target tab's content script, which performs its own trust/eligibility checks.
(() => {
  const projectEl = document.getElementById("panel-project");
  const statusEl = document.getElementById("panel-status");
  const yoloButton = document.getElementById("btn-yolo");
  const mockButton = document.getElementById("btn-mock");
  const classList = document.getElementById("class-list");
  const modelsRefresh = document.getElementById("btn-models-refresh");
  const modelCurrent = document.getElementById("yolo-model-current");
  const modelReady = document.getElementById("yolo-model-ready");
  const modelClassNames = document.getElementById("yolo-class-names");
  const modelSelect = document.getElementById("yolo-model-select");
  const modelSwitchBtn = document.getElementById("btn-model-switch");
  const modelModal = document.getElementById("model-modal");
  const modelModalFrom = document.getElementById("model-modal-from");
  const modelModalTo = document.getElementById("model-modal-to");
  const modelConfirm = document.getElementById("model-confirm");
  const modelCancel = document.getElementById("model-cancel");

  let tabId = null;
  let myWindowId = null;
  let current = null;
  let yoloStatus = null;
  let yoloModels = null;
  let pendingSwitchPath = null;

  function render(state) {
    current = state;
    if (!state) {
      projectEl.textContent = "非支持网站或页面未就绪";
      yoloButton.disabled = mockButton.disabled = true;
      classList.replaceChildren();
      classList.className = "class-list";
      statusEl.textContent = "请在原网站标注页打开侧边栏，并刷新该页面。";
      statusEl.classList.remove("error");
      renderModelTags([]);
      return;
    }
    const busy = !!state.busy;
    const locked = busy || !state.ready;
    const classes = Array.isArray(state.classes) ? state.classes : [];
    const enabled = new Set(Array.isArray(state.enabledClassIds) ? state.enabledClassIds : []);
    const noneEnabled = classes.length > 0 && enabled.size === 0;
    projectEl.textContent = state.project ? `当前项目：${state.project}` : "未连接项目";
    yoloButton.disabled = locked || noneEnabled;
    mockButton.disabled = locked;
    statusEl.textContent = String(state.label || "");
    statusEl.classList.toggle("error", !!state.error);
    renderClasses(classes, enabled, busy);
    renderModelTags((yoloStatus && yoloStatus.class_names) || []);
  }

  function renderClasses(classes, enabled, locked) {
    classList.replaceChildren();
    classList.className = "class-list" + (locked ? " locked" : "");
    for (const c of classes) {
      const item = document.createElement("div");
      item.className = "class-item";
      const box = document.createElement("span");
      const on = enabled.has(c.id);
      box.className = "class-box" + (on ? " on" : "");
      box.setAttribute("role", "checkbox");
      box.setAttribute("aria-checked", String(on));
      const name = document.createElement("span");
      name.className = "class-name";
      name.textContent = c.name;
      item.append(box, name);
      item.addEventListener("click", () => {
        if (locked) return;
        sendCommand({ action: "toggle_class", classId: c.id });
      });
      classList.append(item);
    }
  }

  function projectClassNames() {
    if (!current || !Array.isArray(current.classes)) return new Set();
    return new Set(current.classes.map(c => c.name));
  }

  function renderModelTags(names) {
    modelClassNames.replaceChildren();
    if (!Array.isArray(names) || !names.length) return;
    const projectNames = projectClassNames();
    const hasProject = projectNames.size > 0;
    for (const name of names) {
      const tag = document.createElement("span");
      let cls = "yolo-tag";
      if (hasProject) cls += projectNames.has(name) ? " match" : " miss";
      tag.className = cls;
      tag.textContent = hasProject
        ? (projectNames.has(name) ? `${name} · 匹配` : `${name} · 未匹配`)
        : String(name);
      modelClassNames.append(tag);
    }
  }

  function renderYoloModelUi() {
    const st = yoloStatus || {};
    const list = yoloModels || {};
    const name = st.model_name || list.current_model_name || "(未配置)";
    const path = st.model_path || list.current_model_path || "";
    modelCurrent.textContent = path ? `当前权重：${name}` : "当前权重：未找到";
    if (path) modelCurrent.title = path;
    if (st.configured) {
      modelReady.textContent = "状态：就绪（本机 YOLO）";
      modelReady.classList.remove("error");
    } else {
      const reason = st.load_error || (!st.ultralytics ? "未安装 Ultralytics" : "权重未就绪");
      modelReady.textContent = `状态：未就绪 — ${reason}`;
      modelReady.classList.add("error");
    }
    if (st.configured && Array.isArray(st.class_names)) {
      renderModelTags(st.class_names);
    } else {
      renderModelTags([]);
    }
    const models = Array.isArray(list.models) ? list.models : [];
    const selected = modelSelect.value;
    modelSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = models.length ? "请选择 .pt 文件" : "约定目录下暂无 .pt";
    modelSelect.append(placeholder);
    for (const item of models) {
      const opt = document.createElement("option");
      opt.value = item.path;
      const sizeMb = item.size_bytes ? ` (${(item.size_bytes / (1024 * 1024)).toFixed(1)} MB)` : "";
      opt.textContent = item.path + sizeMb;
      modelSelect.append(opt);
    }
    const prefer = selected || list.current_relative_path || "";
    if (prefer && models.some(m => m.path === prefer)) modelSelect.value = prefer;
    modelSelect.disabled = models.length === 0;
    updateSwitchEnabled();
  }

  function updateSwitchEnabled() {
    const path = modelSelect.value;
    const currentRel = (yoloModels && yoloModels.current_relative_path) || "";
    modelSwitchBtn.disabled = !path || path === currentRel;
  }

  function refreshYoloModels() {
    modelCurrent.textContent = "正在读取本机权重…";
    chrome.runtime.sendMessage({ type: "PANEL_YOLO_STATUS" }, statusResp => {
      if (chrome.runtime.lastError || !statusResp || statusResp.ok !== true) {
        yoloStatus = null;
        modelCurrent.textContent = "当前权重：无法连接本机服务";
        modelReady.textContent = "请确认后端已在 127.0.0.1:18000 启动";
        modelReady.classList.add("error");
        renderModelTags([]);
      } else {
        const data = statusResp.data || {};
        yoloStatus = data.yolo || data;
      }
      chrome.runtime.sendMessage({ type: "PANEL_YOLO_MODELS" }, modelsResp => {
        if (chrome.runtime.lastError || !modelsResp || modelsResp.ok !== true) {
          yoloModels = { models: [] };
        } else {
          yoloModels = modelsResp.data || { models: [] };
        }
        renderYoloModelUi();
      });
    });
  }

  function showModelModal(path) {
    pendingSwitchPath = path;
    const fromName = (yoloStatus && yoloStatus.model_name) || (yoloModels && yoloModels.current_model_name) || "无";
    modelModalFrom.textContent = `当前：${fromName}`;
    modelModalTo.textContent = `切换为：${path}`;
    modelModal.hidden = false;
  }

  function hideModelModal() {
    modelModal.hidden = true;
    pendingSwitchPath = null;
  }

  function confirmModelSwitch() {
    const path = pendingSwitchPath;
    hideModelModal();
    if (!path) return;
    modelSwitchBtn.disabled = true;
    statusEl.textContent = "正在切换 YOLO 权重…";
    statusEl.classList.remove("error");
    chrome.runtime.sendMessage({ type: "PANEL_YOLO_SWITCH", path, confirm: true }, response => {
      if (chrome.runtime.lastError || !response || response.ok !== true) {
        statusEl.textContent = (response && response.error) || "切换失败，已保留原权重";
        statusEl.classList.add("error");
        refreshYoloModels();
        return;
      }
      const data = response.data || {};
      statusEl.textContent = `已切换为 ${data.model_name || path}`;
      statusEl.classList.remove("error");
      refreshYoloModels();
    });
  }

  function sendCommand(command) {
    if (tabId == null) return;
    chrome.runtime.sendMessage({ type: "PANEL_COMMAND", tabId, command }, response => {
      if (chrome.runtime.lastError || !response || response.ok !== true) {
        render(null);
        return;
      }
      render(response.state);
    });
  }

  async function currentTabId() {
    try {
      let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs.length) tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tabs[0] ? tabs[0].id : null;
    } catch { return null; }
  }

  async function refresh() {
    const id = await currentTabId();
    tabId = id;
    if (id == null) { render(null); return; }
    chrome.runtime.sendMessage({ type: "PANEL_GET_STATE", tabId: id }, response => {
      if (chrome.runtime.lastError || !response || response.ok !== true) { render(null); return; }
      render(response.state);
    });
  }

  yoloButton.addEventListener("click", event => {
    if (event.isTrusted !== true || yoloButton.disabled) return;
    sendCommand({ action: "begin", mode: "yolo" });
  });
  mockButton.addEventListener("click", event => {
    if (event.isTrusted !== true || mockButton.disabled) return;
    sendCommand({ action: "begin", mode: "mock" });
  });
  modelsRefresh.addEventListener("click", event => {
    if (event.isTrusted !== true) return;
    refreshYoloModels();
  });
  modelSelect.addEventListener("change", () => updateSwitchEnabled());
  modelSwitchBtn.addEventListener("click", event => {
    if (event.isTrusted !== true || modelSwitchBtn.disabled) return;
    const path = modelSelect.value;
    if (!path) return;
    showModelModal(path);
  });
  modelConfirm.addEventListener("click", event => {
    if (event.isTrusted !== true) return;
    confirmModelSwitch();
  });
  modelCancel.addEventListener("click", () => hideModelModal());
  chrome.runtime.onMessage.addListener(message => {
    if (message && message.type === "PANEL_STATE" && message.tabId === tabId) render(message.state);
  });

  chrome.tabs.onActivated.addListener(info => {
    if (myWindowId != null && info.windowId !== myWindowId) return;
    refresh();
  });
  chrome.tabs.onUpdated.addListener((id, changeInfo, tab) => {
    if (myWindowId != null && tab && tab.windowId !== myWindowId) return;
    if ((changeInfo.status === "complete" || changeInfo.url) && (!tab || tab.active)) refresh();
  });

  (async () => {
    try {
      const win = await chrome.windows.getCurrent();
      myWindowId = win.id;
    } catch {}
    refreshYoloModels();
    refresh();
  })();
})();
