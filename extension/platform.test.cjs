const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function fixture() {
  const messages=[];let listener;
  const window={postMessage:data=>messages.push(data),addEventListener:(type,fn)=>{listener=fn;}};
  const context=vm.createContext({window,location:{origin:'https://www.threetone.com.cn',pathname:'/train/annotation/demo/editor'},setTimeout,clearTimeout});
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
  const begin=()=>send({type:'begin',requestId:'request-1'});
  const finish=(value=response())=>send({type:'result',requestId:'request-1',response:value});
  return {context,messages,send,begin,finish,response,read:code=>vm.runInContext(code,context)};
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
