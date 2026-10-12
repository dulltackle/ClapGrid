import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Femur, FlowTree, Label, Note, Section, Tissue, palette, phase} from './art';
import type {RevisionProps} from './art';

// 所有动作只取本段帧；末尾停止镜头，供总框架提取完整末画面转场。
const DrawLine=({d,progress,color=palette.ink,width=2.6}:{d:string;progress:number;color?:string;width?:number})=><path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1-progress} opacity={progress>0?1:0}/>;

export const IntroScenes=({card}:RevisionProps)=>{
 const frame=useCurrentFrame();
 const p=Math.max(0,Math.min(1,frame/Math.max(1,card.durationInFrames-1)));
 const motion=phase(p,.1,.7);
 if(card.id==='FH01')return <g id="revision-FH01-intro">
  <Label x={170} y={150} size={48}>股骨头坏死</Label>
  <g transform={`translate(${34*(1-motion)} 0)`}>
   <Label x={170} y={310} size={62}>为什么可能</Label>
   <Label x={170} y={395} size={62}>塌陷？</Label>
   <DrawLine d="M175 429 Q340 448 537 426" progress={phase(p,.26,.64)} color={palette.cartilage} width={9}/>
  </g>
  <Femur x={1120-150*motion} y={330-20*motion} scale={.62+.20*motion} rotate={-8+8*motion}>
   <DrawLine d="M-174 -12 C-166 -110 -75 -165 25 -150 C88 -142 129 -105 145 -57" progress={phase(p,.25,.7)} color="#d6e6d8" width={6}/>
  </Femur>
  <Note x={170} y={685} width={330}>从结构与支撑说起</Note>
 </g>;

 if(card.id==='FH02'){
  const locate=phase(p,.15,.46);
  const close=phase(p,.36,.76);
  const headX=417.2,headY=241.4;
  const insetX=1220-100*close;
  return <g id="revision-FH02-location">
   <defs><clipPath id="revision-FH02-head-close"><circle cx={insetX} cy={430} r={224}/></clipPath></defs>
   <Label x={170} y={150} size={48}>股骨头在哪里？</Label>
   {/* 完整股骨为定位轮廓；右侧放大局部沿用共同结构，不冒称真实解剖比例。 */}
   <g transform="translate(455 245) scale(.9)" filter="url(#revision-grain)">
    <path d="M-55 -75 C-112 -51 -112 34 -56 62 C-25 80 11 58 38 43 L79 77 C96 118 102 238 91 342 C80 432 77 477 54 518 C39 544 51 563 77 555 L102 542 C123 562 150 558 157 542 C168 523 138 493 133 469 C116 354 139 217 139 131 C142 91 157 57 146 19 C139 -10 112 -25 95 -10 C78 4 79 25 62 26 L32 1 C28 -39 -6 -77 -55 -75Z" fill="url(#bone-wash)"/>
    <path d="M-101 -26 C-101 -64 -74 -86 -43 -84 C-5 -84 23 -57 28 -26 C5 -45 -17 -58 -45 -55 C-72 -52 -89 -41 -101 -26Z" fill="url(#cartilage-wash)"/>
    <path d="M106 120 Q111 324 102 457" stroke="url(#beam-wash)" strokeWidth={23} strokeLinecap="round" fill="none" opacity={.72}/>
   </g>
   <circle cx={headX} cy={headY} r={83+7*(1-locate)} fill="none" stroke={palette.ink} strokeWidth={3.3} pathLength={1} strokeDasharray="1" strokeDashoffset={1-locate} transform={`rotate(-90 ${headX} ${headY})`} opacity={locate>0?.85:0}/>
   <DrawLine d={`M${headX+83} ${headY} C675 223 752 280 ${insetX-209} 354`} progress={close} color={palette.muted}/>
   <g opacity={close}>
    <circle cx={insetX} cy={430} r={228} fill="#f7eedc" filter="url(#paper-shadow)"/>
    <g clipPath="url(#revision-FH02-head-close)">
     <Femur x={insetX+14} y={438} scale={1.25+.14*close}/>
    </g>
    <circle cx={insetX} cy={430} r={224} fill="none" stroke="#e6d8c0" strokeWidth={3}/>
    <Label x={insetX} y={710} size={40} anchor="middle">股骨头</Label>
   </g>
   <Label x={170} y={590} size={30}>大腿骨顶端</Label>
   <Label x={170} y={635} size={30}>的球形部分</Label>
   <Note x={170} y={730} width={315}>位置与比例为示意</Note>
  </g>;
 }

 if(card.id==='FH03'){
  const scale=.84+.32*motion;
  const x=1130-80*motion,y=450;
  const cartilage=phase(p,.16,.38),subchondral=phase(p,.35,.56),beam=phase(p,.53,.76);
  // 端点随镜头移动；第三条落在真实骨梁(-140,40)，不是骨髓间隙。
  const point=(localX:number,localY:number)=>`${x+localX*scale} ${y+localY*scale}`;
  return <g id="revision-FH03-layers">
   <Label x={170} y={150} size={48}>关节面的分层结构</Label>
   <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <Section id="revision-FH03-section"/>
    <DrawLine d="M-158 -121 Q-74 -175 26 -170 Q110 -163 164 -116" progress={cartilage} color="#cce2d3" width={5}/>
   </g>
   <g transform={`translate(${-22*(1-cartilage)} 0)`} opacity={cartilage}>
    <Label x={170} y={260} size={35}>软骨</Label>
   </g>
   <DrawLine d={`M335 251 L690 251 Q790 247 ${point(0,-161)}`} progress={cartilage}/>
   <g transform={`translate(${-22*(1-subchondral)} 0)`} opacity={subchondral}>
    <Label x={170} y={360} size={35}>软骨下骨层</Label>
   </g>
   <DrawLine d={`M410 351 L682 351 Q806 341 ${point(0,-135)}`} progress={subchondral}/>
   <g transform={`translate(${-22*(1-beam)} 0)`} opacity={beam}>
    <Label x={170} y={510} size={35}>内部骨小梁</Label>
   </g>
   <DrawLine d={`M410 501 L678 501 Q760 504 ${point(-140,40)}`} progress={beam}/>
   <Note x={170} y={730} width={360}>颜色与厚度为示意</Note>
  </g>;
 }

 if(card.id==='FH04'){
  const supply=phase(p,.15,.46),close=phase(p,.24,.74);
  const tissueX=1185-85*close,tissueY=435,tissueScale=.98+.32*close;
  // 供给路径与根组件血流同色。动画停在末尾，保持组织和骨梁完整。
  const flowFrame=Math.max(0,Math.min(frame,Math.floor((card.durationInFrames-1)*.85))-Math.floor(card.durationInFrames*.12));
  return <g id="revision-FH04-supply">
   <Label x={170} y={150} size={48}>骨组织也需要供给</Label>
   <Femur x={328} y={365} scale={.48} rotate={-5}>
    <g opacity={supply}><FlowTree frame={flowFrame}/></g>
   </Femur>
   <DrawLine d={`M528 472 C690 480 720 340 ${tissueX-240*tissueScale} 365`} progress={close} color={palette.muted}/>
   <g transform={`translate(${tissueX} ${tissueY}) scale(${tissueScale})`}>
    <Tissue id="revision-FH04-tissue"/>
    <g opacity={supply} clipPath="url(#revision-FH04-tissue)" fill="none" strokeLinecap="round" strokeLinejoin="round">
     <path d="M-267 100 C-169 111 -154 57 -121 40 C-40 -2 9 -45 63 -47 S169 -25 254 -55 M-121 40 C-125 -19 -183 -72 -244 -71 M63 -47 C49 29 83 77 140 112" stroke="#b9776f" strokeWidth={7}/>
     <path d="M-267 100 C-169 111 -154 57 -121 40 C-40 -2 9 -45 63 -47 S169 -25 254 -55" stroke="#f6d6b0" strokeWidth={5} strokeDasharray="19 61" strokeDashoffset={-flowFrame*3}/>
     <path d="M63 -47 C49 29 83 77 140 112" stroke="#f6d6b0" strokeWidth={4} strokeDasharray="12 43" strokeDashoffset={-flowFrame*2.6}/>
    </g>
   </g>
   <Label x={170} y={630} size={32}>血液供给</Label>
   <g transform={`translate(${35*(1-supply)} 0)`} opacity={supply}>
    <Label x={tissueX} y={710} size={40} anchor="middle">氧气与营养</Label>
   </g>
   <Note x={170} y={730} width={365}>供血路径为机制概括</Note>
  </g>;
 }
 return <g/>;
};
