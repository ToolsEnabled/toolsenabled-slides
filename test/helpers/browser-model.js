'use strict';
// Synthetic timing and media scenarios, independent of any personal deck.
const order=['s1','s15','s2','s3','s4','s5','s6','s7','s8','s9','s10','s12','s13','s11','s14','s16','qa'];
const seconds=[30,45,45,55,45,45,40,45,55,50,45,55,45,45,35,5];
function browserModel(){
 const slides=order.map((id,i)=>({id,layout:'title',notes:i===16?'[untimed]':`[~${seconds[i]}s]`,elements:[{id:'title-'+id,type:'title',text:'Slide '+(i+1),box:{x:.05,y:.05,w:.8,h:.15}}],decor:[{id:'dec-'+id,kind:'shape',generated:true,sid:null,shapeType:'rect',fill:'#2563eb',box:{x:.05,y:.8,w:.8,h:.02}}]}));
 const box={x:.6975,y:.552,w:.195,h:.231};const video=slides.find(s=>s.id==='s8');
 video.decor.push({id:'poster',kind:'pic',generated:true,sid:null,source:'assets/fixture.png',box});
 video.decor.push({id:'d563324be',kind:'media',generated:true,sid:null,source:'assets/fixture.mp4',box,autoplay:false,loop:false});
 const pipeline=slides.find(s=>s.id==='s3');pipeline.animations=[];
 for(let i=0;i<12;i++){
  const id='pipeline-'+i;
  pipeline.decor.push({id,kind:'shape',generated:true,sid:null,shapeType:'rect',fill:'#2563eb',box:{x:.05+(i%4)*.22,y:.3+Math.floor(i/4)*.17,w:.16,h:.1}});
  pipeline.animations.push({targetId:id,effect:'fade',trigger:[0,3,6,8,10].includes(i)?'click':'with-previous',duration:.45,delay:0});
 }
 return {title:'Synthetic browser scenarios',rev:0,theme:{accent:'#2563eb'},slides};
}
module.exports={browserModel,order,seconds};
