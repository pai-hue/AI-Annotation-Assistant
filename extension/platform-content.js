"use strict";
(() => {
  if(location.origin !== "https://www.threetone.com.cn" || !/^\/train\/annotation\/[^/]+\/editor$/.test(location.pathname)) return;
  const channel="aaa-deepdata-v1";
  const post=data=>window.postMessage({channel,from:"extension",...data},location.origin);

  // Authoritative per-tab state. The side panel mirrors this through the background.
  let pending=null,timeout=null,ready=false;
  let classEnabled=new Map(),currentProject=null,currentClasses=null;
  let statusText="正在连接原网站标注器…",statusError=false;

  function enabledClassIds() {
    return [...classEnabled.entries()].filter(([,on])=>on).map(([id])=>id);
  }
  function snapshotState() {
    return {
      ready,
      busy: !!pending,
      project: currentProject,
      classes: currentClasses,
      enabledClassIds: enabledClassIds(),
      label: statusText,
      error: statusError,
    };
  }
  function pushState() {
    try {
      chrome.runtime.sendMessage({type:"TAB_STATE",state:snapshotState()},()=>{ void chrome.runtime.lastError; });
    } catch {}
  }
  function setStatus(text,error=false) {
    statusText=text;statusError=error;pushState();
  }
  // Keep the on/off state for classes that are still the same id+name; a new or
  // changed class starts enabled. Project switch resets. Locked during request.
  function renderClasses(list, project) {
    if(!Array.isArray(list)) return;
    if(pending) return;
    if(project !== currentProject) {
      currentProject=project;
      currentClasses=list;
      classEnabled=new Map(list.map(c=>[c.id,true]));
      return;
    }
    if(JSON.stringify(list) === JSON.stringify(currentClasses)) return;
    const prevNames=new Map(currentClasses.map(c=>[c.id,c.name]));
    classEnabled=new Map(list.map(c=>[c.id, prevNames.get(c.id)===c.name ? (classEnabled.get(c.id) ?? true) : true]));
    currentClasses=list;
  }
  function begin(mode) {
    // Page bridge messages alone cannot initiate a request.
    // YOLO / mock are local-only; no third-party send gate.
    if(pending || !ready) { pushState(); return; }
    let enabled;
    if(mode==="yolo") {
      enabled=enabledClassIds();
      if(!enabled.length) { setStatus("请至少选择一个要识别的类别。", true); return; }
    }
    pending={id:crypto.randomUUID(),mode,sent:false};
    setStatus(mode==="yolo" ? "本机 YOLO 正在生成初始框…" : "正在请求本机模拟服务…");
    timeout=setTimeout(()=>{pending=null;setStatus("连接超时，请刷新网页后重试。",true);post({type:"hello"});},32000);
    post({type:"begin",requestId:pending.id,mode,...(enabled?{enabledClassIds:enabled}:{})});
  }
  const YOLO_SHORTCUT={key:"Enter",ctrlKey:false,altKey:false,metaKey:false,shiftKey:false};
  window.addEventListener("keydown",event=>{
    if(event.repeat || !event.isTrusted) return;
    if(event.key.toLowerCase()!==YOLO_SHORTCUT.key.toLowerCase()
       || !!event.ctrlKey!==!!YOLO_SHORTCUT.ctrlKey
       || !!event.altKey!==!!YOLO_SHORTCUT.altKey
       || !!event.metaKey!==!!YOLO_SHORTCUT.metaKey
       || !!event.shiftKey!==!!YOLO_SHORTCUT.shiftKey) return;
    const target=event.target;
    if(target && typeof target.closest==="function" && target.closest("input,textarea,select,[contenteditable],button,a,[role='button']")) return;
    event.preventDefault();
    begin("yolo");
  });
  // Commands from the side panel, routed via background. sender.id must match us.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(!sender || sender.id !== chrome.runtime.id) return;
    if(message?.type === "PANEL_HELLO") { sendResponse(snapshotState()); return; }
    if(message?.type === "PANEL_COMMAND") {
      const cmd=message.command;
      if(cmd && typeof cmd==="object") {
        if(cmd.action === "toggle_class") {
          if(!pending && Number.isInteger(cmd.classId) && classEnabled.has(cmd.classId)) {
            classEnabled.set(cmd.classId, !classEnabled.get(cmd.classId));
          }
        }
        else if(cmd.action === "begin") {
          if(cmd.mode === "yolo" || cmd.mode === "mock") begin(cmd.mode);
        }
      }
      pushState();
      sendResponse(snapshotState());
      return;
    }
  });
  window.addEventListener("message",event=>{
    if(event.source !== window || event.origin !== location.origin) return;
    const message=event.data;
    if(!message || message.channel !== channel || message.from !== "platform") return;
    if(message.type === "state") {
      ready=message.ready===true;
      statusText=String(message.label || "");
      statusError=false;
      renderClasses(message.classes,message.project);
      pushState();
    }
    if(message.type === "done" && pending && (!message.requestId || message.requestId===pending.id)) {
      clearTimeout(timeout);pending=null;
      statusText=String(message.message || "");statusError=message.error === true;
      pushState();post({type:"hello"});
    }
    if(message.type !== "request" || !pending || pending.id !== message.requestId || pending.mode !== message.mode || pending.sent) return;
    pending.sent=true;
    const requestId=pending.id;
    try {
      const msgType=pending.mode==="yolo"?"ANNOTATION_YOLO":"ANNOTATION_MOCK";
      chrome.runtime.sendMessage({type:msgType,image:message.image},response=>{
        const error=chrome.runtime.lastError;
        if(requestId !== pending?.id) return;
        post({type:"result",requestId,response:error?{ok:false,error:"扩展连接已失效，请刷新页面。"}:response});
      });
    } catch {post({type:"result",requestId,response:{ok:false,error:"扩展已更新，请刷新网页。"}});}
  });
  post({type:"hello"});
  // Poll eligibility metadata only; image capture follows a clicked YOLO request.
  const poll=setInterval(()=>post({type:"hello"}),1000);
  window.addEventListener("pagehide",()=>{clearInterval(poll);clearTimeout(timeout);});
})();
