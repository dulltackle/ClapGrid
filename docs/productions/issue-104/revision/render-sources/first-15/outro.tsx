import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Femur,Section,Tissue,Label,Leader,Note,palette,phase,type RevisionProps} from './art';

// 结尾依次换取景，不把两种可能画成比例图或必经病程。
export const OutroScenes=({card}:RevisionProps)=>{
 const f=useCurrentFrame();const p=f/Math.max(1,card.durationInFrames-1);
 if(card.id==='FH13'){
  const arrive=phase(p,.19,.51);
  return <g><Label x={94} y={157} size={49}>不一定都会塌陷</Label>
   <Femur x={536-28*arrive} y={304} scale={.70}/>
   <Label x={325} y={690} size={31}>仍可能保持完整</Label>
   <g transform={`translate(${1160+160*(1-arrive)} ${438}) scale(.82)`} opacity={arrive}><Section sink={49} outline id="FH13-possible-local"/></g>
   <Label x={1031} y={679} size={29}>也可能局部下陷</Label>
   <Note x={986} y={733} width={529}>图形大小不表示发生比例</Note>
   <Note x={303} y={735} width={500}>保持完整不等于痊愈</Note>
  </g>;
 }
 if(card.id==='FH14'){
  const show=phase(p,.20,.55);const focus=phase(p,.52,.80);
  return <g><Label x={94} y={157} size={45}>范围与位置，都影响进展</Label>
   <g transform={`translate(${823-65*focus} ${420}) scale(1.05)`}><Section id="FH14-local-extent"/>
    <path d="M-124 -92 Q-65 -143 -6 -73 L13 33 Q-49 85 -107 25Z" fill="#a78c8c" fillOpacity={.12+.1*show} stroke="#ab8880" strokeWidth="3" strokeDasharray="8 7" strokeDashoffset={32*(1-show)}/>
    <ellipse cx="117" cy="128" rx="37" ry="32" fill="#a78c8c" fillOpacity=".13" stroke="#ab8880" strokeWidth="2.7" strokeDasharray="8 7" strokeDashoffset={-31*focus}/>
   </g>
   <Label x={278} y={334} size={37}>受损范围</Label><Leader d={`M441 322 Q573 316 ${823-65*focus-65*1.05} ${420-39*1.05}`}/>
   <Label x={1248} y={582} size={37}>位置</Label><Leader d={`M1227 570 Q1103 580 ${823-65*focus+117*1.05} ${420+128*1.05}`}/>
   <Note x={383} y={735} width={862}>机制概括 · 不用于分期或诊断</Note>
  </g>;
 }
 if(card.id==='FH15'){
  const change=phase(p,.20,.66);
  return <g><Label x={94} y={157} size={48}>坏死：骨组织死亡</Label>
   <g transform={`translate(${893+14*change} 435) scale(${1.28+.08*change})`}><Tissue inactive={change} id="FH15-cells-in-bone"/></g>
   <Label x={218} y={344} size={32}>细胞状态改变</Label><Leader d="M463 334 Q573 347 694 390"/>
   <Note x={524} y={735} width={714}>骨组织是活的，原有骨架不会马上消失</Note>
  </g>;
 }
 const settle=phase(p,.26,.72);
 return <g><Label x={94} y={157} size={48}>坏死与塌陷，说的是不同变化</Label>
  <g transform="translate(449 408) scale(.73)"><Tissue inactive={1} id="FH16-tissue-summary"/></g>
  <Label x={273} y={617} size={32}>坏死：骨组织死亡</Label>
  <g transform={`translate(${1118-24*settle} 440) scale(1.02)`}><Section sink={54*settle} outline id="FH16-surface-summary"/></g>
  <Label x={881} y={733} size={30}>塌陷：支撑失效后的外形改变</Label>
  <Leader d={`M${1118-24*settle} ${440-176*1.02} Q1180 246 1284 207`}/><Label x={1293} y={214} size={24} color={palette.muted}>原轮廓</Label>
 </g>;
};
