import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Canvas,TextLayer,type SceneProps} from './shared';
import {AnatomyDefs,BoneGeometry} from './anatomy';
const smooth=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t)};
// 固定原状曲线；每条连续曲线使用同一个局部位移场，层间厚度不随下陷改变。
const surface=(depth:number,offset=0)=>Array.from({length:101},(_,i)=>{
 const x=150+i*3.3;const y=247+Math.pow((x-315)/165,2)*76+offset;
 const dent=depth*56*Math.exp(-Math.pow((x-315)/80,4));return `${i?'L':'M'}${x.toFixed(2)} ${(y+dent).toFixed(2)}`;
}).join(' ');
const cap=(depth:number)=>`${surface(depth)} ${surface(depth,32).replace('M','L').split('L').filter(Boolean).reverse().map(v=>'L'+v).join(' ')}Z`;
export const Group108=({card,preview=false}:SceneProps)=>{
 const f=useCurrentFrame();const progress=smooth((f/card.durationInFrames-.30)/.39);const inset=smooth((f/card.durationInFrames-.13)/.12);
 return <Canvas><AnatomyDefs/>
 <text x="54" y="69" fill="#527e7b" fontSize="34" fontWeight="600">机制示意 · 非固定病程</text>
 <BoneGeometry/>
 <text x="978" y="168" fill="#527e7b" fontSize="32" fontWeight="600">可能出现局部下陷</text><path d="M961 165 L852 174 L737 227" fill="none" stroke="#71918b" strokeWidth="3"/>
 <g opacity={inset}>
 <circle cx="749" cy="254" r="31" stroke="#71918b" strokeWidth="3" strokeDasharray="5 4" fill="none"/>
 <path d="M717 246 L481 301" stroke="#71918b" strokeWidth="3" strokeDasharray="9 6"/>
 <defs><clipPath id="local108"><circle cx="315" cy="388" r="185"/></clipPath></defs>
 <g clipPath="url(#local108)">
 <rect x="125" y="197" width="380" height="382" fill="#efb08b"/>
 <path d={`${surface(progress,32)} L510 190 L120 190Z`} fill="#fbf4e4"/>
 <path d={cap(progress)} fill="#91c1b8"/>
 <path d={surface(progress,32)} stroke="#fff0cd" strokeWidth="24" fill="none"/>
 <path d={`M158 403 Q224 ${434+progress*20} 314 ${457+progress*24} L332 579 M315 ${360+progress*56} Q291 ${414+progress*28} 314 ${457+progress*24} M477 396 Q397 ${431+progress*20} 314 ${457+progress*24}`} stroke="#ffd9b8" strokeWidth="17" strokeLinecap="round" fill="none"/>
 <path d={`M304 ${297+progress*56} L313 ${311+progress*56} L313 ${326+progress*54} L327 ${345+progress*52}`} stroke="#b36b56" strokeWidth="5" fill="none" strokeLinecap="round"/>
 <rect x="125" y="197" width="380" height="382" filter="url(#paper)" opacity=".10" style={{mixBlendMode:'multiply'}}/>
 </g>
 <path d={surface(0)} stroke="#527e7b" strokeDasharray="9 6" strokeWidth="3" fill="none"/>
 <circle cx="315" cy="388" r="185" fill="none" stroke="#648b86" strokeWidth="4"/>
 <text x="164" y="628" fill="#527e7b" fontSize="30" fontWeight="600">原轮廓（虚线）</text><path d="M246 593 L190 551 L178 300" fill="none" stroke="#71918b" strokeWidth="2"/>
 <text x="147" y="687" fill="#527e7b" fontSize="29">软骨与下方骨层共同下陷</text>
 </g>
 <TextLayer card={card} preview={preview}/><text x="836" y="913" textAnchor="middle" fill="#827b6d" fontSize="19">机制示意 · 这是一种可能的变化，不代表每个人的病程</text>
 </Canvas>;
};
