"use strict";
const ui = Object.fromEntries(["select-mode", "draw-mode", "category", "delete-box", "review", "review-state", "box-list", "coordinates", "box-x", "box-y", "box-width", "box-height", "apply-box", "export-json", "export-yolo", "export-classes"].map(id => [id, document.getElementById(id)]));
let selectedId = null;
let mode = "select";
let reviewed = false;
let dirty = false;
let gesture = null;
const selectedBox = () => objects.find(box => box.id === selectedId);
const editingBlocked = () => !current || !!controller || !!extensionRequest;
for (const item of ANNOTATION_CLASSES) {
  const option = document.createElement("option");
  option.value = String(item.id);
  option.textContent = `${item.id} · ${item.name}`;
  ui.category.append(option);
}
function resetEditor() {
  selectedId = null; reviewed = false; dirty = false; gesture = null;
  redraw();
}
function markEdited() {
  reviewed = false; dirty = true;
  redraw(); controls();
}
function editorControls(busy) {
  const blocked = !current || busy;
  for (const key of ["select-mode", "draw-mode", "category", "review"]) ui[key].disabled = blocked;
  ui["delete-box"].disabled = blocked || !selectedBox();
  ui.coordinates.disabled = blocked || !selectedBox();
  for (const row of ui["box-list"].children) row.disabled = blocked;
  for (const key of ["export-json", "export-yolo", "export-classes"]) ui[key].disabled = blocked || !reviewed;
  el.clear.disabled = blocked || objects.length === 0;
  ui["review-state"].textContent = reviewed ? "已确认审核" : "待审核";
  ui["select-mode"].setAttribute("aria-pressed", String(mode === "select"));
  ui["draw-mode"].setAttribute("aria-pressed", String(mode === "draw"));
  el.overlay.style.cursor = mode === "draw" ? "crosshair" : "default";
}
function documentData() {
  const sources = new Set(objects.map(box => box.source));
  return {schema_version: "1.0", ...current, image_name: imageName,
    source: sources.size > 1 ? "mixed" : (sources.values().next().value || "manual"),
    classes: ANNOTATION_CLASSES, objects: objects.map(box => ({...box})),
    review_status: reviewed ? "confirmed" : "pending"};
}
function svgNode(tag, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
function redraw() {
  const nodes = [];
  const rows = [];
  const screenWidth = el.overlay.getBoundingClientRect().width || current?.image_width || 1;
  const scale = (current?.image_width || 1) / screenWidth;
  for (const box of objects) {
    const selected = box.id === selectedId;
    const rect = svgNode("rect", {x: box.x, y: box.y, width: box.width, height: box.height,
      fill: selected ? "#efa52d33" : "#22b78822", stroke: selected ? "#bd6900" : "#078656",
      "stroke-width": 2, "vector-effect": "non-scaling-stroke", "data-id": box.id});
    const group = svgNode("g", {});
    group.append(rect);
    const label = svgNode("text", {x: box.x, y: Math.max(12 * scale, box.y - 4 * scale),
      "font-size": 12 * scale, fill: "#164137", "pointer-events": "none"});
    label.textContent = box.class_name;
    group.append(label);
    if (selected) {
      for (const [corner, x, y] of [["nw",box.x,box.y],["ne",box.x+box.width,box.y],["sw",box.x,box.y+box.height],["se",box.x+box.width,box.y+box.height]]) {
        group.append(svgNode("rect", {x:x-5*scale, y:y-5*scale, width:10*scale, height:10*scale,
          fill:"#ffb649", stroke:"#713d00", "stroke-width":1, "vector-effect":"non-scaling-stroke",
          "data-id":box.id, "data-corner":corner, style:`cursor:${corner === "nw" || corner === "se" ? "nwse" : "nesw"}-resize`}));
      }
    }
    nodes.push(group);
    const row = document.createElement("button");
    row.className = "box-row secondary";
    row.textContent = `${rows.length + 1}. ${box.class_name} · ${box.source === "mock" ? "模拟" : "手动"}${box.edited ? " / 已修改" : ""}`;
    row.setAttribute("aria-pressed", String(selected));
    row.disabled = editingBlocked() || !!gesture;
    row.addEventListener("click", () => { if (editingBlocked() || gesture) return; selectedId = box.id; mode = "select"; redraw(); controls(); });
    rows.push(row);
  }
  el.overlay.replaceChildren(...nodes);
  ui["box-list"].replaceChildren(...rows);
  const box = selectedBox();
  for (const key of ["x", "y", "width", "height"]) ui[`box-${key}`].value = box ? String(box[key]) : "";
  if (box) ui.category.value = String(box.class_id);
  el.count.textContent = `${objects.length} 个框 · ${reviewed ? "已确认审核" : "待人工审核"}`;
  el.result.textContent = current ? JSON.stringify(documentData(), null, 2) : "暂无结果";
}
for (const value of ["select", "draw"]) ui[`${value}-mode`].addEventListener("click", () => {
  if (editingBlocked() || gesture) return;
  mode = value; if (mode === "draw") selectedId = null;
  redraw(); controls();
  status(mode === "draw" ? "在图片上拖动画框；类别使用当前下拉选项。" : "点击框选中，拖动移动，拖动角点调整大小。");
});
ui.category.addEventListener("change", () => {
  if (editingBlocked() || gesture) return;
  const box = selectedBox();
  const item = ANNOTATION_CLASSES.find(item => String(item.id) === ui.category.value);
  if (box && item && box.class_id !== item.id) { Object.assign(box, {class_id:item.id, class_name:item.name, edited:true}); markEdited(); }
});
ui["delete-box"].addEventListener("click", () => {
  if (editingBlocked() || gesture || !selectedBox()) return;
  objects = objects.filter(box => box.id !== selectedId); selectedId = null; markEdited();
  status("已删除选中框，请重新审核。");
});
function validBox(box) {
  return [box.x,box.y,box.width,box.height].every(Number.isFinite) && box.x >= 0 && box.y >= 0 &&
    box.width > 0 && box.height > 0 && box.x + box.width <= current.image_width + 1e-8 &&
    box.y + box.height <= current.image_height + 1e-8 &&
    ANNOTATION_CLASSES.some(item => item.id === box.class_id && item.name === box.class_name);
}
ui["apply-box"].addEventListener("click", () => {
  if (editingBlocked() || gesture || !selectedBox()) return;
  const box = {...selectedBox()};
  for (const key of ["x", "y", "width", "height"]) box[key] = ui[`box-${key}`].value.trim() === "" ? NaN : Number(ui[`box-${key}`].value);
  if (!validBox(box)) { status("坐标无效：宽高须大于 0，框不能超出图片。", true); return; }
  Object.assign(selectedBox(), box, {edited:true}); markEdited(); status("坐标已更新，请重新审核。");
});
function point(event) {
  const rect = el.overlay.getBoundingClientRect();
  return {x:Math.max(0,Math.min(current.image_width,(event.clientX-rect.left)/rect.width*current.image_width)),
    y:Math.max(0,Math.min(current.image_height,(event.clientY-rect.top)/rect.height*current.image_height))};
}
el.overlay.addEventListener("pointerdown", event => {
  if (event.button !== 0 || editingBlocked() || gesture) return;
  event.preventDefault();
  const start = point(event);
  const id = event.target.getAttribute("data-id");
  const box = objects.find(box => box.id === id);
  const before = objects.map(box => ({...box}));
  const previous = {reviewed, dirty};
  if (mode === "draw") {
    const item = ANNOTATION_CLASSES.find(item => String(item.id) === ui.category.value) || ANNOTATION_CLASSES[0];
    selectedId = crypto.randomUUID();
    objects.push({id:selectedId,class_id:item.id,class_name:item.name,x:start.x,y:start.y,width:0,height:0,source:"manual",edited:false});
    gesture = {kind:"draw",start,before,previous};
  } else if (box) {
    selectedId = id;
    gesture = {kind:event.target.getAttribute("data-corner") || "move",start,original:{...box},before,previous};
  } else { selectedId = null; redraw(); controls(); return; }
  gesture.pointerId = event.pointerId;
  el.overlay.setPointerCapture(event.pointerId);
  redraw(); controls();
});
el.overlay.addEventListener("pointermove", event => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const p = point(event), box = selectedBox(), g = gesture;
  if (g.kind === "draw") {
    Object.assign(box,{x:Math.min(g.start.x,p.x),y:Math.min(g.start.y,p.y),width:Math.abs(p.x-g.start.x),height:Math.abs(p.y-g.start.y)});
  } else if (g.kind === "move") {
    box.x = Math.max(0,Math.min(current.image_width-box.width,g.original.x+p.x-g.start.x));
    box.y = Math.max(0,Math.min(current.image_height-box.height,g.original.y+p.y-g.start.y));
  } else {
    const x = g.kind.includes("w") ? g.original.x+g.original.width : g.original.x;
    const y = g.kind.includes("n") ? g.original.y+g.original.height : g.original.y;
    Object.assign(box,{x:Math.min(x,p.x),y:Math.min(y,p.y),width:Math.abs(x-p.x),height:Math.abs(y-p.y)});
  }
  reviewed = false;
  redraw();
});
function finishGesture(event, cancel = false) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const g = gesture, box = selectedBox(); gesture = null;
  if (el.overlay.hasPointerCapture(event.pointerId)) el.overlay.releasePointerCapture(event.pointerId);
  const changed = JSON.stringify(objects) !== JSON.stringify(g.before);
  if (cancel || !box || !validBox(box) || !changed) {
    objects = g.before; reviewed = g.previous.reviewed; dirty = g.previous.dirty;
    if (!selectedBox()) selectedId = null;
    redraw(); controls(); return;
  }
  if (g.kind !== "draw") box.edited = true;
  markEdited(); status("标注已修改，请完成整图审核。");
}
el.overlay.addEventListener("pointerup", event => finishGesture(event));
el.overlay.addEventListener("pointercancel", event => finishGesture(event, true));
el.overlay.addEventListener("lostpointercapture", event => finishGesture(event, true));
ui.review.addEventListener("click", () => {
  if (editingBlocked() || gesture) return;
  if (!objects.every(validBox)) { status("存在无效标注，请修正后审核。", true); return; }
  reviewed = true; dirty = true; redraw(); controls();
  status(objects.length ? "整图审核已确认，可以导出。" : "已确认图片无目标，可以导出空标注。");
});
function yoloText() {
  return objects.map(box => [box.class_id,(box.x+box.width/2)/current.image_width,(box.y+box.height/2)/current.image_height,box.width/current.image_width,box.height/current.image_height].join(" ")).join("\n") + (objects.length ? "\n" : "");
}
function exportText(kind) {
  if (editingBlocked() || gesture || !reviewed || !objects.every(validBox)) return;
  const base = imageName.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g,"_") || "image";
  const text = kind === "json" ? JSON.stringify(documentData(),null,2) : kind === "yolo" ? yoloText() : ANNOTATION_CLASSES.map(item=>item.name).join("\n")+"\n";
  const name = kind === "classes" ? "classes.txt" : `${base}.${kind === "json" ? "json" : "txt"}`;
  const url = URL.createObjectURL(new Blob([text],{type:kind === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8"}));
  const link = document.createElement("a"); link.href=url; link.download=name; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  if (kind !== "classes") dirty = false;
  status(`已发起下载 ${name}，请在浏览器下载记录中确认保存完成。`);
}
for (const kind of ["json","yolo","classes"]) ui[`export-${kind}`].addEventListener("click",()=>exportText(kind));
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue=""; } });
window.addEventListener("resize", () => { if (!gesture) redraw(); });
controls();
