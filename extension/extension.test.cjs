// Node's built-in runner; browser globals are simulated, not a real Edge session.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const sender = {id: 'test-extension', frameId: 0, url: 'http://127.0.0.1:8000/demo/'};
const image = {image_id:'test-image', image_width:1000, image_height:800};
const result = () => ({schema_version:'1.0', ...image, source:'mock', review_status:'pending', objects:[{id:'box-1', class_id:0, class_name:'part_A', x:100, y:80, width:200, height:160}]});
function backend(fetchImpl) {
  let listener;
  const context = vm.createContext({URL, AbortController, setTimeout, clearTimeout, fetch:fetchImpl,
    chrome:{runtime:{id:sender.id, onMessage:{addListener(fn){listener=fn;}}}}});
  vm.runInContext(read('background.js'), context);
  return (message, source=sender) => new Promise(resolve => listener(message, source, resolve));
}
test('background sends only approved metadata to fixed API', async () => {
  let captured;
  const send=backend(async (url, options) => {captured={url, options};return {ok:true,json:async()=>result()};});
  const reply=await send({type:'ANNOTATION_MOCK',image:{...image,url:'https://untrusted.example'}});
  assert.equal(reply.ok,true);
  assert.equal(captured.url,'http://127.0.0.1:8000/api/annotations/mock');
  assert.deepEqual(JSON.parse(captured.options.body),image);
  assert.equal(captured.options.redirect,'error');
});
test('background rejects unrelated origins, ports, frames and invalid dimensions',async()=>{
  let calls=0;
  const send=backend(async()=>{calls++;throw Error('must not fetch');});
  for(const source of [{...sender,url:'https://example.com/demo/'},{...sender,url:'http://127.0.0.1:9000/demo/'},{...sender,frameId:1},{...sender,id:'other'}]) {
    assert.equal((await send({type:'ANNOTATION_MOCK',image},source)).ok,false);
  }
  for(const n of [0,-1,'100',true,1.2,1000001]) assert.equal((await send({type:'ANNOTATION_MOCK',image:{...image,image_width:n}})).ok,false);
  assert.equal(calls,0);
});
test('network failure and HTTP errors produce retryable responses',async()=>{
  for(const fetchImpl of [async()=>{throw Error('offline');},async()=>({ok:false,status:500})]) {
    assert.equal((await backend(fetchImpl)({type:'ANNOTATION_MOCK',image})).ok,false);
  }
});
function element() {
  return {disabled:false,hidden:false,dataset:{},style:{},children:[],listeners:{},textContent:'',
    value:'',getBoundingClientRect(){return {left:0,top:0,width:1000,height:800};},
    setPointerCapture(){},hasPointerCapture(){return false;},releasePointerCapture(){},
    addEventListener(type, fn){this.listeners[type]=fn;},
    replaceChildren(...nodes){this.children=nodes;},append(node){this.children.push(node);},
    setAttribute(name,value){this[name]=String(value);},removeAttribute(name){delete this[name];}};
}
function page(fetchImpl) {
  const elements = Object.fromEntries(['file','generate','clear','status','empty','stage','preview','overlay','metadata','count','result','extension-status','select-mode','draw-mode','category','delete-box','review','review-state','box-list','coordinates','box-x','box-y','box-width','box-height','apply-box','export-json','export-yolo','export-classes'].map(id=>[id,element()]));
  const toolbar=element();
  const listeners=[];
  const window={addEventListener(type,fn){if(type==='message')listeners.push(fn);},
    postMessage(data){queueMicrotask(()=>listeners.forEach(fn=>fn({source:window,origin:'http://127.0.0.1:8000',data})));}};
  const send=backend(fetchImpl);
  const context=vm.createContext({window,location:{origin:'http://127.0.0.1:8000',pathname:'/demo/'},
    document:{getElementById:id=>elements[id],querySelector:()=>toolbar,createElement:()=>element(),createElementNS:()=>element()},
    crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,AbortController,
    chrome:{runtime:{sendMessage(message,callback){send(message).then(callback);}}}});
  vm.runInContext(read('../server/demo/app.js'),context);
  vm.runInContext(read('../server/demo/classes.js'),context);
  vm.runInContext(read('../server/demo/editor.js'),context);
  vm.runInContext(read('content.js'),context);
  vm.runInContext(`current = ${JSON.stringify(image)}; controls();`,context);
  return {elements,button:toolbar.children[0],context};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('page-content-background roundtrip renders once and clear permits retry',async()=>{
  let calls=0;
  const p=page(async()=>{calls++;return {ok:true,json:async()=>result()};});
  await flush();
  assert.equal(p.button.disabled,false);
  p.button.listeners.click();
  p.button.listeners.click();
  await flush();
  assert.equal(calls,1);
  assert.equal(p.elements.overlay.children.length,1);
  assert.equal(p.elements['box-list'].children[0].disabled,false);
  assert.equal(p.button.disabled,true);
  assert.equal(p.elements.generate.disabled,true);
  assert.equal(JSON.parse(p.elements.result.textContent).objects[0].x,100);
  p.elements.clear.listeners.click();
  await flush();
  assert.equal(p.button.disabled,false);
  assert.equal(p.elements.overlay.children.length,0);
});
test('malformed model response is rejected and controls recover',async()=>{
  const bad=result();bad.objects[0].width=2000;
  const p=page(async()=>({ok:true,json:async()=>bad}));
  await flush();p.button.listeners.click();await flush();
  assert.equal(p.elements.overlay.children.length,0);
  assert.equal(p.elements.status.dataset.error,'true');
  assert.equal(p.button.disabled,false);
});
test('late response after image switch cannot change annotations',async()=>{
  let resolveFetch;
  const p=page(()=>new Promise(resolve=>{resolveFetch=resolve;}));
  await flush();p.button.listeners.click();await flush();
  vm.runInContext("clearTimeout(extensionRequest.timer); extensionRequest=null; current={image_id:'new-image',image_width:200,image_height:200}; clearBoxes();",p.context);
  await flush();
  resolveFetch({ok:true,json:async()=>result()});await flush();
  assert.equal(p.elements.overlay.children.length,0);
  assert.equal(p.button.disabled,false);
});

test('review gates export; edits invalidate review; YOLO uses original pixels',async()=>{
  const p=page(async()=>({ok:true,json:async()=>result()}));
  await flush();p.button.listeners.click();await flush();
  assert.equal(p.elements['export-json'].disabled,true);
  p.elements.review.listeners.click();
  assert.equal(p.elements['export-json'].disabled,false);
  assert.equal(vm.runInContext('yoloText()',p.context),'0 0.2 0.2 0.2 0.2\n');
  p.elements['box-list'].children[0].listeners.click();
  p.elements.category.value='1';p.elements.category.listeners.change();
  assert.equal(p.elements['export-json'].disabled,true);
  assert.equal(JSON.parse(p.elements.result.textContent).objects[0].class_id,1);
  p.elements['box-width'].value='10000';p.elements['apply-box'].listeners.click();
  assert.equal(p.elements.status.dataset.error,'true');
  assert.equal(vm.runInContext('objects[0].width',p.context),200);
  p.elements['box-width'].value='100';p.elements['apply-box'].listeners.click();
  assert.equal(vm.runInContext('objects[0].width',p.context),100);
  p.elements['delete-box'].listeners.click();p.elements.review.listeners.click();
  assert.equal(vm.runInContext('yoloText()',p.context),'');
  assert.equal(JSON.parse(p.elements.result.textContent).review_status,'confirmed');
  assert.equal(p.elements['export-yolo'].disabled,false);
});

test('pointer drawing, moving, resizing and cancellation preserve valid bounds',async()=>{
  const p=page(async()=>({ok:true,json:async()=>result()}));await flush();
  const overlay=p.elements.overlay;
  const event=(x,y,id=null,corner=null)=>({clientX:x,clientY:y,button:0,pointerId:1,preventDefault(){},target:{getAttribute:key=>key==='data-id'?id:corner}});
  p.elements['draw-mode'].listeners.click();
  overlay.listeners.pointerdown(event(300,300));overlay.listeners.pointermove(event(100,100));overlay.listeners.pointerup(event(100,100));
  let box=JSON.parse(p.elements.result.textContent).objects[0];
  assert.deepEqual([box.x,box.y,box.width,box.height],[100,100,200,200]);
  p.elements['select-mode'].listeners.click();
  overlay.listeners.pointerdown(event(150,150,box.id));overlay.listeners.pointermove(event(1000,800));overlay.listeners.pointerup(event(1000,800));
  box=JSON.parse(p.elements.result.textContent).objects[0];
  assert.deepEqual([box.x,box.y],[800,600]);
  overlay.listeners.pointerdown(event(1000,800,box.id,'se'));overlay.listeners.pointermove(event(900,700));overlay.listeners.pointerup(event(900,700));
  box=JSON.parse(p.elements.result.textContent).objects[0];
  assert.deepEqual([box.width,box.height],[100,100]);
  p.elements.review.listeners.click();
  overlay.listeners.pointerdown(event(850,650,box.id));overlay.listeners.pointermove(event(500,400));overlay.listeners.pointercancel(event(500,400));
  assert.equal(JSON.parse(p.elements.result.textContent).review_status,'confirmed');
  assert.equal(JSON.parse(p.elements.result.textContent).objects[0].x,800);
});
