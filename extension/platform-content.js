"use strict";
(() => {
  if(location.origin !== "https://www.threetone.com.cn" || !/^\/train\/annotation\/[^/]+\/editor$/.test(location.pathname)) return;
  if(document.getElementById("aaa-platform-panel")) return;
  const channel="aaa-deepdata-v1";
  const host=document.createElement("div");host.id="aaa-platform-panel";
  const shadow=host.attachShadow({mode:"closed"});
  const style=document.createElement("style");
  style.textContent=":host{position:fixed;bottom:18px;left:250px;z-index:9999}section{font:13px/1.5 'Segoe UI',sans-serif;background:#fff;color:#173c38;border:1px solid #82b6ac;border-radius:10px;padding:12px 16px;width:330px;box-shadow:0 3px 20px #0002}button{background:#126b62;color:white;border:0;border-radius:6px;padding:8px 14px;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}p{margin:6px 0 0;overflow-wrap:anywhere}small{color:#626f6d}";
  const panel=document.createElement("section");
  const button=document.createElement("button");button.textContent="插件：写入模拟初始框";button.disabled=true;
  const state=document.createElement("p");state.textContent="正在连接原网站标注器…";
  const feedback=document.createElement("p");feedback.setAttribute("role","status");
  const note=document.createElement("small");note.textContent="仅模拟，未接入 AI。不上传图片；写入后原网站会自动保存进度。";
  panel.append(button,state,feedback,note);shadow.append(style,panel);document.body.append(host);
  let pending=null;
  const post=data=>window.postMessage({channel,from:"extension",...data},location.origin);
  let timeout=null;
  button.addEventListener("click",()=>{
    if(button.disabled || pending) return;
    pending=crypto.randomUUID();button.disabled=true;feedback.textContent="正在请求本机模拟服务…";
    timeout=setTimeout(()=>{pending=null;feedback.textContent="连接超时，请刷新网页后重试。";post({type:"hello"});},32000);
    post({type:"begin",requestId:pending});
  });
  window.addEventListener("message",event=>{
    if(event.source !== window || event.origin !== location.origin) return;
    const message=event.data;
    if(!message || message.channel !== channel || message.from !== "platform") return;
    if(message.type === "state") {state.textContent=String(message.label || "");button.disabled=!!pending || message.ready !== true;}
    if(message.type === "done") {
      clearTimeout(timeout);pending=null;feedback.textContent=String(message.message || "");feedback.style.color=message.error ? "#b22" : "#126b62";
      post({type:"hello"});
    }
    if(message.type !== "request" || !pending || pending !== message.requestId) return;
    const requestId=pending;
    try {
      chrome.runtime.sendMessage({type:"ANNOTATION_MOCK",image:message.image},response=>{
        const error=chrome.runtime.lastError;
        if(requestId !== pending) return;
        post({type:"result",requestId,response:error?{ok:false,error:"扩展连接已失效，请刷新页面。"}:response});
      });
    } catch {post({type:"result",requestId,response:{ok:false,error:"扩展已更新，请刷新网页。"}});}
  });
  post({type:"hello"});
  // Poll only eligibility metadata, never image bytes or annotations.
  const poll=setInterval(()=>post({type:"hello"}),1000);
  window.addEventListener("pagehide",()=>{clearInterval(poll);clearTimeout(timeout);});
})();
