const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function panel() {
  const elements=[],posted=[],requests=[],listeners={};
  const element=tag=>{
    const node={tag,children:[],listeners:{},style:{setProperty(name,value){this[name]=value;}},checked:false,append(...items){this.children.push(...items);},
      attachShadow(){return element('shadow');},setAttribute(){},
      getBoundingClientRect(){return {left:250,top:0,width:330,height:120};},setPointerCapture(){},
      addEventListener(type,fn){this.listeners[type]=fn;}};
    elements.push(node);return node;
  };
  const origin='https://www.threetone.com.cn';
  const window={innerWidth:1280,innerHeight:800,addEventListener(type,fn){listeners[type]=fn;},postMessage(message){posted.push(message);}};
  const context=vm.createContext({window,location:{origin,pathname:'/train/annotation/demo/editor'},
    document:{body:element('body'),getElementById:()=>null,createElement:element},
    setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},crypto:require('node:crypto').webcrypto,
    chrome:{runtime:{sendMessage(message,callback){requests.push({message,callback});}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'platform-content.js'),'utf8'),context);
  const receive=data=>listeners.message({source:window,origin,data:{channel:'aaa-deepdata-v1',from:'platform',...data}});
  return {elements,posted,requests,receive,ai:elements.find(e=>e.textContent==='预标注'),
    mock:elements.find(e=>e.textContent==='模拟测试'),consent:elements.find(e=>e.tag==='input'),
    keydown:event=>listeners.keydown(event),cleanup:()=>listeners.pagehide()};
}

test('AI requires explicit consent and a trusted click, and never starts from page messages',t=>{
  const p=panel();t.after(p.cleanup);
  assert.ok(p.elements.some(e=>e.textContent==='允许将当前图片及项目类别发送到阿里云百炼'));
  p.receive({type:'state',ready:true});
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
  p.receive({type:'state',ready:true});assert.equal(p.ai.disabled,false);
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
  const p=panel();p.receive({type:'state',ready:true});
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
