import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Femur, FullFemur, FlowTree, Label, Note, Section, Tissue, palette, phase} from './art';
import type {RevisionProps} from './art';

// 所有动作只取本段帧；末尾停止镜头，供总框架提取完整末画面转场。
const DrawLine=({d,progress,color=palette.ink,width=2.6}:{d:string;progress:number;color?:string;width?:number})=><path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1-progress} opacity={progress>0?1:0}/>;

export const IntroScenes=({card}:RevisionProps)=>{
 const frame=useCurrentFrame();
 const p=Math.max(0,Math.min(1,frame/Math.max(1,card.durationInFrames-1)));
 const motion=phase(p,.1,.7);
 if(card.id==='FH01')return <g id="revision-v3-FH01-intro">
  <Label x={170} y={150} size={48}>股骨头坏死</Label>
  <g transform={`translate(${34*(1-motion)} 0)`}>
   <Label x={170} y={310} size={62}>为什么可能</Label>
   <Label x={170} y={395} size={62}>塌陷？</Label>
   <DrawLine d="M175 429 Q340 448 537 426" progress={phase(p,.26,.64)} color={palette.cartilage} width={9}/>
  </g>
  <Femur x={1120-150*motion} y={330-20*motion} scale={.55+.14*motion} rotate={-8+8*motion}/>
  <Note x={170} y={685} width={330}>从结构与支撑说起</Note>
 </g>;

 if(card.id==='FH02'){
  const locate=phase(p,.15,.46);
  const close=phase(p,.36,.76);
  const headX=435+22*(1-motion),headY=220+15*(1-motion);
  const overviewScale=.78+.06*motion;
  const ringRadius=(34+9*(1-locate))*overviewScale;
  const insetX=1220-100*close;
  return <g id="revision-v3-FH02-location">
   <defs><clipPath id="revision-v3-FH02-head-close"><circle cx={insetX} cy={430} r={224}/></clipPath></defs>
   <Label x={170} y={150} size={48}>股骨头在哪里？</Label>
   {/* 整骨与头部放大来自同一生图；归一化头中心(0,0)、半径约34。 */}
   <FullFemur x={headX} y={headY} scale={overviewScale}/>
   <circle cx={headX} cy={headY} r={ringRadius} fill="none" stroke={palette.ink} strokeWidth={2.8} pathLength={1} strokeDasharray="1" strokeDashoffset={1-locate} transform={`rotate(-90 ${headX} ${headY})`} opacity={locate>0?.8:0}/>
   <DrawLine d={`M${headX} ${headY} C680 ${headY-5} 768 272 ${insetX-209} 354`} progress={close} color={palette.muted}/>
   <g opacity={close}>
    <circle cx={insetX} cy={430} r={228} fill="#f7eedc" filter="url(#paper-shadow)"/>
    <g clipPath="url(#revision-v3-FH02-head-close)" style={{mixBlendMode:'multiply'}}>
     <FullFemur x={insetX} y={430} scale={5.6+.35*close}/>
    </g>
    <circle cx={insetX} cy={430} r={224} fill="none" stroke="#e6d8c0" strokeWidth={2}/>
    <Label x={insetX} y={710} size={40} anchor="middle">股骨头</Label>
   </g>
   <Label x={170} y={590} size={30}>大腿骨顶端</Label>
   <Label x={170} y={635} size={30}>的球形部分</Label>
   <Note x={145} y={730} width={315}>位置与比例为示意</Note>
  </g>;
 }

 if(card.id==='FH03'){
  const scale=.84+.32*motion;
  const x=1130-80*motion,y=450;
  const cartilage=phase(p,.16,.38),subchondral=phase(p,.35,.56),beam=phase(p,.53,.76);
  // 端点随镜头移动，分别对准同一生图的软骨、薄软骨下骨层和粗骨梁。
  const point=(localX:number,localY:number)=>`${x+localX*scale} ${y+localY*scale}`;
  return <g id="revision-v3-FH03-layers">
   <Label x={170} y={150} size={48}>关节面的分层结构</Label>
   <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <Section id="revision-v3-FH03-section"/>
   </g>
   <g transform={`translate(${-22*(1-cartilage)} 0)`} opacity={cartilage}>
    <Label x={170} y={260} size={35}>软骨</Label>
   </g>
   <DrawLine d={`M335 251 L690 251 Q790 247 ${point(0,-135.2)}`} progress={cartilage}/>
   <g transform={`translate(${-22*(1-subchondral)} 0)`} opacity={subchondral}>
    <Label x={170} y={360} size={35}>软骨下骨层</Label>
   </g>
   <DrawLine d={`M410 351 L682 351 Q806 341 ${point(0,-77.2)}`} progress={subchondral}/>
   <g transform={`translate(${-22*(1-beam)} 0)`} opacity={beam}>
    <Label x={170} y={510} size={35}>内部骨小梁</Label>
   </g>
   <DrawLine d={`M410 501 L678 501 Q760 504 ${point(47.2,14.8)}`} progress={beam}/>
   <Note x={170} y={730} width={360}>颜色与厚度为示意</Note>
  </g>;
 }

 if(card.id==='FH04'){
  const supply=phase(p,.15,.46),close=phase(p,.24,.74);
  const tissueX=1185-85*close,tissueY=435,tissueScale=.98+.32*close;
  // 供给路径与根组件血流同色。动画停在末尾，保持组织和骨梁完整。
  const flowFrame=Math.max(0,Math.min(frame,Math.floor((card.durationInFrames-1)*.85))-Math.floor(card.durationInFrames*.12));
  return <g id="revision-v3-FH04-supply">
   <Label x={170} y={150} size={48}>骨组织也需要供给</Label>
   <Femur x={328} y={365} scale={.48} rotate={-5}>
    <g opacity={supply}><FlowTree frame={flowFrame}/></g>
   </Femur>
   <DrawLine d={`M528 472 C690 480 720 340 ${tissueX-240*tissueScale} 365`} progress={close} color={palette.muted}/>
   <g transform={`translate(${tissueX} ${tissueY}) scale(${tissueScale})`}>
    <Tissue id="revision-v3-FH04-tissue"/>
    <g opacity={supply} clipPath="url(#revision-v3-FH04-tissue)" fill="none" strokeLinecap="round" strokeLinejoin="round">
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
