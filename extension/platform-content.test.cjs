const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function panel() {
  const elements=[],posted=[],requests=[],listeners={};
  const element=tag=>{
    const node={tag,children:[],listeners:{},style:{},checked:false,append(...items){this.children.push(...items);},
      attachShadow(){return element('shadow');},setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;}};
    elements.push(node);return node;
  };
  const origin='https://www.threetone.com.cn';
  const window={addEventListener(type,fn){listeners[type]=fn;},postMessage(message){posted.push(message);}};
  const context=vm.createContext({window,location:{origin,pathname:'/train/annotation/demo/editor'},
    document:{body:element('body'),getElementById:()=>null,createElement:element},
    setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},crypto:require('node:crypto').webcrypto,
    chrome:{runtime:{sendMessage(message,callback){requests.push({message,callback});}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'platform-content.js'),'utf8'),context);
  const receive=data=>listeners.message({source:window,origin,data:{channel:'aaa-deepdata-v1',from:'platform',...data}});
  return {elements,posted,requests,receive,ai:elements.find(e=>e.textContent==='千问预标注'),
    mock:elements.find(e=>e.textContent==='模拟测试'),consent:elements.find(e=>e.tag==='input'),
    cleanup:()=>listeners.pagehide()};
}

test('AI requires explicit consent and a trusted click, and never starts from page messages',t=>{
  const p=panel();t.after(p.cleanup);
  assert.ok(p.elements.some(e=>e.textContent==='允许将当前图片及项目类别发送到阿里云百炼（通义千问，按用量计费）'));
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
