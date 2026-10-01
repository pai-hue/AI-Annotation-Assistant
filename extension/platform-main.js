"use strict";
// This adapter intentionally runs in MAIN, alongside the site's top-level lexical variables.
// Initial annotations only. Review and saving remain the site's responsibility.
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
      post({type:"state",ready:!pending,busy:!!pending,label:`模拟类别：${state.className}；AI 使用项目全部 ${classes.length} 个类别。`});
    } catch(error) { post({type:"state",ready:false,busy:!!pending,label:error.message}); }
  }
  function finish(message, error=false) {
    const requestId=pending?.requestId;
    if (pending) clearTimeout(pending.timer);
    pending=null;
    post({type:"done",requestId,message,error});
    announce();
  }
  function captureImage(state, maxSide=1600, crop) {
    if(classes.length>100 || classes.some(name=>name.length>100)) throw Error("目前支持最多 100 个类别，每个类别名最多 100 字符。");
    // Read the original cached image, never the editor canvas with annotation overlays.
    const image=imageCache.get(state.filename);
    const sw=crop ? crop.width : state.width;
    const sh=crop ? crop.height : state.height;
    const sx=crop ? crop.x : 0;
    const sy=crop ? crop.y : 0;
    const ratio=Math.min(1,maxSide/Math.max(sw,sh));
    const capture=document.createElement("canvas");
    capture.width=Math.max(1,Math.round(sw*ratio));
    capture.height=Math.max(1,Math.round(sh*ratio));
    const context=capture.getContext("2d");
    if(!context) throw Error("无法读取图片，请刷新网页后重试。");
    context.fillStyle="#fff";context.fillRect(0,0,capture.width,capture.height);
    context.drawImage(image,sx,sy,sw,sh,0,0,capture.width,capture.height);
    let encoded;
    try {encoded=capture.toDataURL("image/jpeg",0.85);} catch {throw Error("原网站限制了图片读取，暂时无法发送此图片。");}
    if(!encoded.startsWith("data:image/jpeg;base64,") || encoded.length>2796236) throw Error("图片编码失败或超过 2 MiB，请改用较小测试图片。");
    return {input_width:capture.width,input_height:capture.height,image_data_url:encoded,
      classes:classes.map((name,id)=>({id,name}))};
  }
  window.addEventListener("message",event=>{
    if(event.source !== window || event.origin !== location.origin) return;
    const message=event.data;
    if(!message || message.channel !== channel || message.from !== "extension") return;
    if(message.type === "hello") { announce(); return; }
    if(message.type === "begin") {
      if(pending) return;
      if(typeof message.requestId !== "string" || message.requestId.length > 100 || !message.requestId) return;
      const mode=message.mode || "mock";
      if(!["mock","ai","reference"].includes(mode)) return;
      try {
        const state=snapshot();
        const image={image_id:message.requestId,image_width:state.width,image_height:state.height};
        pending={state,image,mode,requestId:message.requestId,timer:setTimeout(()=>finish("请求超时，请检查本机服务后重试。",true),30000)};
        announce();
        let payload;
        if(mode==="ai") payload={...image,...captureImage(state)};
        else if(mode==="reference") {
          const c=message.crop;
          if(!c || ![c.x,c.y,c.width,c.height].every(Number.isFinite) || c.x<0 || c.y<0 || c.width<=0 || c.height<=0 ||
             c.x+c.width>state.width || c.y+c.height>state.height) throw Error("请先在图片上框选要采集的示例区域。");
          payload={...image,...captureImage(state,640,{x:c.x,y:c.y,width:c.width,height:c.height}),class_id:state.classId,class_name:state.className};
        } else payload=image;
        post({type:"request",requestId:message.requestId,mode,image:payload});
      } catch(error) { finish(error.message,true); }
      return;
    }
    if(message.type !== "result" || !pending || message.requestId !== pending.requestId) return;
    if(pending.mode === "reference") {
      if(message.response?.ok !== true) { finish(message.response?.error || "保存示例失败，请重试。", true); }
      else { finish(`已保存「${pending.state.className}」的示例图，后续 AI 预标注会自动带上。`); }
      return;
    }
    try {
      const current=snapshot();
      if(JSON.stringify(current) !== JSON.stringify(pending.state)) throw Error("图片或类别已变化，本次结果已丢弃。请重新点击。");
      if(message.response?.ok !== true) throw Error(message.response?.error || "本机服务请求失败。");
      const data=message.response.data;
      const ai=pending.mode==="ai";
      if(!data || data.source !== (ai ? "qwen" : "mock") || data.schema_version !== "1.0" || data.image_id !== pending.image.image_id ||
          data.image_width !== current.width || data.image_height !== current.height || !Array.isArray(data.objects) || data.objects.length > 100) throw Error("接口返回格式无效，未写入。");
      const ids=new Set();
      const boxes=data.objects.map(box=>{
        const validClass=box && (ai ? Number.isInteger(box.class_id) && box.class_id>=0 && box.class_id<classes.length && box.class_name===classes[box.class_id] : box.class_id===0 && box.class_name==="part_A");
        if(!box || typeof box.id !== "string" || !box.id || ids.has(box.id) || !validClass ||
            ![box.x,box.y,box.width,box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 ||
            box.x+box.width > current.width || box.y+box.height > current.height) throw Error("标注框坐标或类别无效，未写入。");
        ids.add(box.id);
        // Mock-only remapping: use the site's selected class, never import demo class IDs.
        return {x:box.x,y:box.y,w:box.width,h:box.height,class_id:ai?box.class_id:current.classId,img_w:current.width,img_h:current.height};
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
      finish(`已写入 ${boxes.length} 个${ai?"AI 初始框":"模拟框（"+current.className+"）"}。请用原网站审核和修改；网站会自动保存进度。`);
    } catch(error) { finish(error.message,true); }
  });
})();
