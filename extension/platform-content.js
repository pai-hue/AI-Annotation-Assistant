"use strict";
(() => {
  if(location.origin !== "https://www.threetone.com.cn" || !/^\/train\/annotation\/[^/]+\/editor$/.test(location.pathname)) return;
  if(document.getElementById("aaa-platform-panel")) return;
  const channel="aaa-deepdata-v1";
  const host=document.createElement("div");host.id="aaa-platform-panel";
  const shadow=host.attachShadow({mode:"closed"});
  const style=document.createElement("style");
  style.textContent=":host{position:fixed;bottom:18px;left:250px;z-index:9999}@media(max-width:720px){:host{left:12px}}section{position:relative;overflow:auto;font-family:'Segoe UI',sans-serif;font-size:calc(var(--s,1)*13px);line-height:1.5;background:#fff;color:#173c38;border:1px solid #82b6ac;border-radius:calc(var(--s,1)*10px);padding:calc(var(--s,1)*12px) calc(var(--s,1)*16px);width:330px;max-width:calc(100vw - 58px);box-shadow:0 3px 20px #0002}button{font:inherit;background:#126b62;color:white;border:0;border-radius:calc(var(--s,1)*6px);padding:calc(var(--s,1)*8px) calc(var(--s,1)*14px);cursor:pointer;margin-right:calc(var(--s,1)*8px)}button.secondary{background:#e7efed;color:#28534b}button:disabled{opacity:.45;cursor:not-allowed}p{margin:calc(var(--s,1)*6px) 0 0;overflow-wrap:anywhere}label{display:flex;gap:calc(var(--s,1)*6px);margin:calc(var(--s,1)*8px) 0;align-items:flex-start}input{margin-top:calc(var(--s,1)*4px);accent-color:#126b62}.panel-header{cursor:move;user-select:none;touch-action:none;display:flex;align-items:center;justify-content:space-between;gap:calc(var(--s,1)*8px);font-weight:600;color:#126b62;padding-bottom:calc(var(--s,1)*8px);margin-bottom:calc(var(--s,1)*8px);border-bottom:1px solid #e7efed}.grip{color:#82b6ac;font-size:calc(var(--s,1)*12px);letter-spacing:calc(var(--s,1)*2px)}.resize-handle{position:absolute;right:3px;bottom:3px;width:12px;height:12px;cursor:se-resize;touch-action:none;border-right:2px solid #82b6ac;border-bottom:2px solid #82b6ac;border-radius:0 0 3px 0}.class-header{font-weight:600;color:#126b62;margin:calc(var(--s,1)*8px) 0 calc(var(--s,1)*4px)}.class-list{max-height:calc(var(--s,1)*180px);overflow:auto;border:1px solid #e7efed;border-radius:calc(var(--s,1)*6px);padding:calc(var(--s,1)*4px)}.class-item{display:flex;align-items:center;gap:calc(var(--s,1)*8px);padding:calc(var(--s,1)*3px) calc(var(--s,1)*4px);cursor:pointer;user-select:none}.class-item:hover{background:#f4faf8}.class-box{flex:none;width:calc(var(--s,1)*12px);height:calc(var(--s,1)*12px);border:calc(var(--s,1)*2px) solid #2563eb;border-radius:calc(var(--s,1)*2px);box-sizing:border-box}.class-box.on{background:#2563eb}.class-name{overflow-wrap:anywhere}";
  const panel=document.createElement("section");
  const header=document.createElement("div");header.className="panel-header";header.title="拖动标题栏可移动面板";
  const headerTitle=document.createElement("span");headerTitle.textContent="AI 预标注";
  const grip=document.createElement("span");grip.className="grip";grip.textContent="⠿";
  header.append(headerTitle,grip);
  const AI_SHORTCUT={key:"Enter",ctrlKey:false,altKey:false,metaKey:false,shiftKey:false};
  const aiButton=document.createElement("button");aiButton.textContent="预标注";aiButton.disabled=true;aiButton.title="快捷键 Enter";
  const mockButton=document.createElement("button");mockButton.textContent="模拟测试";mockButton.className="secondary";mockButton.disabled=true;
  const refButton=document.createElement("button");refButton.textContent="采集示例";refButton.className="secondary";refButton.disabled=true;refButton.title="框选图片中的区域，设为当前所选类别的示例图";
  const consentLabel=document.createElement("label");
  const consent=document.createElement("input");consent.type="checkbox";
  const consentText=document.createElement("span");consentText.textContent="允许将当前图片、示例图及项目类别发送到阿里云百炼";
  consentLabel.append(consent,consentText);
  const classHeader=document.createElement("div");classHeader.className="class-header";classHeader.textContent="识别类别（点击方块切换）";
  const classList=document.createElement("div");classList.className="class-list";classList.setAttribute("role","group");
  const state=document.createElement("p");state.textContent="正在连接原网站标注器…";
  const feedback=document.createElement("p");feedback.setAttribute("role","status");
  const resize=document.createElement("div");resize.className="resize-handle";resize.title="拖动调整面板大小";
  panel.append(header,aiButton,mockButton,refButton,consentLabel,classHeader,classList,state,feedback,resize);shadow.append(style,panel);document.body.append(host);
  let pending=null,timeout=null,ready=false,cropping=null;
  let classEnabled=new Map(),classSig=null;
  const post=data=>window.postMessage({channel,from:"extension",...data},location.origin);
  function controls() {
    const locked=!!pending || !!cropping;
    const noneEnabled=classEnabled.size>0 && ![...classEnabled.values()].some(Boolean);
    mockButton.disabled=locked || !ready;
    refButton.disabled=locked || !ready;
    aiButton.disabled=locked || !ready || !consent.checked || noneEnabled;
    consent.disabled=locked;
  }
  function renderClasses(list) {
    if(!Array.isArray(list)) return;
    const sig=JSON.stringify(list);
    if(sig===classSig) return;
    classSig=sig;
    classEnabled=new Map(list.map(c=>[c.id,true]));
    classList.replaceChildren();
    list.forEach(c=>{
      const item=document.createElement("div");item.className="class-item";
      const box=document.createElement("span");box.className="class-box on";box.setAttribute("role","checkbox");box.setAttribute("aria-checked","true");
      const name=document.createElement("span");name.className="class-name";name.textContent=c.name;
      item.append(box,name);
      item.addEventListener("click",()=>{
        const on=!classEnabled.get(c.id);
        classEnabled.set(c.id,on);
        box.className="class-box"+(on?" on":"");
        box.setAttribute("aria-checked",String(on));
        controls();
      });
      classList.append(item);
    });
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
  function begin(mode,event,crop) {
    // Page bridge messages alone cannot initiate a paid request.
    if(event.isTrusted!==true || pending || !ready || (mode==="ai" && !consent.checked)) return;
    let enabledClassIds;
    if(mode==="ai") {
      enabledClassIds=[...classEnabled.entries()].filter(([,on])=>on).map(([id])=>id);
      if(!enabledClassIds.length) { feedback.style.color="#b22"; feedback.textContent="请至少选择一个要识别的类别。"; return; }
    }
    pending={id:crypto.randomUUID(),mode,sent:false};controls();
    feedback.style.color="#126b62";
    feedback.textContent=mode==="ai" ? "千问正在生成初始框，请保持当前图片和类别不变…" : mode==="reference" ? "正在保存示例图…" : "正在请求本机模拟服务…";
    timeout=setTimeout(()=>{pending=null;feedback.textContent="连接超时，请刷新网页后重试。";controls();post({type:"hello"});},32000);
    post({type:"begin",requestId:pending.id,mode,crop,...(enabledClassIds?{enabledClassIds}:{})});
  }
  function startCrop(event) {
    if(event.isTrusted!==true || pending || cropping || !ready) return;
    const canvas=document.querySelector("#editorCanvas");
    if(!canvas || typeof canvas.getBoundingClientRect!=="function" || !canvas.width || !canvas.height){
      feedback.textContent="未找到原网站画布，无法框选示例区域。";feedback.style.color="#b22";return;
    }
    const rect=canvas.getBoundingClientRect();
    if(rect.width<=0 || rect.height<=0){feedback.textContent="画布尺寸异常，无法框选。";feedback.style.color="#b22";return;}
    cropping={canvas,rect};
    controls();
    const shield=document.createElement("div");shield.id="aaa-crop-overlay";
    shield.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:100000";
    const view=document.createElement("div");view.id="aaa-crop-view";
    view.style.cssText="position:fixed;box-sizing:border-box;border:2px dashed #fff;touch-action:none";
    view.style.left=rect.left+"px";view.style.top=rect.top+"px";view.style.width=rect.width+"px";view.style.height=rect.height+"px";
    const sel=document.createElement("div");sel.id="aaa-crop-sel";
    sel.style.cssText="position:absolute;display:none;box-sizing:border-box;background:rgba(18,107,98,.3);border:2px solid #126b62";
    const bar=document.createElement("div");
    bar.style.cssText="position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:100001;display:flex;gap:8px;align-items:center;background:#fff;color:#173c38;padding:8px 12px;border-radius:8px;font-family:'Segoe UI',sans-serif;font-size:13px;box-shadow:0 3px 20px #0003";
    const hint=document.createElement("span");hint.textContent="拖动框选要采集的示例区域（保存为当前所选类别）";
    const ok=document.createElement("button");ok.textContent="确认";ok.disabled=true;
    ok.style.cssText="font:13px 'Segoe UI',sans-serif;background:#126b62;color:#fff;border:0;border-radius:6px;padding:6px 14px;cursor:pointer";
    const cancel=document.createElement("button");cancel.textContent="取消";
    cancel.style.cssText=ok.style.cssText+";background:#e7efed;color:#28534b";
    bar.append(hint,ok,cancel);view.append(sel);shield.append(view,bar);document.body.append(shield);
    let drag=null,selRect=null;
    function close(){shield.remove();cropping=null;controls();}
    view.addEventListener("pointerdown",e=>{
      if(e.button!==0) return;
      e.preventDefault();e.stopPropagation();
      const r=canvas.getBoundingClientRect();
      view.style.left=r.left+"px";view.style.top=r.top+"px";view.style.width=r.width+"px";view.style.height=r.height+"px";
      cropping.rect=r;
      drag={startX:e.clientX,startY:e.clientY,left:r.left,top:r.top,width:r.width,height:r.height};
      view.setPointerCapture(e.pointerId);
    });
    view.addEventListener("pointermove",e=>{
      if(!drag) return;
      const x1=Math.min(drag.startX,e.clientX)-drag.left, y1=Math.min(drag.startY,e.clientY)-drag.top;
      const x2=Math.max(drag.startX,e.clientX)-drag.left, y2=Math.max(drag.startY,e.clientY)-drag.top;
      const left=Math.max(0,x1), top=Math.max(0,y1), right=Math.min(drag.width,x2), bottom=Math.min(drag.height,y2);
      if(right-left<1 || bottom-top<1){sel.style.display="none";selRect=null;ok.disabled=true;return;}
      selRect={left,top,right,bottom};
      sel.style.display="block";sel.style.left=left+"px";sel.style.top=top+"px";
      sel.style.width=(right-left)+"px";sel.style.height=(bottom-top)+"px";ok.disabled=false;
    });
    view.addEventListener("pointerup",()=>{drag=null;});
    view.addEventListener("pointercancel",()=>{drag=null;});
    cancel.addEventListener("click",()=>close());
    ok.addEventListener("click",e=>{
      if(!selRect) return;
      const sx=canvas.width/cropping.rect.width, sy=canvas.height/cropping.rect.height;
      const crop={x:Math.round(selRect.left*sx),y:Math.round(selRect.top*sy),
        width:Math.round((selRect.right-selRect.left)*sx),height:Math.round((selRect.bottom-selRect.top)*sy)};
      close();
      begin("reference",e,crop);
    });
  }
  mockButton.addEventListener("click",event=>begin("mock",event));
  refButton.addEventListener("click",event=>startCrop(event));
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
    if(message.type === "state") {state.textContent=String(message.label || "");ready=message.ready===true;renderClasses(message.classes);controls();}
    if(message.type === "done" && pending && (!message.requestId || message.requestId===pending.id)) {
      clearTimeout(timeout);pending=null;feedback.textContent=String(message.message || "");feedback.style.color=message.error ? "#b22" : "#126b62";
      controls();post({type:"hello"});
    }
    if(message.type !== "request" || !pending || pending.id !== message.requestId || pending.mode !== message.mode || pending.sent) return;
    pending.sent=true;
    const requestId=pending.id;
    try {
      const msgType=pending.mode==="ai"?"ANNOTATION_AI":pending.mode==="reference"?"REFERENCE_CAPTURE":"ANNOTATION_MOCK";
      chrome.runtime.sendMessage({type:msgType,image:message.image},response=>{
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
