// Node's built-in runner; browser globals are simulated, not a real Edge session.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const sender = {id: 'test-extension', frameId: 0, url: 'http://127.0.0.1:18000/demo/'};
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
  assert.equal(captured.url,'http://127.0.0.1:18000/api/annotations/mock');
  assert.deepEqual(JSON.parse(captured.options.body),image);
  assert.equal(captured.options.redirect,'error');
});

test('background rejects unrelated origins, ports, frames and invalid dimensions',async()=>{
  let calls=0;
  const send=backend(async()=>{calls++;throw Error('must not fetch');});
  for(const source of [{...sender,url:'https://example.com/demo/'},{...sender,url:'http://127.0.0.1:9000/demo/'},{...sender,url:'http://127.0.0.1:8000/demo/'},{...sender,frameId:1},{...sender,id:'other'}]) {
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

const aiImage={...image,input_width:1000,input_height:800,image_data_url:'data:image/jpeg;base64,AAAA',project_id:'demo',classes:[{id:3,name:'part'}]};
const platformSender={...sender,url:'https://www.threetone.com.cn/train/annotation/demo/editor'};

test('YOLO background forwards only image and classes to fixed local endpoint',async()=>{
  let captured;
  const send=backend(async(url,options)=>{captured={url,options};return {ok:true,json:async()=>({source:'yolo'})};});
  const reply=await send({type:'ANNOTATION_YOLO',image:{...aiImage,project:'private',filename:'private',url:'https://other.example'}},platformSender);
  assert.equal(reply.ok,true);
  assert.equal(captured.url,'http://127.0.0.1:18000/api/annotations/yolo');
  assert.deepEqual(JSON.parse(captured.options.body),aiImage);
  assert.equal(captured.options.credentials,'omit');
});

test('YOLO image validation and origin check prevent forwarding invalid requests',async()=>{
  let calls=0;
  const send=backend(async()=>{calls++;throw Error('unexpected');});
  assert.equal((await send({type:'ANNOTATION_YOLO',image:aiImage})).ok,false);
  for(const mutation of [{classes:[]},{classes:[{id:3,name:'a'},{id:3,name:'b'}]},
    {classes:[{id:0,name:' '}]},{image_data_url:'https://example.com/image.jpg'},
    {image_data_url:'data:image/jpeg;base64,'+'A'.repeat(2796240)},{input_width:1601}]) {
    assert.equal((await send({type:'ANNOTATION_YOLO',image:{...aiImage,...mutation}},platformSender)).ok,false);
  }
  assert.equal(calls,0);
});

test('YOLO configuration errors remain actionable and unrelated error bodies are hidden',async()=>{
  const send=backend(async()=>({ok:false,status:503,json:async()=>({code:'not_configured',detail:'找不到 YOLO 权重'})}));
  assert.equal((await send({type:'ANNOTATION_YOLO',image:aiImage},platformSender)).error,'找不到 YOLO 权重');
  const bad=backend(async()=>({ok:false,status:502,json:async()=>({detail:'sensitive provider text'})}));
  assert.doesNotMatch((await bad({type:'ANNOTATION_YOLO',image:aiImage},platformSender)).error,/sensitive/);
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
    postMessage(data){queueMicrotask(()=>listeners.forEach(fn=>fn({source:window,origin:'http://127.0.0.1:18000',data})));}};
  const send=backend(fetchImpl);
  const context=vm.createContext({window,location:{origin:'http://127.0.0.1:18000',pathname:'/demo/'},
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

test('YOLO background forwards enabled_class_ids and rejects invalid subsets',async()=>{
  let captured;
  const send=backend(async(url,options)=>{captured={url,options};return {ok:true,json:async()=>({source:'yolo'})};});
  const reply=await send({type:'ANNOTATION_YOLO',image:{...aiImage,enabled_class_ids:[3]}},platformSender);
  assert.equal(reply.ok,true);
  assert.deepEqual(JSON.parse(captured.options.body),{...aiImage,enabled_class_ids:[3]});
  let calls=0;
  const reject=backend(async()=>{calls++;throw Error('unexpected');});
  for(const mutation of [{enabled_class_ids:[]},{enabled_class_ids:[7]},{enabled_class_ids:[3,3]}]) {
    assert.equal((await reject({type:'ANNOTATION_YOLO',image:{...aiImage,...mutation}},platformSender)).ok,false);
  }
  assert.equal(calls,0);
});

test('YOLO rejects missing or invalid project_id',async()=>{
  let calls=0;
  const send=backend(async()=>{calls++;throw Error('unexpected');});
  for(const mutation of [{project_id:undefined},{project_id:''},{project_id:'  '},{project_id:'x'.repeat(201)},{project_id:123}]) {
    assert.equal((await send({type:'ANNOTATION_YOLO',image:{...aiImage,...mutation}},platformSender)).ok,false);
  }
  assert.equal(calls,0);
});

// --- Side panel routing ---
function routingBackend() {
  let listener;
  const runtimeMessages=[];
  const tabMessages=[];
  const chromeMock={
    runtime:{
      id:'test-extension',lastError:null,
      onMessage:{addListener(fn){listener=fn;}},
      sendMessage(message){runtimeMessages.push(message);return Promise.resolve();},
    },
    tabs:{sendMessage(tabId,message,callback){tabMessages.push({tabId,message,callback});}},
    sidePanel:{setPanelBehavior(){}},
  };
  const context=vm.createContext({URL,AbortController,setTimeout,clearTimeout,fetch:async()=>{throw Error('no fetch');},chrome:chromeMock});
  vm.runInContext(read('background.js'),context);
  return {
    dispatch:(message,source=sender)=>new Promise(resolve=>listener(message,source,resolve)),
    listener,runtimeMessages,tabMessages,
    respondTab(i,response,lastError=null){chromeMock.runtime.lastError=lastError;tabMessages[i].callback(response);},
  };
}
const sidepanelSender={id:'test-extension'};

test('PANEL_GET_STATE routes to the requested tab and returns its state',async()=>{
  const b=routingBackend();
  const pending=b.dispatch({type:'PANEL_GET_STATE',tabId:7},sidepanelSender);
  assert.equal(b.tabMessages.length,1);
  assert.equal(b.tabMessages[0].tabId,7);
  assert.equal(b.tabMessages[0].message.type,'PANEL_HELLO');
  b.respondTab(0,{ready:true,project:'demo'});
  const reply=await pending;
  assert.equal(reply.ok,true);
  assert.equal(reply.state.project,'demo');
});

test('PANEL_GET_STATE returns null state when the content script is unavailable',async()=>{
  const b=routingBackend();
  const pending=b.dispatch({type:'PANEL_GET_STATE',tabId:7},sidepanelSender);
  b.respondTab(0,undefined,{message:'Could not establish connection'});
  const reply=await pending;
  assert.equal(reply.ok,true);
  assert.equal(reply.state,null);
});

test('PANEL_COMMAND routes a command and forwards the resulting state',async()=>{
  const b=routingBackend();
  const pending=b.dispatch({type:'PANEL_COMMAND',tabId:7,command:{action:'begin',mode:'mock'}},sidepanelSender);
  assert.equal(b.tabMessages[0].message.type,'PANEL_COMMAND');
  assert.deepEqual(b.tabMessages[0].message.command,{action:'begin',mode:'mock'});
  b.respondTab(0,{busy:true});
  const reply=await pending;
  assert.equal(reply.ok,true);
  assert.equal(reply.state.busy,true);
});

test('PANEL_COMMAND rejects an invalid tab or command',async()=>{
  const b=routingBackend();
  assert.equal((await b.dispatch({type:'PANEL_COMMAND',tabId:'x',command:{}},sidepanelSender)).ok,false);
  assert.equal((await b.dispatch({type:'PANEL_COMMAND',tabId:7,command:null},sidepanelSender)).ok,false);
  assert.equal(b.tabMessages.length,0);
});

test('TAB_STATE is forwarded as PANEL_STATE with the sender tab id',()=>{
  const b=routingBackend();
  const source={id:'test-extension',frameId:0,url:'https://www.threetone.com.cn/train/annotation/demo/editor',tab:{id:7}};
  assert.equal(b.listener({type:'TAB_STATE',state:{busy:true}},source,()=>{}),false);
  assert.deepEqual(JSON.parse(JSON.stringify(b.runtimeMessages)),[{type:'PANEL_STATE',tabId:7,state:{busy:true}}]);
});

test('TAB_STATE without a sender tab is dropped',()=>{
  const b=routingBackend();
  b.listener({type:'TAB_STATE',state:{busy:true}},sidepanelSender,()=>{});
  assert.equal(b.runtimeMessages.length,0);
});

const collectBody={project_id:'demo',classes:[{id:3,name:'part'},{id:9,name:'工件'}],
  examples:[{class_id:9,input_width:64,input_height:48,image_data_url:'data:image/jpeg;base64,AAAA',source_id:'s1'}]};
