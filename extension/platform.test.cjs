const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function fixture() {
  const messages=[];let listener;
  const captures=[];
  const document={createElement:()=>{
    const capture={width:0,height:0,getContext:()=>({fillRect(){},drawImage(...args){capture.draw=args;capture.source=args[0];}}),toDataURL:()=> 'data:image/jpeg;base64,AAAA'};
    captures.push(capture);return capture;
  }};
  const window={postMessage:data=>messages.push(data),addEventListener:(type,fn)=>{listener=fn;}};
  const context=vm.createContext({window,document,location:{origin:'https://www.threetone.com.cn',pathname:'/train/annotation/demo/editor'},setTimeout,clearTimeout});
  vm.runInContext(`
    const projectName='demo';let classes=['workpiece','part'];let currentClassIdx=1;
    let annotations={other:[{x:5}]};let currentImageIdx=0;let isPlaying=false;
    const getSortedImages=()=>['test.png','other.png'];
    const imgObj={src:'blob:test',complete:true};
    const imageCache=new Map([['test.png',{src:'blob:test',complete:true,naturalWidth:1000,naturalHeight:800}]]);
    const canvas={width:1000,height:800};let selectedRectIdx=-1;let refreshes=0;let failDraw=false;
    function draw(){if(failDraw)throw Error('failed');refreshes++;}
    function renderRectList(){} function renderImageList(){} function renderClassList(){} function initClassAnnotationCounts(){}
  `,context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'platform-main.js'),'utf8'),context);
  const send=data=>listener({source:window,origin:'https://www.threetone.com.cn',data:{channel:'aaa-deepdata-v1',from:'extension',...data}});
  const response=()=>({ok:true,data:{schema_version:'1.0',source:'mock',image_id:'request-1',image_width:1000,image_height:800,objects:[{id:'box-1',class_id:0,class_name:'part_A',x:100,y:80,width:200,height:160}]}});
  const begin=(mode='mock',crop)=>send({type:'begin',requestId:'request-1',mode,crop});
  const finish=(value=response())=>send({type:'result',requestId:'request-1',response:value});
  return {context,messages,captures,send,begin,finish,response,read:code=>vm.runInContext(code,context)};
}
test('native adapter maps selected class and preserves other images',()=>{
  const p=fixture();p.begin();p.finish();
  assert.deepEqual(JSON.parse(p.read('JSON.stringify(annotations["test.png"])')),[{x:100,y:80,w:200,h:160,class_id:1,img_w:1000,img_h:800}]);
  assert.equal(p.read('annotations.other[0].x'),5);
  assert.equal(p.read('refreshes'),1);
  p.begin();assert.equal(p.messages.at(-1).ready,false);
  assert.equal(p.read('annotations["test.png"].length'),1);
});
test('preconditions block existing annotations, playback and stale image size',()=>{
  for(const mutation of ['annotations["test.png"]=[{x:3}]','isPlaying=true','canvas.width=960','imgObj.src="blob:old"','classes=[]']) {
    const p=fixture();p.read(mutation);p.begin();
    assert.equal(p.messages.some(m=>m.type==='request'),false);
    assert.equal(p.read('refreshes'),0);
  }
});
test('in-flight image, category, or manual annotation changes reject the result',()=>{
  for(const mutation of ['currentImageIdx=1','classes[0]="renamed"','currentClassIdx=0','annotations["test.png"]=[{x:7}]']) {
    const p=fixture();p.begin();p.read(mutation);p.finish();
    assert.equal(p.read('refreshes'),0);
    assert.ok(p.messages.some(m=>m.type==='done' && m.error));
  }
});
test('all boxes are validated before writing; invalid late box cannot partially apply',()=>{
  const p=fixture();p.begin();const result=p.response();
  result.data.objects.push({id:'box-2',class_id:0,class_name:'part_A',x:999,y:0,width:50,height:20});
  p.finish(result);assert.equal(p.read('annotations["test.png"]'),undefined);
});
test('site render failure rolls back before native timer can persist',()=>{
  const p=fixture();p.begin();p.read('failDraw=true');p.finish();
  assert.equal(p.read('annotations["test.png"]'),undefined);
  assert.equal(p.read('selectedRectIdx'),-1);
});
test('empty and failed responses do not create data or mark review',()=>{
  for(const kind of ['empty','error']) {
    const p=fixture();p.begin();const r=p.response();r.data.objects=[];
    p.finish(kind==='empty'?r:{ok:false,error:'offline'});
    assert.equal(p.read('annotations["test.png"]'),undefined);
    assert.equal(p.read('refreshes'),0);
  }
});

test('AI reads original image without overlays; mock and polls do not capture pixels',()=>{
  const p=fixture();p.send({type:'hello'});p.begin();p.finish({ok:false,error:'cancel'});
  assert.equal(p.captures.length,0);
  p.read('canvas.width=4000;canvas.height=2000;imageCache.get("test.png").naturalWidth=4000;imageCache.get("test.png").naturalHeight=2000;');
  p.begin('ai');
  const request=p.messages.findLast(m=>m.type==='request');
  assert.equal(request.mode,'ai');
  assert.equal(request.image.input_width,1600);
  assert.equal(request.image.input_height,800);
  assert.equal(request.image.image_width,4000);
  assert.equal(p.captures[0].source,p.read('imageCache.get("test.png")'));
  assert.deepEqual(JSON.parse(JSON.stringify(request.image.classes)),[{id:0,name:'workpiece'},{id:1,name:'part'}]);
  assert.equal(request.image.project,undefined);
  assert.equal(request.image.filename,undefined);
  p.finish({ok:false,error:'cancel'});
});

test('AI preserves multiple native class IDs, instead of remapping to selected class',()=>{
  const p=fixture();p.begin('ai');
  const response=p.response();response.data.source='qwen';
  response.data.objects=[{id:'a',class_id:0,class_name:'workpiece',x:1,y:2,width:30,height:40},
    {id:'b',class_id:1,class_name:'part',x:300,y:200,width:70,height:20}];
  p.finish(response);
  assert.deepEqual(JSON.parse(p.read('JSON.stringify(annotations["test.png"].map(b=>b.class_id))')),[0,1]);
  assert.equal(p.read('annotations.other[0].x'),5);
});

test('AI keeps adjacent instances of the same class as separate native boxes',()=>{
  const p=fixture();p.read('classes[1]="黑色板件"');p.begin('ai');
  const response=p.response();response.data.source='qwen';
  response.data.objects=[
    {id:'ai-1',class_id:1,class_name:'黑色板件',x:100,y:200,width:300,height:400},
    {id:'ai-2',class_id:1,class_name:'黑色板件',x:400,y:200,width:300,height:400}
  ];
  p.finish(response);
  assert.deepEqual(JSON.parse(p.read('JSON.stringify(annotations["test.png"])')),[
    {x:100,y:200,w:300,h:400,class_id:1,img_w:1000,img_h:800},
    {x:400,y:200,w:300,h:400,class_id:1,img_w:1000,img_h:800}
  ]);
  assert.equal(p.read('annotations.other[0].x'),5);
  assert.equal(p.read('refreshes'),1);
});

test('AI rejects unknown/mismatched class, wrong source and stale image before writing',()=>{
  for(const mutation of ['unknown','name','source','old-provider','image','existing','classes']) {
    const p=fixture();p.begin('ai');const response=p.response();response.data.source='qwen';
    response.data.objects[0].class_name='workpiece';
    if(mutation==='unknown') response.data.objects[0].class_id=9;
    if(mutation==='name') response.data.objects[0].class_name='renamed';
    if(mutation==='source') response.data.source='mock';
    if(mutation==='old-provider') response.data.source='openai';
    if(mutation==='image') p.read('currentImageIdx=1');
    if(mutation==='existing') p.read('annotations["test.png"]=[{x:42}]');
    if(mutation==='classes') p.read('classes.reverse()');
    p.finish(response);
    assert.equal(p.read('refreshes'),0);
    if(mutation==='existing') assert.equal(p.read('annotations["test.png"][0].x'),42);
    else assert.equal(p.read('annotations["test.png"]'),undefined);
  }
});

test('tainted canvas does not send an image and clears busy state',()=>{
  const p=fixture();
  p.read('document.createElement=()=>({getContext:()=>({fillRect(){},drawImage(){}}),toDataURL(){throw Error("tainted")}})');
  p.begin('ai');
  assert.equal(p.messages.some(m=>m.type==='request'),false);
  assert.ok(p.messages.some(m=>m.type==='done' && m.error));
  assert.equal(p.messages.at(-1).ready,true);
});

test('reference capture sends a downscaled image with class and never writes boxes',()=>{
  const p=fixture();
  p.read('canvas.width=4000;canvas.height=2000;imageCache.get("test.png").naturalWidth=4000;imageCache.get("test.png").naturalHeight=2000;');
  p.begin('reference',{x:0,y:0,width:4000,height:2000});
  const request=p.messages.findLast(m=>m.type==='request');
  assert.equal(request.mode,'reference');
  assert.equal(request.image.input_width,640);
  assert.equal(request.image.input_height,320);
  assert.equal(request.image.class_id,1);
  assert.equal(request.image.class_name,'part');
  assert.deepEqual(JSON.parse(JSON.stringify(request.image.classes)),[{id:0,name:'workpiece'},{id:1,name:'part'}]);
  p.finish({ok:true,data:{ok:true}});
  assert.equal(p.read('annotations["test.png"]'),undefined);
  assert.equal(p.read('refreshes'),0);
  assert.ok(p.messages.some(m=>m.type==='done' && !m.error));
});

test('reference captures only the selected crop region at 640 max side',()=>{
  const p=fixture();
  p.read('canvas.width=4000;canvas.height=2000;imageCache.get("test.png").naturalWidth=4000;imageCache.get("test.png").naturalHeight=2000;');
  p.begin('reference',{x:1000,y:500,width:2000,height:1000});
  const request=p.messages.findLast(m=>m.type==='request');
  assert.equal(request.mode,'reference');
  assert.equal(request.image.input_width,640);
  assert.equal(request.image.input_height,320);
  assert.equal(request.image.class_id,1);
  assert.equal(request.image.class_name,'part');
  assert.deepEqual(p.captures[0].draw.slice(1,5),[1000,500,2000,1000]);
  assert.equal(p.captures[0].source,p.read('imageCache.get("test.png")'));
  p.finish({ok:true,data:{ok:true}});
  assert.equal(p.read('annotations["test.png"]'),undefined);
  assert.equal(p.read('refreshes'),0);
});

test('reference requires a valid in-bounds crop',()=>{
  for(const crop of [undefined,{x:-1,y:0,width:100,height:100},{x:0,y:0,width:0,height:100},
    {x:3900,y:0,width:200,height:100},{x:0,y:0,width:'100',height:100},{x:0,y:0,width:100,height:Infinity}]) {
    const p=fixture();
    p.read('canvas.width=4000;canvas.height=2000;imageCache.get("test.png").naturalWidth=4000;imageCache.get("test.png").naturalHeight=2000;');
    p.begin('reference',crop);
    assert.equal(p.messages.some(m=>m.type==='request'),false);
    assert.ok(p.messages.some(m=>m.type==='done' && m.error));
  }
});

test('reference capture failure reports an error without writing',()=>{
  const p=fixture();
  p.begin('reference',{x:0,y:0,width:1000,height:800});
  p.finish({ok:false,error:'offline'});
  assert.equal(p.read('annotations["test.png"]'),undefined);
  assert.ok(p.messages.some(m=>m.type==='done' && m.error));
});
