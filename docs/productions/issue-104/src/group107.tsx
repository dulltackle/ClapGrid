import React from 'react';
import {useCurrentFrame} from 'remotion';
import {AnatomyDefs,BoneGeometry} from './anatomy';
import {Canvas,TextLayer,type SceneProps,palette} from './shared';
// 动作按实际配音帧数归一化；骨架不随细胞标记改变。
const ease=(v:number)=>{const x=Math.max(0,Math.min(1,v));return x*x*(3-2*x)};
const Label=({x,y,children,size=30}:{x:number;y:number;children:React.ReactNode;size?:number})=><text x={x} y={y} fill={palette.ink} fontSize={size} fontWeight="600">{children}</text>;
const Cell=({x,y,inactive=0}:{x:number;y:number;inactive?:number})=><g transform={`translate(${x} ${y}) rotate(-24)`}><ellipse rx="16" ry="23" fill="#ffe3c7" stroke="#c78669" strokeWidth="2"/><ellipse rx="6" ry="10" fill="#bc735d" opacity={1-inactive}/></g>;
// 两个局部采用完全相同骨小梁几何，只有细胞内标记不同。
const CellDetail=({cx,cy,inactive=0}:{cx:number;cy:number;inactive?:number})=><g transform={`translate(${cx} ${cy})`}>
 <defs><clipPath id={`cell-detail-${cx}`}><circle r="112"/></clipPath></defs>
 <g clipPath={`url(#cell-detail-${cx})`}><circle r="112" fill="#fff0cd"/>
 <path d="M-110 -120 Q-68 -40 -98 120 L-34 120 Q-5 14 -42 -120Z M48 -120 Q12 -8 30 120 L91 120 Q75 0 117 -120Z" fill="#efb08b"/>
 <Cell x={-65} y={-52} inactive={inactive}/><Cell x={-57} y={62} inactive={inactive}/><Cell x={73} y={-43} inactive={inactive}/><Cell x={57} y={58} inactive={inactive}/>
 <rect x="-120" y="-120" width="240" height="240" filter="url(#paper)" opacity=".08"/></g><circle r="112" fill="none" stroke={palette.ink} strokeWidth="3"/></g>;
const CellsComparison=({progress}:{progress:number})=><g>
 <CellDetail cx={185} cy={376}/><g opacity={ease(progress*5)}><CellDetail cx={438} cy={376} inactive={1}/></g>
 <Label x={117} y={536}>正常细胞</Label><Label x={349} y={536}>坏死后局部</Label><Label x={136} y={611}>细胞变化，骨架保留</Label>
 <path d="M548 409 L756.32 391.2" stroke={palette.ink} strokeWidth="3" strokeDasharray="8 6" fill="none"/><circle cx="756.32" cy="391.2" r="6" fill={palette.ink}/></g>;
const Vessels=({weaken=0}:{weaken?:number})=><g clipPath="url(#bone)" fill="none" strokeLinecap="round" strokeWidth="5">
 <path d="M1020 656 C990 555 934 453 844 394 S791 311 760 286" stroke="#a56867"/><path d="M812 360 C755 350 736 330 711 309" stroke="#a56867"/>
 <path d="M844 394 C830 343 833 320 834 289" stroke="#a56867" opacity={1-weaken*.78}/>
 <path d="M844 394 C830 343 833 320 834 289" stroke="#a56867" opacity={weaken*.45} strokeDasharray="7 9"/></g>;
const RepairDetail=({progress}:{progress:number})=><g>
 <defs><clipPath id="repair107"><circle cx="310" cy="385" r="185"/></clipPath></defs>
 <g clipPath="url(#repair107)"><circle cx="310" cy="385" r="185" fill="#fff0cd"/>
 <path d="M130 330 Q210 400 310 420 Q410 420 500 290 M230 220 Q245 305 270 360 M360 420 Q400 460 420 580" fill="none" stroke="#efb08b" strokeWidth="46" strokeLinecap="round"/>
 <path d="M199 354 Q235 378 270 384" fill="none" stroke="#fff0cd" strokeWidth={5+ease(progress)*18} strokeLinecap="round"/>
 <path d="M353 406 Q399 377 443 342" fill="none" stroke={palette.newBone} strokeWidth={4+ease(progress)*23} strokeLinecap="round"/>
 <rect x="120" y="195" width="380" height="380" filter="url(#paper)" opacity=".08"/></g><circle cx="310" cy="385" r="185" fill="none" stroke={palette.ink} strokeWidth="3"/>
 <Label x={65} y={166}>不同局部的修复示意</Label><Label x={52} y={621}>旧骨吸收</Label><path d="M160 580 L222 383" stroke={palette.ink} strokeWidth="2" fill="none"/>
 <text x="333" y="621" fill="#826194" fontSize="30" fontWeight="600">新骨形成</text><path d="M425 577 L409 367" stroke="#826194" strokeWidth="2" fill="none"/>
 <path d="M492 304 L811 275" stroke={palette.ink} strokeWidth="3" strokeDasharray="8 6" fill="none"/><circle cx="811" cy="275" r="6" fill={palette.ink}/></g>;
export const Group107=({card,preview=false}:SceneProps)=>{
 const p=useCurrentFrame()/Math.max(1,card.durationInFrames-1);const supply=card.id==='FH05',cells=card.id==='FH06',outline=card.id==='FH07',repair=card.id==='FH08'||card.id==='FH09';
 return <Canvas><AnatomyDefs/><rect width="1672" height="940" fill={palette.background}/><Label x={54} y={69} size={34}>机制示意 · 非固定病程</Label><BoneGeometry/>
 {supply&&<><Vessels weaken={ease((p-.18)/.52)}/><CellDetail cx={310} cy={386} inactive={ease((p-.48)/.35)}/><Label x={200} y={555}>骨架保留</Label><path d="M414 344 L756.32 391.2" stroke={palette.ink} strokeWidth="3" strokeDasharray="8 6" fill="none"/><circle cx="756.32" cy="391.2" r="6" fill={palette.ink}/><Label x={1050} y={164}>血供示意</Label><Label x={1048} y={226}>局部供血减弱</Label><path d="M1032 218 L834 303" stroke={palette.ink} strokeWidth="3" fill="none"/><Label x={144} y={649} size={25}>局部放大 · 机制简化</Label></>}
 {cells&&<><CellsComparison progress={p}/><Label x={1040} y={176}>骨架仍保留</Label><path d="M1023 183 L856 400" stroke={palette.ink} strokeWidth="3" fill="none"/><circle cx="856" cy="400" r="6" fill={palette.ink}/></>}
 {outline&&<><CellsComparison progress={1}/><path d="M582 392 C544 300 582 177 690 140 C767 112 832 157 866 222" fill="none" stroke={palette.ink} strokeWidth="4" opacity={.3+.5*ease(p*3)}/><Label x={1003} y={177}>外形仍可能完整</Label><path d="M987 172 L888 163 L843 181" fill="none" stroke={palette.ink} strokeWidth="3"/><Label x={1040} y={239} size={25}>不等同于痊愈</Label></>}
 {repair&&<><g opacity={card.id==='FH09'?1:ease(p*4)}><RepairDetail progress={card.id==='FH09'?.35+.65*p:.35*p}/></g><Label x={1040} y={176}>局部修复示意</Label><path d="M1023 183 L811 303" fill="none" stroke={palette.ink} strokeWidth="3"/>{card.id==='FH09'&&<g opacity={ease((p-.5)/.25)}><Label x={136} y={735} size={29}>不一定恢复足够支撑</Label></g>}</>}
 <TextLayer card={card} preview={preview}/><text x="836" y="913" textAnchor="middle" fill="#827b6d" fontSize="19">机制示意 · 不代表每个人的病程</text></Canvas>;
};
