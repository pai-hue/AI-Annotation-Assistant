"use strict";
(() => {
  if(location.origin !== "https://www.threetone.com.cn" || !/^\/train\/annotation\/[^/]+\/editor$/.test(location.pathname)) return;
  if(document.getElementById("aaa-platform-panel")) return;
  const channel="aaa-deepdata-v1";
  const host=document.createElement("div");host.id="aaa-platform-panel";
  const shadow=host.attachShadow({mode:"closed"});
  const style=document.createElement("style");
  style.textContent=":host{position:fixed;bottom:18px;left:250px;z-index:9999}@media(max-width:720px){:host{left:12px}}section{position:relative;overflow:auto;font-family:'Segoe UI',sans-serif;font-size:calc(var(--s,1)*13px);line-height:1.5;background:#fff;color:#173c38;border:1px solid #82b6ac;border-radius:calc(var(--s,1)*10px);padding:calc(var(--s,1)*12px) calc(var(--s,1)*16px);width:330px;max-width:calc(100vw - 58px);box-shadow:0 3px 20px #0002}button{font:inherit;background:#126b62;color:white;border:0;border-radius:calc(var(--s,1)*6px);padding:calc(var(--s,1)*8px) calc(var(--s,1)*14px);cursor:pointer;margin-right:calc(var(--s,1)*8px)}button.secondary{background:#e7efed;color:#28534b}button:disabled{opacity:.45;cursor:not-allowed}p{margin:calc(var(--s,1)*6px) 0 0;overflow-wrap:anywhere}label{display:flex;gap:calc(var(--s,1)*6px);margin:calc(var(--s,1)*8px) 0;align-items:flex-start}input{margin-top:calc(var(--s,1)*4px);accent-color:#126b62}.panel-header{cursor:move;user-select:none;touch-action:none;display:flex;align-items:center;justify-content:space-between;gap:calc(var(--s,1)*8px);font-weight:600;color:#126b62;padding-bottom:calc(var(--s,1)*8px);margin-bottom:calc(var(--s,1)*8px);border-bottom:1px solid #e7efed}.grip{color:#82b6ac;font-size:calc(var(--s,1)*12px);letter-spacing:calc(var(--s,1)*2px)}.resize-handle{position:absolute;right:3px;bottom:3px;width:12px;height:12px;cursor:se-resize;touch-action:none;border-right:2px solid #82b6ac;border-bottom:2px solid #82b6ac;border-radius:0 0 3px 0}";
  const panel=document.createElement("section");
  const header=document.createElement("div");header.className="panel-header";header.title="拖动标题栏可移动面板";
  const headerTitle=document.createElement("span");headerTitle.textContent="AI 预标注";
  const grip=document.createElement("span");grip.className="grip";grip.textContent="⠿";
  header.append(headerTitle,grip);
  const AI_SHORTCUT={key:"Enter",ctrlKey:false,altKey:false,metaKey:false,shiftKey:false};
  const aiButton=document.createElement("button");aiButton.textContent="预标注";aiButton.disabled=true;aiButton.title="快捷键 Enter";
  const mockButton=document.createElement("button");mockButton.textContent="模拟测试";mockButton.className="secondary";mockButton.disabled=true;
  const consentLabel=document.createElement("label");
  const consent=document.createElement("input");consent.type="checkbox";
  const consentText=document.createElement("span");consentText.textContent="允许将当前图片及项目类别发送到阿里云百炼";
  consentLabel.append(consent,consentText);
  const state=document.createElement("p");state.textContent="正在连接原网站标注器…";
  const feedback=document.createElement("p");feedback.setAttribute("role","status");
  const resize=document.createElement("div");resize.className="resize-handle";resize.title="拖动调整面板大小";
  panel.append(header,aiButton,mockButton,consentLabel,state,feedback,resize);shadow.append(style,panel);document.body.append(host);
  let pending=null,timeout=null,ready=false;
  const post=data=>window.postMessage({channel,from:"extension",...data},location.origin);
  function controls() {
    mockButton.disabled=!!pending || !ready;
    aiButton.disabled=!!pending || !ready || !consent.checked;
    consent.disabled=!!pending;
  }
  let drag=null;
  header.addEventListener("pointerdown",event=>{
    if(event.button!==0) return;
    event.preventDefault();
    const rect=host.getBoundingClientRect();
    drag={startX:event.clientX,startY:event.clientY,origLeft:rect.left,origTop:rect.top,width:rect.width,height:rect.height};
    host.style.left=`${rect.left}px`;host.style.top=`${rect.top}px`;host.style.bottom="auto";
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener("pointermove",event=>{
    if(!drag) return;
    const left=Math.max(0,Math.min(drag.origLeft+event.clientX-drag.startX,window.innerWidth-drag.width));
    const top=Math.max(0,Math.min(drag.origTop+event.clientY-drag.startY,window.innerHeight-drag.height));
    host.style.left=`${left}px`;host.style.top=`${top}px`;
  });
  function endDrag(){drag=null;}
  header.addEventListener("pointerup",endDrag);
  header.addEventListener("pointercancel",endDrag);
  const MIN_W=240,MIN_H=120,DEFAULT_W=330;
  let resizing=null;
  resize.addEventListener("pointerdown",event=>{
    if(event.button!==0) return;
    event.preventDefault();
    const rect=panel.getBoundingClientRect();
    const hostRect=host.getBoundingClientRect();
    host.style.left=`${hostRect.left}px`;host.style.top=`${hostRect.top}px`;host.style.bottom="auto";
    resizing={startX:event.clientX,startY:event.clientY,startWidth:rect.width,startHeight:rect.height,hostLeft:hostRect.left,hostTop:hostRect.top};
    resize.setPointerCapture(event.pointerId);
  });
  resize.addEventListener("pointermove",event=>{
    if(!resizing) return;
    const width=Math.max(MIN_W,Math.min(resizing.startWidth+event.clientX-resizing.startX,window.innerWidth-resizing.hostLeft-8));
    const height=Math.max(MIN_H,Math.min(resizing.startHeight+event.clientY-resizing.startY,window.innerHeight-resizing.hostTop-8));
    panel.style.width=`${width}px`;panel.style.height=`${height}px`;
    panel.style.setProperty("--s",String(width/DEFAULT_W));
  });
  function endResize(){resizing=null;}
  resize.addEventListener("pointerup",endResize);
  resize.addEventListener("pointercancel",endResize);
  consent.addEventListener("change",controls);
  function begin(mode,event) {
    // Page bridge messages alone cannot initiate a paid request.
    if(event.isTrusted!==true || pending || !ready || (mode==="ai" && !consent.checked)) return;
    pending={id:crypto.randomUUID(),mode,sent:false};controls();
    feedback.style.color="#126b62";
    feedback.textContent=mode==="ai" ? "千问正在生成初始框，请保持当前图片和类别不变…" : "正在请求本机模拟服务…";
    timeout=setTimeout(()=>{pending=null;feedback.textContent="连接超时，请刷新网页后重试。";controls();post({type:"hello"});},32000);
    post({type:"begin",requestId:pending.id,mode});
  }
  mockButton.addEventListener("click",event=>begin("mock",event));
  aiButton.addEventListener("click",event=>begin("ai",event));
  window.addEventListener("keydown",event=>{
    if(event.repeat || !event.isTrusted) return;
    if(event.key.toLowerCase()!==AI_SHORTCUT.key.toLowerCase()
       || !!event.ctrlKey!==!!AI_SHORTCUT.ctrlKey
       || !!event.altKey!==!!AI_SHORTCUT.altKey
       || !!event.metaKey!==!!AI_SHORTCUT.metaKey
       || !!event.shiftKey!==!!AI_SHORTCUT.shiftKey) return;
    const target=event.target;
    if(target && typeof target.closest==="function" && target.closest("input,textarea,select,[contenteditable],button,a,[role='button']")) return;
    event.preventDefault();
    begin("ai",event);
  });
  window.addEventListener("message",event=>{
    if(event.source !== window || event.origin !== location.origin) return;
    const message=event.data;
    if(!message || message.channel !== channel || message.from !== "platform") return;
    if(message.type === "state") {state.textContent=String(message.label || "");ready=message.ready===true;controls();}
    if(message.type === "done" && pending && (!message.requestId || message.requestId===pending.id)) {
      clearTimeout(timeout);pending=null;feedback.textContent=String(message.message || "");feedback.style.color=message.error ? "#b22" : "#126b62";
      controls();post({type:"hello"});
    }
    if(message.type !== "request" || !pending || pending.id !== message.requestId || pending.mode !== message.mode || pending.sent) return;
    pending.sent=true;
    const requestId=pending.id;
    try {
      chrome.runtime.sendMessage({type:pending.mode==="ai"?"ANNOTATION_AI":"ANNOTATION_MOCK",image:message.image},response=>{
        const error=chrome.runtime.lastError;
        if(requestId !== pending?.id) return;
        post({type:"result",requestId,response:error?{ok:false,error:"扩展连接已失效，请刷新页面。"}:response});
      });
    } catch {post({type:"result",requestId,response:{ok:false,error:"扩展已更新，请刷新网页。"}});}
  });
  post({type:"hello"});
  // Poll eligibility metadata only; image capture follows a clicked AI request.
  const poll=setInterval(()=>post({type:"hello"}),1000);
  window.addEventListener("pagehide",()=>{clearInterval(poll);clearTimeout(timeout);});
})();
