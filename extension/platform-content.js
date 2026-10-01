"use strict";
(() => {
  if(location.origin !== "https://www.threetone.com.cn" || !/^\/train\/annotation\/[^/]+\/editor$/.test(location.pathname)) return;
  if(document.getElementById("aaa-platform-panel")) return;
  const channel="aaa-deepdata-v1";
  const host=document.createElement("div");host.id="aaa-platform-panel";
  const shadow=host.attachShadow({mode:"closed"});
  const style=document.createElement("style");
  style.textContent=":host{position:fixed;bottom:18px;left:250px;z-index:9999}@media(max-width:720px){:host{left:12px}}section{font:13px/1.5 'Segoe UI',sans-serif;background:#fff;color:#173c38;border:1px solid #82b6ac;border-radius:10px;padding:12px 16px;width:330px;max-width:calc(100vw - 58px);box-shadow:0 3px 20px #0002}button{background:#126b62;color:white;border:0;border-radius:6px;padding:8px 14px;cursor:pointer;margin-right:8px}button.secondary{background:#e7efed;color:#28534b}button:disabled{opacity:.45;cursor:not-allowed}p{margin:6px 0 0;overflow-wrap:anywhere}small{color:#626f6d}label{display:flex;gap:6px;margin:8px 0;align-items:flex-start}input{margin-top:4px;accent-color:#126b62}";
  const panel=document.createElement("section");
  const aiButton=document.createElement("button");aiButton.textContent="千问预标注";aiButton.disabled=true;
  const mockButton=document.createElement("button");mockButton.textContent="模拟测试";mockButton.className="secondary";mockButton.disabled=true;
  const consentLabel=document.createElement("label");
  const consent=document.createElement("input");consent.type="checkbox";
  const consentText=document.createElement("span");consentText.textContent="允许将当前图片及项目类别发送到阿里云百炼（通义千问，按用量计费）";
  consentLabel.append(consent,consentText);
  const state=document.createElement("p");state.textContent="正在连接原网站标注器…";
  const feedback=document.createElement("p");feedback.setAttribute("role","status");
  const note=document.createElement("small");note.textContent="仅生成初始框，审核与修改在原网站完成；网站会自动保存进度。模拟测试不发送图片。";
  panel.append(aiButton,mockButton,consentLabel,state,feedback,note);shadow.append(style,panel);document.body.append(host);
  let pending=null,timeout=null,ready=false;
  const post=data=>window.postMessage({channel,from:"extension",...data},location.origin);
  function controls() {
    mockButton.disabled=!!pending || !ready;
    aiButton.disabled=!!pending || !ready || !consent.checked;
    consent.disabled=!!pending;
  }
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
