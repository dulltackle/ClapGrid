import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Femur,Section,Tissue,Label,Leader,Note,palette,phase,type RevisionProps} from './art';

type Point={x:number;y:number};
// 使用实际生成素材的骨梁位置；范围轮廓仅作机制示意，不表示诊断边界。
const anchors={cell:{x:-133.92265,y:-93.81215},extent:{x:47.2,y:14.8},position:{x:-87.6,y:12.8}};
const at=(point:Point,x:number,y:number,scale:number)=>({x:x+point.x*scale,y:y+point.y*scale});
const TissueWindow=({id,x,y,scale=3,inactive=0}:{id:string;x:number;y:number;scale?:number;inactive?:number})=>{
 const edge='M-88 -47 C-74 -91 -18 -110 36 -92 C94 -74 111 -14 94 39 C81 95 22 112 -35 93 C-96 76 -112 8 -88 -47Z';
 return <g transform={`translate(${x} ${y})`} style={{mixBlendMode:'multiply'}}>
  <defs><clipPath id={`${id}-window`}><path d={edge}/></clipPath></defs>
  <path d={edge} fill={palette.background} stroke="#d5c4ac" strokeWidth={1.8}/>
  <g clipPath={`url(#${id}-window)`}><g transform={`scale(${scale}) translate(${-anchors.cell.x} ${-anchors.cell.y})`}>
   <Tissue inactive={inactive} id={`${id}-same-tissue`}/>
  </g></g>
 </g>;
};

// 不等面积、无阶段箭头；图像只承担机制说明，不代表发生比例。
export const OutroScenes=({card}:RevisionProps)=>{
 const frame=useCurrentFrame();
 const prefix=card.id.replace(/[^A-Za-z0-9_-]/g,'-');
 const p=Math.max(0,Math.min(1,frame/Math.max(1,card.durationInFrames-1)));
 if(card.id.startsWith('FH13')){
  const arrive=phase(p,.19,.60);
  return <g>
   <Label x={130} y={135} size={46} weight={500}>不一定都会塌陷</Label>
   <Femur x={536-28*arrive} y={267} scale={.60+.02*arrive}/>
   <Label x={325} y={676} size={30} weight={500}>仍可能保持完整</Label>
   <g transform={`translate(${1160+120*(1-arrive)} 438) scale(.78)`} opacity={.28+.72*arrive}>
    <Section sink={49} outline id={`${prefix}-possible-local`}/>
   </g>
   <Label x={1030} y={676} size={29} weight={500}>也可能局部下陷</Label>
   <Note x={977} y={715} width={540}>图形大小不表示发生比例</Note>
   <Note x={283} y={715} width={550}>保持完整不等于痊愈</Note>
  </g>;
 }
 if(card.id.startsWith('FH14')){
  const show=phase(p,.20,.58);
  const focus=phase(p,.52,.80);
  const x=815-36*focus;const y=355;const scale=1.10;
  const extent=at(anchors.extent,x,y,scale);const position=at(anchors.position,x,y,scale);
  return <g>
   <Label x={130} y={135} size={44} weight={500}>范围与位置，都影响进展</Label>
   <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <Section id={`${prefix}-local-extent`}/>
    <path d="M10 -42 Q50 -51 86 -16 Q99 20 75 48 Q44 77 3 61 Q-14 23 10 -42Z" fill="none" stroke={palette.ink} strokeOpacity={.24+.28*show} strokeWidth={2} strokeDasharray="7 8" strokeDashoffset={26*(1-show)} strokeLinecap="round"/>
    <ellipse cx={anchors.position.x} cy={anchors.position.y} rx={30} ry={29} fill="none" stroke={palette.ink} strokeOpacity={.30+.2*focus} strokeWidth={1.8} strokeDasharray="7 8" strokeDashoffset={-23*focus}/>
   </g>
   <Label x={260} y={328} size={33} weight={500}>受损范围</Label>
   <Leader d={`M422 316 Q510 335 ${extent.x} ${extent.y}`}/>
   <Label x={1245} y={531} size={33} weight={500}>位置</Label>
   <Leader d={`M1225 518 Q1110 485 ${position.x} ${position.y}`}/>
   <Note x={420} y={715} width={824}>这是机制概括，不用于分期或诊断</Note>
  </g>;
 }
 if(card.id.startsWith('FH15')){
  const change=phase(p,.20,.70);
  const x=915+12*change;const scale=1.30+.10*change;
  const cell=at(anchors.cell,x,425,scale);
  return <g>
   <Label x={130} y={135} size={46} weight={500}>坏死：骨组织死亡</Label>
   <g transform={`translate(${x} 425) scale(${scale})`}>
    <Tissue inactive={change} id={`${prefix}-cells-in-bone`}/>
   </g>
   <Label x={195} y={255} size={29} weight={500}>细胞状态改变</Label>
   <TissueWindow id={`${prefix}-cell-detail`} x={285} y={425} scale={2.75+.40*change} inactive={change}/>
   <Leader d={`M380 420 Q521 367 ${cell.x} ${cell.y}`}/>
   <Label x={285} y={586} anchor="middle" size={26} color={palette.muted} weight={500}>组织局部放大</Label>
   <Label x={1150} y={675} size={29} weight={500}>骨梁仍保留</Label>
   <Note x={443} y={715} width={830}>骨组织死亡，不等于原有骨架马上消失</Note>
  </g>;
 }
 if(card.id.startsWith('FH16')){
  const settle=phase(p,.22,.72);
  const rightX=1136-28*settle;
  return <g>
   <Label x={130} y={135} size={44} weight={500}>坏死与塌陷，说的是不同变化</Label>
   <g transform="translate(434 398) scale(.77)">
    <Tissue inactive={1} id={`${prefix}-tissue-summary`}/>
   </g>
   <Label x={253} y={613} size={30} weight={500}>坏死：骨组织死亡</Label>
   <Note x={237} y={714} width={535}>骨架不一定马上消失</Note>
   <g transform={`translate(${rightX} 390) scale(1.08)`}>
    <Section sink={54*settle} outline id={`${prefix}-surface-summary`}/>
   </g>
   <Label x={866} y={715} size={29} weight={500}>塌陷：支撑失效后的外形改变</Label>
   <Label x={1285} y={212} size={25} color={palette.muted} weight={500}>原轮廓</Label>
  </g>;
 }
 throw new Error(`OutroScenes不负责制作卡 ${card.id}`);
};
