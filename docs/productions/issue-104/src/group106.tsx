import React from 'react';
import {useCurrentFrame} from 'remotion';
import {AnatomyDefs,BoneGeometry} from './anatomy';
import {Canvas,TextLayer,palette,type SceneProps} from './shared';

const ease=(x:number)=>{const v=Math.min(1,Math.max(0,x));return v*v*(3-2*v)};
const ink=palette.ink;
const Label=({x,y,children,size=32}:{x:number;y:number;children:React.ReactNode;size?:number})=><text x={x} y={y} fill={ink} fontSize={size} fontWeight="600">{children}</text>;
const Leader=({path,x,y}:{path:string;x:number;y:number})=><g fill="none" stroke={ink} strokeWidth="3"><path d={path}/><circle cx={x} cy={y} r="5" fill={ink}/></g>;

// 全组保持相同骨几何和摄像构图。定位/结构无裂隙，无病灶或塌陷。
export const Group106=({card,preview=false}:SceneProps)=>{
 const frame=useCurrentFrame();
 const t=frame/Math.max(1,card.durationInFrames-1);
 const appear=(start:number)=>ease((t-start)/.12);
 return <Canvas>
  <AnatomyDefs/>
  <rect width="1672" height="940" fill={palette.background}/>
  <BoneGeometry/>
  <g id="structure-text-layer"><Label x={54} y={69} size={34}>成人股骨头 · 机制示意</Label></g>
  {card.id==='FH01' && <g id="opening-question" opacity={appear(.02)}>
   <Label x={115} y={260} size={44}>股骨头坏死</Label>
   <Label x={115} y={340} size={36}>为什么可能塌陷？</Label>
   <path d="M600 208 C639 153 706 128 762 143" fill="none" stroke={ink} strokeWidth="3" strokeDasharray="7 7"/>
  </g>}
  {card.id==='FH02' && <g id="head-location" opacity={appear(.04)}>
   <Label x={208} y={245} size={42}>股骨头</Label>
   <Label x={160} y={298} size={28}>大腿骨顶端的球形部分</Label>
   <Leader path="M462 240 L533 240 L650 245" x={650} y={245}/>
   <ellipse cx="720" cy="271" rx="143" ry="146" fill="none" stroke={ink} strokeWidth="3" strokeDasharray="8 7"/>
  </g>}
  {card.id==='FH03' && <g id="three-layer-labels">
   <g opacity={appear(.03)}><Label x={256} y={221}>软骨</Label><Leader path="M404 213 L546 213 L685 200" x={685} y={200}/></g>
   <g opacity={appear(.17)}><Label x={224} y={324}>软骨下骨层</Label><Leader path="M434 316 L548 316 L680 278" x={680} y={278}/></g>
   <g opacity={appear(.31)}><Label x={224} y={449}>内部骨小梁</Label><Leader path="M434 441 L625 441 L756.32 391.2" x={756.32} y={391.2}/></g>
   <text x="250" y="560" fill="#827b6d" fontSize="26">颜色与厚度为示意</text>
  </g>}
  {card.id==='FH04' && <g id="blood-supply">
   <g clipPath="url(#bone)" opacity={appear(.04)} fill="none" stroke="#a56867" strokeWidth="5" strokeLinecap="round">
    <path d="M1020 656 C990 555 934 453 844 394 S791 311 760 286"/>
    <path d="M844 394 C830 343 833 320 834 289"/>
    <path d="M812 360 C755 350 736 330 711 309"/>
    <path d="M1020 656 C990 555 934 453 844 394 S791 311 760 286" stroke="#d7a182" strokeWidth="4" strokeDasharray="14 60" strokeDashoffset={-frame*2}/>
   </g>
   <g opacity={appear(.08)}><Label x={184} y={278}>血液供给</Label><Leader path="M376 270 L516 270 L711 309" x={711} y={309}/></g>
   <g opacity={appear(.24)}><Label x={184} y={414} size={37}>氧气与营养</Label></g>
   <text x="184" y="497" fill="#827b6d" fontSize="25">供血路径为机制概括</text>
  </g>}
  <TextLayer card={card} preview={preview}/>
  <text x="836" y="913" textAnchor="middle" fill="#827b6d" fontSize="19">机制示意 · 结构颜色与厚度为示意</text>
 </Canvas>;
};
