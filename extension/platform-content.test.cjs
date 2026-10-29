const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const plain=x=>JSON.parse(JSON.stringify(x));

function panel() {
  const elements=[],posted=[],requests=[],listeners={};
  const canvasEl={tag:'canvas',width:1000,height:800,getBoundingClientRect:()=>({left:0,top:0,width:500,height:400})};
  const element=tag=>{
    const node={tag,children:[],listeners:{},style:{setProperty(name,value){this[name]=value;}},checked:false,
      append(...items){this.children.push(...items);},attachShadow(){return element('shadow');},setAttribute(){},
      remove(){},replaceChildren(...items){this.children=[...items];},
      getBoundingClientRect(){return {left:250,top:0,width:330,height:120};},setPointerCapture(){},
      addEventListener(type,fn){this.listeners[type]=fn;}};
    elements.push(node);return node;
  };
  const origin='https://www.threetone.com.cn';
  const window={innerWidth:1280,innerHeight:800,addEventListener(type,fn){listeners[type]=fn;},postMessage(message){posted.push(message);}};
  let runtimeMessageListener=null;
  const context=vm.createContext({window,location:{origin,pathname:'/train/annotation/demo/editor'},
    document:{body:element('body'),getElementById:()=>null,createElement:element,querySelector:sel=>sel==='#editorCanvas'?canvasEl:null},
    setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},crypto:require('node:crypto').webcrypto,
    chrome:{runtime:{id:'test-extension',lastError:null,
      sendMessage(message,callback){requests.push({message,callback});},
      onMessage:{addListener(fn){runtimeMessageListener=fn;}}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'platform-content.js'),'utf8'),context);
  const receive=data=>listeners.message({source:window,origin,data:{channel:'aaa-deepdata-v1',from:'platform',...data}});
  const respond=(msg)=>{
    const out={};
    runtimeMessageListener(msg,{id:'test-extension'},v=>{out.value=v;});
    return out.value;
  };
  const command=cmd=>respond({type:'PANEL_COMMAND',command:cmd});
  const hello=()=>respond({type:'PANEL_HELLO'});
  const apiRequests=type=>requests.filter(r=>r.message.type===type);
  return {elements,posted,requests,receive,command,hello,apiRequests,runtimeMessageListener,
    keydown:event=>listeners.keydown(event),cleanup:()=>listeners.pagehide()};
}

test('YOLO starts without third-party gate and never starts from page messages',()=>{
  const p=panel();
  p.receive({type:'state',ready:true,classes:[{id:0,name:'part'}]});
  assert.equal(p.hello().busy,false);
  p.receive({type:'request',requestId:'forged',mode:'yolo',image:{}});
  assert.equal(p.apiRequests('ANNOTATION_YOLO').length,0);
  const st=p.command({action:'begin',mode:'yolo'});
  assert.equal(st.busy,true);
  const begin=p.posted.findLast(m=>m.type==='begin');
  assert.equal(begin.mode,'yolo');
  p.receive({type:'request',requestId:begin.requestId,mode:'mock',image:{}});
  assert.equal(p.apiRequests('ANNOTATION_YOLO').length,0);
  p.receive({type:'request',requestId:begin.requestId,mode:'yolo',image:{image_id:begin.requestId}});
  p.receive({type:'request',requestId:begin.requestId,mode:'yolo',image:{}});
  assert.equal(p.apiRequests('ANNOTATION_YOLO').length,1);
  p.apiRequests('ANNOTATION_YOLO')[0].callback({ok:false,error:'not configured'});
  assert.equal(p.posted.at(-1).type,'result');
  p.receive({type:'done',requestId:begin.requestId,message:'not configured',error:true});
  p.receive({type:'state',ready:true,classes:[{id:0,name:'part'}]});
  assert.equal(p.hello().busy,false);
});

test('mock needs no third-party gate, and obsolete callbacks do not finish a newer request',()=>{
  const p=panel();
  p.receive({type:'state',ready:true});
  p.command({action:'begin',mode:'mock'});
  const old=p.posted.at(-1).requestId;
  p.receive({type:'request',requestId:old,mode:'mock',image:{}});
  assert.equal(p.apiRequests('ANNOTATION_MOCK').length,1);
  p.receive({type:'done',requestId:old,message:'timeout'});
  p.receive({type:'state',ready:true});
  p.command({action:'begin',mode:'mock'});
  const current=p.posted.at(-1).requestId;
  assert.equal(p.hello().busy,true);
  p.receive({type:'done',requestId:old,message:'late'});
  assert.equal(p.hello().busy,true);
  p.apiRequests('ANNOTATION_MOCK')[0].callback({ok:true});
  assert.equal(p.hello().busy,true);
  assert.equal(p.posted.filter(m=>m.type==='result').length,0);
  assert.notEqual(current,old);
});

test('Enter shortcut starts a YOLO request and is ignored on repeats, wrong keys and focused controls',()=>{
  const p=panel();
  p.receive({type:'state',ready:true,classes:[{id:0,name:'part'}]});
  const fire=(over={})=>p.keydown({key:'Enter',ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,isTrusted:true,repeat:false,preventDefault(){},...over});
  fire({key:'a'});fire({shiftKey:true});fire({repeat:true});fire({target:{closest:sel=>sel}});
  assert.equal(p.posted.some(m=>m.type==='begin'),false);
  fire({});
  const begin=p.posted.at(-1);
  assert.equal(begin.type,'begin');assert.equal(begin.mode,'yolo');
});

test('toggle_class commands send only enabled class ids in YOLO begin',()=>{
  const p=panel();
  p.receive({type:'state',ready:true,classes:[{id:0,name:'工件'},{id:1,name:'part'}]});
    const complete=id=>p.receive({type:'done',requestId:id,message:'ok'});
  p.command({action:'begin',mode:'yolo'});
  let begin=p.posted.at(-1);
  assert.deepEqual(plain(begin.enabledClassIds),[0,1]);
  complete(begin.requestId);
  assert.deepEqual(plain(p.command({action:'toggle_class',classId:0}).enabledClassIds),[1]);
  p.command({action:'begin',mode:'yolo'});
  begin=p.posted.at(-1);
  assert.deepEqual(plain(begin.enabledClassIds),[1]);
  complete(begin.requestId);
  assert.deepEqual(plain(p.command({action:'toggle_class',classId:1}).enabledClassIds),[]);
  const before=p.posted.filter(m=>m.type==='begin').length;
  p.command({action:'begin',mode:'yolo'});
  assert.equal(p.posted.filter(m=>m.type==='begin').length,before);
});

test('category filter is locked during a request and unlocks on completion',()=>{
  const p=panel();
  p.receive({type:'state',ready:true,project:'demo',classes:[{id:0,name:'工件'},{id:1,name:'part'}]});
    p.command({action:'begin',mode:'yolo'});
  const begin=p.posted.at(-1);
  assert.deepEqual(plain(p.hello().enabledClassIds),[0,1]);
  assert.deepEqual(plain(p.command({action:'toggle_class',classId:0}).enabledClassIds),[0,1]);
  p.receive({type:'done',requestId:begin.requestId,message:'ok'});
  assert.deepEqual(plain(p.command({action:'toggle_class',classId:0}).enabledClassIds),[1]);
});

test('adding a class preserves disabled classes in the same project',()=>{
  const p=panel();
  p.receive({type:'state',ready:true,project:'demo',classes:[{id:0,name:'工件'},{id:1,name:'part'}]});
  assert.deepEqual(plain(p.command({action:'toggle_class',classId:0}).enabledClassIds),[1]);
  p.receive({type:'state',ready:true,project:'demo',classes:[{id:0,name:'工件'},{id:1,name:'part'},{id:2,name:'新增'}]});
  const st=p.hello();
  assert.deepEqual(plain(st.classes.map(c=>c.name)),['工件','part','新增']);
  assert.deepEqual(plain(st.enabledClassIds),[1,2]);
});

test('switching project resets the category filter',()=>{
  const p=panel();
  p.receive({type:'state',ready:true,project:'demo',classes:[{id:0,name:'工件'},{id:1,name:'part'}]});
  assert.deepEqual(plain(p.command({action:'toggle_class',classId:0}).enabledClassIds),[1]);
  p.receive({type:'state',ready:true,project:'other',classes:[{id:0,name:'工件'},{id:1,name:'part'}]});
  assert.deepEqual(plain(p.hello().enabledClassIds),[0,1]);
});

test('state push and PANEL_HELLO carry tab-bound state to the side panel',()=>{
  const p=panel();
  p.receive({type:'state',ready:true,project:'demo',classes:[{id:0,name:'part'}]});
  const pushes=p.requests.filter(r=>r.message.type==='TAB_STATE');
  assert.ok(pushes.length>0);
  assert.equal(pushes.at(-1).message.state.project,'demo');
  assert.deepEqual(plain(pushes.at(-1).message.state.enabledClassIds),[0]);
  const st=p.hello();
  assert.equal(st.ready,true);assert.equal(st.project,'demo');assert.equal(st.busy,false);
});

test('runtime commands from a foreign extension are ignored',()=>{
  const p=panel();
  p.receive({type:'state',ready:true});
  const out={};
  const ret=p.runtimeMessageListener({type:'PANEL_COMMAND',command:{action:'begin',mode:'mock'}},{id:'other-extension'},v=>{out.value=v;});
  assert.equal(ret,undefined);
  assert.equal(out.value,undefined);
  assert.equal(p.posted.some(m=>m.type==='begin'),false);
});
