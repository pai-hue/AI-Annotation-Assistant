const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function panel() {
  const elements=[],posted=[],requests=[],listeners={};
  const canvasEl={tag:'canvas',width:1000,height:800,getBoundingClientRect:()=>({left:0,top:0,width:500,height:400})};
  const element=tag=>{
    const node={tag,children:[],listeners:{},style:{setProperty(name,value){this[name]=value;}},checked:false,append(...items){this.children.push(...items);},
      attachShadow(){return element('shadow');},setAttribute(){},remove(){},replaceChildren(...items){this.children=[...items];},
      getBoundingClientRect(){return {left:250,top:0,width:330,height:120};},setPointerCapture(){},
      addEventListener(type,fn){this.listeners[type]=fn;}};
    elements.push(node);return node;
  };
  const origin='https://www.threetone.com.cn';
  const window={innerWidth:1280,innerHeight:800,addEventListener(type,fn){listeners[type]=fn;},postMessage(message){posted.push(message);}};
  const context=vm.createContext({window,location:{origin,pathname:'/train/annotation/demo/editor'},
    document:{body:element('body'),getElementById:()=>null,createElement:element,querySelector:sel=>sel==='#editorCanvas'?canvasEl:null},
    setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},crypto:require('node:crypto').webcrypto,
    chrome:{runtime:{sendMessage(message,callback){requests.push({message,callback});}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'platform-content.js'),'utf8'),context);
  const receive=data=>listeners.message({source:window,origin,data:{channel:'aaa-deepdata-v1',from:'platform',...data}});
  return {elements,posted,requests,receive,ai:elements.find(e=>e.textContent==='预标注'),
    mock:elements.find(e=>e.textContent==='模拟测试'),ref:elements.find(e=>e.textContent==='采集示例'),
    consent:elements.find(e=>e.tag==='input'),
    keydown:event=>listeners.keydown(event),cleanup:()=>listeners.pagehide()};
}

test('AI requires explicit consent and a trusted click, and never starts from page messages',t=>{
  const p=panel();t.after(p.cleanup);
  assert.ok(p.elements.some(e=>e.textContent==='允许将当前图片、示例图及项目类别发送到阿里云百炼'));
  p.receive({type:'state',ready:true,classes:[{id:0,name:'part'}]});
  assert.equal(p.ai.disabled,true);assert.equal(p.mock.disabled,false);
  p.ai.listeners.click({isTrusted:true});
  p.receive({type:'request',requestId:'forged',mode:'ai',image:{}});
  assert.equal(p.requests.length,0);assert.equal(p.posted.some(m=>m.type==='begin'),false);
  p.consent.checked=true;p.consent.listeners.change();
  p.ai.listeners.click({isTrusted:false});
  assert.equal(p.posted.some(m=>m.type==='begin'),false);
  p.ai.listeners.click({isTrusted:true});
  const begin=p.posted.at(-1);assert.equal(begin.mode,'ai');
  p.receive({type:'request',requestId:begin.requestId,mode:'mock',image:{}});
  assert.equal(p.requests.length,0);
  p.receive({type:'request',requestId:begin.requestId,mode:'ai',image:{image_id:begin.requestId}});
  p.receive({type:'request',requestId:begin.requestId,mode:'ai',image:{}});
  assert.equal(p.requests.length,1);assert.equal(p.requests[0].message.type,'ANNOTATION_AI');
  p.requests[0].callback({ok:false,error:'not configured'});
  assert.equal(p.posted.at(-1).type,'result');
  p.receive({type:'done',requestId:begin.requestId,message:'not configured',error:true});
  p.receive({type:'state',ready:true,classes:[{id:0,name:'part'}]});assert.equal(p.ai.disabled,false);
});

test('drag handle moves the panel and clamps it to the viewport',()=>{
  const p=panel();
  const host=p.elements.find(e=>e.id==='aaa-platform-panel');
  const header=p.elements.find(e=>e.className==='panel-header');
  assert.ok(host);assert.ok(header);
  header.listeners.pointerdown({button:0,pointerId:1,clientX:100,clientY:50,preventDefault(){}});
  header.listeners.pointermove({clientX:260,clientY:130});
  assert.equal(host.style.left,'410px');assert.equal(host.style.top,'80px');assert.equal(host.style.bottom,'auto');
  header.listeners.pointermove({clientX:99999,clientY:99999});
  assert.equal(host.style.left,'950px');assert.equal(host.style.top,'680px');
  header.listeners.pointerup();
  header.listeners.pointermove({clientX:0,clientY:0});
  assert.equal(host.style.left,'950px');assert.equal(host.style.top,'680px');
});

test('resize handle changes panel size and scales content, clamping to the viewport',()=>{
  const p=panel();
  const section=p.elements.find(e=>e.tag==='section');
  const resize=p.elements.find(e=>e.className==='resize-handle');
  assert.ok(section);assert.ok(resize);
  resize.listeners.pointerdown({button:0,pointerId:1,clientX:100,clientY:50,preventDefault(){}});
  resize.listeners.pointermove({clientX:200,clientY:100});
  assert.equal(section.style.width,'430px');assert.equal(section.style.height,'170px');
  assert.ok(Math.abs(parseFloat(section.style['--s'])-430/330)<1e-12);
  resize.listeners.pointermove({clientX:99999,clientY:99999});
  assert.equal(section.style.width,'1022px');assert.equal(section.style.height,'792px');
  assert.ok(Math.abs(parseFloat(section.style['--s'])-1022/330)<1e-12);
  resize.listeners.pointerup();
  resize.listeners.pointermove({clientX:0,clientY:0});
  assert.equal(section.style.width,'1022px');assert.equal(section.style.height,'792px');
});

test('mock needs no AI consent, and obsolete callbacks do not finish a newer request',t=>{
  const p=panel();t.after(p.cleanup);p.receive({type:'state',ready:true});
  p.mock.listeners.click({isTrusted:true});const old=p.posted.at(-1).requestId;
  p.receive({type:'request',requestId:old,mode:'mock',image:{}});
  assert.equal(p.requests[0].message.type,'ANNOTATION_MOCK');
  p.receive({type:'done',requestId:old,message:'timeout'});p.receive({type:'state',ready:true});
  p.mock.listeners.click({isTrusted:true});const current=p.posted.at(-1).requestId;
  p.receive({type:'done',requestId:old,message:'late'});
  p.requests[0].callback({ok:true});
  assert.equal(p.posted.at(-1).requestId,current);
  assert.equal(p.mock.disabled,true);
});

test('Enter shortcut starts an AI request and is ignored on repeats, wrong keys and focused controls',()=>{
  const p=panel();p.receive({type:'state',ready:true,classes:[{id:0,name:'part'}]});
  p.consent.checked=true;p.consent.listeners.change();
  const fire=(over={})=>p.keydown({key:'Enter',ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,isTrusted:true,repeat:false,preventDefault(){},...over});
  fire({key:'a'});
  fire({shiftKey:true});
  fire({repeat:true});
  fire({target:{closest:sel=>sel}});
  assert.equal(p.posted.some(m=>m.type==='begin'),false);
  fire({});
  const begin=p.posted.at(-1);
  assert.equal(begin.type,'begin');
  assert.equal(begin.mode,'ai');
});

test('capture-example enters crop mode and sends reference only after confirming a selection',()=>{
  const p=panel();p.receive({type:'state',ready:true});
  assert.equal(p.ref.disabled,false);
  p.ref.listeners.click({isTrusted:true});
  assert.equal(p.posted.some(m=>m.type==='begin'),false);
  assert.equal(p.ref.disabled,true);
  const view=p.elements.find(e=>e.id==='aaa-crop-view');
  const ok=p.elements.find(e=>e.textContent==='确认');
  assert.ok(view);assert.ok(ok);assert.equal(ok.disabled,true);
  view.listeners.pointerdown({button:0,pointerId:1,clientX:50,clientY:40,preventDefault(){},stopPropagation(){}});
  view.listeners.pointermove({clientX:250,clientY:240});
  view.listeners.pointerup();
  assert.equal(ok.disabled,false);
  ok.listeners.click({isTrusted:true});
  const begin=p.posted.findLast(m=>m.type==='begin');
  assert.equal(begin.mode,'reference');
  assert.deepEqual(JSON.parse(JSON.stringify(begin.crop)),{x:100,y:80,width:400,height:400});
  p.receive({type:'request',requestId:begin.requestId,mode:'reference',image:{image_id:begin.requestId}});
  assert.equal(p.requests.length,1);
  assert.equal(p.requests[0].message.type,'REFERENCE_CAPTURE');
  p.requests[0].callback({ok:true});
  assert.equal(p.posted.at(-1).type,'result');
  p.receive({type:'done',requestId:begin.requestId,message:'saved'});
  assert.equal(p.ref.disabled,false);
});

test('capture-example cancel exits crop mode without sending',()=>{
  const p=panel();p.receive({type:'state',ready:true});
  p.ref.listeners.click({isTrusted:true});
  assert.equal(p.posted.some(m=>m.type==='begin'),false);
  assert.equal(p.ref.disabled,true);
  const cancel=p.elements.find(e=>e.textContent==='取消');
  cancel.listeners.click({isTrusted:true});
  assert.equal(p.posted.some(m=>m.type==='begin'),false);
  assert.equal(p.ref.disabled,false);
});

test('category squares toggle and AI begin sends only enabled class ids',t=>{
  const p=panel();t.after(p.cleanup);
  p.receive({type:'state',ready:true,classes:[{id:0,name:'工件'},{id:1,name:'part'}]});
  const list=p.elements.find(e=>e.className==='class-list');
  assert.ok(list);assert.equal(list.children.length,2);
  const item0=list.children[0];
  assert.equal(item0.children[0].className,'class-box on');
  p.consent.checked=true;p.consent.listeners.change();
  const complete=id=>p.receive({type:'done',requestId:id,message:'ok'});
  p.ai.listeners.click({isTrusted:true});
  let begin=p.posted.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(begin.enabledClassIds)),[0,1]);
  complete(begin.requestId);
  item0.listeners.click();
  assert.equal(item0.children[0].className,'class-box');
  p.ai.listeners.click({isTrusted:true});
  begin=p.posted.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(begin.enabledClassIds)),[1]);
  complete(begin.requestId);
  list.children[1].listeners.click();
  assert.equal(p.ai.disabled,true);
  const before=p.posted.filter(m=>m.type==='begin').length;
  p.ai.listeners.click({isTrusted:true});
  assert.equal(p.posted.filter(m=>m.type==='begin').length,before);
});
