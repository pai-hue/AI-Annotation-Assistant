"use strict";
// This adapter intentionally runs in MAIN, alongside the site's top-level lexical variables.
// No image upload, final-save call or review workflow is introduced here.
(() => {
  if (location.origin !== "https://www.threetone.com.cn" || !/^\/train\/annotation\/[^/]+\/editor$/.test(location.pathname)) return;
  const channel = "aaa-deepdata-v1";
  let pending = null;
  const post = data => window.postMessage({channel, from:"platform", ...data}, location.origin);
  function snapshot() {
    if (typeof projectName !== "string" || typeof getSortedImages !== "function" ||
        typeof annotations !== "object" || !Array.isArray(classes) || typeof imageCache === "undefined" ||
        typeof imgObj === "undefined" || typeof canvas === "undefined" ||
        [draw,renderRectList,renderImageList,renderClassList,initClassAnnotationCounts].some(fn=>typeof fn !== "function")) throw Error("网站结构不兼容，请停止使用并检查适配代码。");
    if (isPlaying) throw Error("请先暂停播放，并选择一张已加载的原图。");
    const filename = getSortedImages()[currentImageIdx];
    if (!filename) throw Error("请先在原网站选择图片。");
    const image = imageCache.get(filename);
    if (!image || !image.complete || !image.naturalWidth || !imgObj.complete || image.src !== imgObj.src ||
        canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) throw Error("当前原图尚未加载完成，请等待或重新选择图片。");
    if (!classes.length || !classes.every(name=>typeof name === "string" && name.trim()) ||
        !Number.isInteger(currentClassIdx) || currentClassIdx < 0 || currentClassIdx >= classes.length) throw Error("请先在原网站选择一个有效类别。");
    if (annotations[filename] !== undefined && !Array.isArray(annotations[filename])) throw Error("网站标注结构不兼容。");
    if (annotations[filename]?.length) throw Error("当前图片已有标注，插件不会覆盖。请选择空标注图片。");
    return {project:projectName,filename,src:image.src,width:canvas.width,height:canvas.height,
      classId:currentClassIdx,className:classes[currentClassIdx],classes:JSON.stringify(classes)};
  }
  function announce() {
    try {
      const state=snapshot();
      post({type:"state",ready:!pending,busy:!!pending,label:`当前类别：${state.className}（ID ${state.classId}）`});
    } catch(error) { post({type:"state",ready:false,busy:!!pending,label:error.message}); }
  }
  function finish(message, error=false) {
    if (pending) clearTimeout(pending.timer);
    pending=null;
    post({type:"done",message,error});
    announce();
  }
  window.addEventListener("message",event=>{
    if(event.source !== window || event.origin !== location.origin) return;
    const message=event.data;
    if(!message || message.channel !== channel || message.from !== "extension") return;
    if(message.type === "hello") { announce(); return; }
    if(message.type === "begin") {
      if(pending) return;
      if(typeof message.requestId !== "string" || message.requestId.length > 100 || !message.requestId) return;
      try {
        const state=snapshot();
        const image={image_id:message.requestId,image_width:state.width,image_height:state.height};
        pending={state,image,requestId:message.requestId,timer:setTimeout(()=>finish("请求超时，请检查本机服务后重试。",true),30000)};
        announce();
        post({type:"request",requestId:message.requestId,image});
      } catch(error) { finish(error.message,true); }
      return;
    }
    if(message.type !== "result" || !pending || message.requestId !== pending.requestId) return;
    try {
      const current=snapshot();
      if(JSON.stringify(current) !== JSON.stringify(pending.state)) throw Error("图片或类别已变化，本次结果已丢弃。请重新点击。");
      if(message.response?.ok !== true) throw Error(message.response?.error || "本机服务请求失败。");
      const data=message.response.data;
      if(!data || data.source !== "mock" || data.schema_version !== "1.0" || data.image_id !== pending.image.image_id ||
          data.image_width !== current.width || data.image_height !== current.height || !Array.isArray(data.objects) || data.objects.length > 100) throw Error("模拟接口返回格式无效，未写入。");
      const ids=new Set();
      const boxes=data.objects.map(box=>{
        if(!box || typeof box.id !== "string" || !box.id || ids.has(box.id) || box.class_id !== 0 || box.class_name !== "part_A" ||
            ![box.x,box.y,box.width,box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 ||
            box.x+box.width > current.width || box.y+box.height > current.height) throw Error("模拟框坐标或类别无效，未写入。");
        ids.add(box.id);
        // Mock-only remapping: use the site's selected class, never import demo class IDs.
        return {x:box.x,y:box.y,w:box.width,h:box.height,class_id:current.classId,img_w:current.width,img_h:current.height};
      });
      if(!boxes.length) { finish("未生成标注，请在原网站检查。未确认无目标。"); return; }
      const previous=annotations[current.filename];
      const previousSelection=selectedRectIdx;
      try {
        annotations[current.filename]=boxes;
        selectedRectIdx=boxes.length-1;
        initClassAnnotationCounts();renderClassList();draw();renderRectList();renderImageList();
      } catch(error) {
        if(previous === undefined) delete annotations[current.filename]; else annotations[current.filename]=previous;
        selectedRectIdx=previousSelection;
        try {initClassAnnotationCounts();renderClassList();draw();renderRectList();renderImageList();} catch {}
        throw Error("网站刷新失败，已撤回本次写入。请刷新页面检查。");
      }
      finish(`已写入 ${boxes.length} 个模拟框（${current.className}）。请用原网站编辑；网站会自动保存进度。`);
    } catch(error) { finish(error.message,true); }
  });
})();
