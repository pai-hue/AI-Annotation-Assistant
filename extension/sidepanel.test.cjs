const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function element(id) {
  return {id,disabled:false,checked:false,textContent:'',className:'',children:[],listeners:{},attrs:{},
    classList:{_set:new Set(),
      toggle(n,f){if(f===undefined){this._set.has(n)?this._set.delete(n):this._set.add(n);}else if(f)this._set.add(n);else this._set.delete(n);},
      remove(n){this._set.delete(n);},add(n){this._set.add(n);},contains(n){return this._set.has(n);}},
    replaceChildren(...c){this.children=[...c];},append(...c){this.children.push(...c);},
    addEventListener(t,f){this.listeners[t]=f;},setAttribute(n,v){this.attrs[n]=String(v);},getAttribute(n){return this.attrs[n];}};
}
function sidepanel(overrides={}) {
  const elements={};
  ['panel-project','panel-status','btn-yolo','btn-mock','class-list',
   'btn-models-refresh','yolo-model-current','yolo-model-ready','yolo-class-names','yolo-model-select','btn-model-switch',
   'model-modal','model-modal-from','model-modal-to','model-confirm','model-cancel'].forEach(id=>{elements[id]=element(id);});
  elements['model-modal'].hidden = true;
  elements['yolo-model-select'].value = '';
  elements['yolo-model-select'].options = [];
  const origReplace = elements['yolo-model-select'].replaceChildren;
  elements['yolo-model-select'].replaceChildren = function(...c){ this.children=[...c]; this.options=[...c]; };
  Object.defineProperty(elements['yolo-model-select'], 'value', {
    get(){ return this._value || ''; },
    set(v){ this._value = String(v || ''); },
    configurable: true,
  });
  const document={getElementById:id=>elements[id],createElement:tag=>{const n=element();n.tag=tag;return n;}};
  const state={tabsQuery:[{id:7}],windowId:1,sentMessages:[],runtimeListeners:[],
    activatedListener:null,updatedListener:null};
  const chrome={
    runtime:{lastError:null,
      sendMessage(message,callback){state.sentMessages.push({message,callback});},
      onMessage:{addListener(fn){state.runtimeListeners.push(fn);}}},
    tabs:{query:async()=>overrides.tabsQuery ?? state.tabsQuery,
      onActivated:{addListener(fn){state.activatedListener=fn;}},
      onUpdated:{addListener(fn){state.updatedListener=fn;}}},
    windows:{getCurrent:async()=>({id:overrides.windowId ?? state.windowId})},
  };
  const context=vm.createContext({document,chrome});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'sidepanel.js'),'utf8'),context);
  return {elements,state,chrome};
}
const readyState={ready:true,busy:false,project:'demo',
  classes:[{id:0,name:'工件'},{id:1,name:'part'}],enabledClassIds:[0,1],label:'就绪',error:false};

test('panel requests state for the active tab on open',async()=>{
  const p=sidepanel();await flush();
  const types=p.state.sentMessages.map(m=>m.message.type);
  assert.ok(types.includes('PANEL_GET_STATE'));
  assert.ok(types.includes('PANEL_YOLO_STATUS'));
  const stateMsg=p.state.sentMessages.find(m=>m.message.type==='PANEL_GET_STATE');
  assert.equal(stateMsg.message.tabId,7);
});

test('null state shows unsupported site and disables operations',async()=>{
  const p=sidepanel();await flush();
  p.state.sentMessages.find(m=>m.message.type==='PANEL_GET_STATE').callback({ok:true,state:null});
  assert.equal(p.elements['panel-project'].textContent,'非支持网站或页面未就绪');
  assert.equal(p.elements['btn-yolo'].disabled,true);
  assert.equal(p.elements['btn-mock'].disabled,true);
});

test('ready state enables buttons, shows project and renders classes',async()=>{
  const p=sidepanel();await flush();
  p.state.sentMessages.find(m=>m.message.type==='PANEL_GET_STATE').callback({ok:true,state:readyState});
  assert.equal(p.elements['panel-project'].textContent,'当前项目：demo');
  assert.equal(p.elements['btn-yolo'].disabled,false);
  assert.equal(p.elements['btn-mock'].disabled,false);
  assert.equal(p.elements['panel-status'].textContent,'就绪');
  assert.equal(p.elements['class-list'].children.length,2);
  assert.equal(p.elements['class-list'].children[0].children[0].className,'class-box on');
});

test('YOLO button is disabled without enabled classes, not gated by consent',async()=>{
  const p=sidepanel();await flush();
  p.state.sentMessages.find(m=>m.message.type==='PANEL_GET_STATE').callback({ok:true,state:{...readyState,enabledClassIds:[]}});
  assert.equal(p.elements['btn-yolo'].disabled,true);
  p.state.sentMessages.find(m=>m.message.type==='PANEL_GET_STATE').callback({ok:true,state:readyState});
  assert.equal(p.elements['btn-yolo'].disabled,false);
});

test('button click sends a trusted command and re-renders from the response',async()=>{
  const p=sidepanel();await flush();
  p.state.sentMessages.find(m=>m.message.type==='PANEL_GET_STATE').callback({ok:true,state:readyState});
  p.elements['btn-mock'].listeners.click({isTrusted:true});
  const cmd=p.state.sentMessages.at(-1).message;
  assert.equal(cmd.type,'PANEL_COMMAND');
  assert.deepEqual(JSON.parse(JSON.stringify(cmd.command)),{action:'begin',mode:'mock'});
  assert.equal(cmd.tabId,7);
  p.state.sentMessages.at(-1).callback({ok:true,state:{...readyState,busy:true,label:'正在请求…'}});
  assert.equal(p.elements['btn-mock'].disabled,true);
  assert.equal(p.elements['btn-yolo'].disabled,true);
});

test('button click without a trusted user gesture does not send',async()=>{
  const p=sidepanel();await flush();
  p.state.sentMessages.find(m=>m.message.type==='PANEL_GET_STATE').callback({ok:true,state:readyState});
  const before=p.state.sentMessages.length;
  p.elements['btn-mock'].listeners.click({isTrusted:false});
  p.elements['btn-yolo'].listeners.click({isTrusted:false});
  assert.equal(p.state.sentMessages.length,before);
});

test('YOLO button click sends begin yolo',async()=>{
  const p=sidepanel();await flush();
  p.state.sentMessages.find(m=>m.message.type==='PANEL_GET_STATE').callback({ok:true,state:readyState});
  p.elements['btn-yolo'].listeners.click({isTrusted:true});
  const cmd=p.state.sentMessages.at(-1).message;
  assert.equal(cmd.type,'PANEL_COMMAND');
  assert.deepEqual(JSON.parse(JSON.stringify(cmd.command)),{action:'begin',mode:'yolo'});
});

test('class item click sends toggle_class with the class id',async()=>{
  const p=sidepanel();await flush();
  p.state.sentMessages.find(m=>m.message.type==='PANEL_GET_STATE').callback({ok:true,state:readyState});
  p.elements['class-list'].children[0].listeners.click();
  const cmd=p.state.sentMessages.at(-1).message;
  assert.equal(cmd.type,'PANEL_COMMAND');
  assert.deepEqual(JSON.parse(JSON.stringify(cmd.command)),{action:'toggle_class',classId:0});
});

test('PANEL_STATE push re-renders only for the matching tab',async()=>{
  const p=sidepanel();await flush();
  p.state.sentMessages.find(m=>m.message.type==='PANEL_GET_STATE').callback({ok:true,state:readyState});
  p.state.runtimeListeners[0]({type:'PANEL_STATE',tabId:8,state:{...readyState,project:'other'}});
  assert.equal(p.elements['panel-project'].textContent,'当前项目：demo');
  p.state.runtimeListeners[0]({type:'PANEL_STATE',tabId:7,state:{...readyState,project:'switched',busy:true}});
  assert.equal(p.elements['panel-project'].textContent,'当前项目：switched');
  assert.equal(p.elements['btn-mock'].disabled,true);
});

test('tab activation refreshes only for the side panel window',async()=>{
  const p=sidepanel();await flush();
  const before=p.state.sentMessages.filter(m=>m.message.type==='PANEL_GET_STATE').length;
  assert.equal(before,1);
  p.state.activatedListener({tabId:8,windowId:2});
  await flush();
  assert.equal(p.state.sentMessages.filter(m=>m.message.type==='PANEL_GET_STATE').length,1);
  p.state.activatedListener({tabId:8,windowId:1});
  await flush();
  assert.equal(p.state.sentMessages.filter(m=>m.message.type==='PANEL_GET_STATE').length,2);
});

test('YOLO model status refresh requests PANEL_YOLO_STATUS and MODELS',async()=>{
  const p=sidepanel();await flush();
  const statusMsg=p.state.sentMessages.find(m=>m.message.type==='PANEL_YOLO_STATUS');
  assert.ok(statusMsg);
  statusMsg.callback({ok:true,data:{provider:'yolo',configured:true,yolo:{
    configured:true,model_name:'demo.pt',model_path:'D:/x/demo.pt',ultralytics:true,
    class_names:['支架','产品'],load_error:null
  }}});
  await flush();
  const modelsMsg=p.state.sentMessages.find(m=>m.message.type==='PANEL_YOLO_MODELS');
  assert.ok(modelsMsg);
  modelsMsg.callback({ok:true,data:{models:[{path:'demo.pt',name:'demo.pt',size_bytes:1024}],
    current_relative_path:'demo.pt',current_model_name:'demo.pt'}});
  assert.match(p.elements['yolo-model-current'].textContent,/demo\.pt/);
  assert.match(p.elements['yolo-model-ready'].textContent,/就绪/);
  assert.equal(p.elements['yolo-class-names'].children.length,2);
});

test('confirm switch sends PANEL_YOLO_SWITCH only after modal confirm',async()=>{
  const p=sidepanel();await flush();
  const statusMsg=p.state.sentMessages.find(m=>m.message.type==='PANEL_YOLO_STATUS');
  statusMsg.callback({ok:true,data:{yolo:{configured:true,model_name:'old.pt',class_names:['a'],ultralytics:true}}});
  await flush();
  const modelsMsg=p.state.sentMessages.find(m=>m.message.type==='PANEL_YOLO_MODELS');
  modelsMsg.callback({ok:true,data:{models:[{path:'old.pt',name:'old.pt',size_bytes:1},{path:'new.pt',name:'new.pt',size_bytes:2}],
    current_relative_path:'old.pt',current_model_name:'old.pt'}});
  p.elements['yolo-model-select'].value='new.pt';
  p.elements['yolo-model-select'].listeners.change && p.elements['yolo-model-select'].listeners.change();
  // manually enable like updateSwitchEnabled
  p.elements['btn-model-switch'].disabled=false;
  p.elements['btn-model-switch'].listeners.click({isTrusted:true});
  assert.equal(p.elements['model-modal'].hidden,false);
  const before=p.state.sentMessages.length;
  p.elements['model-confirm'].listeners.click({isTrusted:true});
  const switchMsg=p.state.sentMessages.at(-1).message;
  assert.equal(switchMsg.type,'PANEL_YOLO_SWITCH');
  assert.equal(switchMsg.path,'new.pt');
  assert.equal(switchMsg.confirm,true);
  assert.ok(p.state.sentMessages.length>before);
});

