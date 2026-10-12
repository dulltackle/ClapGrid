import React from 'react';
import {Img,staticFile} from 'remotion';
import {AnatomyDefs} from '../src/anatomy';
import type {SceneProps} from '../src/shared';

export type RevisionProps = SceneProps;
export const palette={background:'#fbf4e4',ink:'#476f6b',muted:'#8c8273',cartilage:'#91c1b8',subchondral:'#fff0cd',bone:'#efb08b',trabecula:'#ffd9b8',newBone:'#a886b6'};
export const ease=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t)};
export const phase=(p:number,start:number,end:number)=>ease((p-start)/(end-start));

// 同一纸纹、柔和色洗和圆润端点用于骨结构与所有动作层；纹理不随帧变化。
export const ArtDefs=()=> <><AnatomyDefs/><defs>
 <linearGradient id="bone-wash" x1="0" y1="0" x2=".85" y2="1"><stop stopColor="#ffcfaa"/><stop offset=".48" stopColor="#f1b18a"/><stop offset="1" stopColor="#df9275"/></linearGradient>
 <linearGradient id="cartilage-wash" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#a8d2c7"/><stop offset=".6" stopColor="#8dbdb2"/><stop offset="1" stopColor="#77aaa2"/></linearGradient>
 <linearGradient id="beam-wash" x1="0" y1="0" x2=".9" y2="1"><stop stopColor="#ffead0"/><stop offset="1" stopColor="#f8c99f"/></linearGradient>
 <linearGradient id="marrow-wash" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#edab86"/><stop offset="1" stopColor="#cf7d65"/></linearGradient>
 <linearGradient id="violet-wash" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#c6afd0"/><stop offset="1" stopColor="#a282b1"/></linearGradient>
 <filter id="revision-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".12" numOctaves="3" seed="17" result="noise"/><feColorMatrix in="noise" type="saturate" values="0"/><feComponentTransfer result="washed"><feFuncA type="linear" slope=".11"/></feComponentTransfer><feComposite in="washed" in2="SourceAlpha" operator="in" result="clipped"/><feBlend in="SourceGraphic" in2="clipped" mode="soft-light"/></filter>
 <filter id="paper-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#8b745a" floodOpacity=".09"/></filter>
 </defs>
 <style>{`.art-femur [fill="#efb08b"]{fill:url(#bone-wash)}.art-femur [fill="#91c1b8"]{fill:url(#cartilage-wash)}.art-femur [fill="#dc896d"]{fill:url(#marrow-wash)}.art-femur [stroke="#ffd9b8"]{stroke:url(#beam-wash);stroke-width:24}.art-femur [stroke="#fff0cd"]{stroke-width:34}`}</style>
 </>;

export const Label=({x,y,size=32,children,anchor='start',color=palette.ink,weight=600}:{x:number;y:number;size?:number;children:React.ReactNode;anchor?:'start'|'middle'|'end';color?:string;weight?:number})=><text x={x} y={y} textAnchor={anchor} fill={color} fontSize={size} fontWeight={weight} letterSpacing="1">{children}</text>;
export const Leader=({d,color=palette.ink}:{d:string;color?:string})=><path d={d} stroke={color} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>;
export const Note=({x,y,width=400,children}:{x:number;y:number;width?:number;children:React.ReactNode})=><g transform={`translate(${x} ${y})`}><path d={`M0 -32 Q${width*.4} -39 ${width} -31 L${width-9} 14 Q${width*.55} 9 3 16Z`} fill="#f1e6d2" opacity=".76"/><Label x={16} y={0} size={25} color={palette.muted} weight={500}>{children}</Label></g>;

// 生图原件只在合成中缩放、正片叠底；三个层级都沿同一水彩风格参照链。
export const artworkFiles=['full-femur-v03.png','proximal-v01.png','section-v01.png','tissue-v01.png','tissue-repair-v01.png'];
export const Femur=({x,y,scale=1,rotate=0,children}:{x:number;y:number;scale?:number;rotate?:number;children?:React.ReactNode})=><g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
 <image href={staticFile('artwork-v3/proximal-v01.png')} x={-365*.6} y={-315*.6} width={1145*.6} height={1374*.6} style={{mixBlendMode:'multiply'}}/>
 {children}</g>;

// 下陷采用同一连续位移场作用于整个剖面原件，软骨和其下骨层不会分离。
// 位移随横向距离衰减，底部固定；原轮廓对照位于变形层之外。
const outlinePath='M-218.8 -3.2 C-203 -78 -142 -139 -98.8 -158.8 C-43 -185 43 -181 101.2 -159.2 C166 -130 203 -65 219.6 5.6';
const displacementMap=(sink:number)=>{
 const stops=Array.from({length:520},(_,i)=>{
  const x=-260+i+.5;const top=-176*Math.sqrt(Math.max(0,1-(x/230)**2));
  const dy=Math.max(0,Math.min(58,sink))*Math.exp(-Math.pow(x/72,4));
  const delta=(y:number)=>dy/(280-top-dy)*(y-280);
  const green=(y:number)=>Math.max(0,Math.min(255,Math.round(127.5+255*delta(y)/256)));
  return `<linearGradient id="g${i}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="rgb(128,${green(-220)},128)"/><stop offset="1" stop-color="rgb(128,${green(320)},128)"/></linearGradient>`;
 }).join('');
 const bars=Array.from({length:520},(_,i)=>`<rect x="${-260+i}" y="-220" width="1.02" height="540" fill="url(#g${i})"/>`).join('');
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-260 -220 520 540"><defs>${stops}</defs>${bars}</svg>`);
};
export const Section=({sink=0,outline=false,children,id='section'}:{sink?:number;outline?:boolean;children?:React.ReactNode;id?:string})=>{
 const filterId=`${id}-surface-warp`;
 const field=sink>0?displacementMap(sink):null;
 return <g>{field&&<foreignObject x={-10000} y={-10000} width={1} height={1}><Img src={field} style={{width:1,height:1,opacity:0}}/></foreignObject>}<defs>{sink>0&&<filter id={filterId} x={-260} y={-220} width={520} height={540} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
  <feImage href={field!} x={-260} y={-220} width={520} height={540} preserveAspectRatio="none" result="field"/>
  <feGaussianBlur in="field" stdDeviation={1.2} result="smooth-field"/>
  <feDisplacementMap in="SourceGraphic" in2="smooth-field" scale={256} xChannelSelector="R" yChannelSelector="G"/>
 </filter>}</defs>
 <g filter={sink>0?`url(#${filterId})`:undefined} style={{mixBlendMode:'multiply'}}>
  <image href={staticFile('artwork-v3/section-v01.png')} x={-250.8} y={-199.2} width={501.6} height={501.6}/>
 </g>
 {outline&&<path d={outlinePath} fill="none" stroke={palette.ink} strokeWidth={2.2} strokeDasharray="7 8" opacity={.55} strokeLinecap="round"/>}
 {children}</g>;
};

const Cell=({x,y,inactive=0}:{x:number;y:number;inactive?:number})=><g transform={`translate(${x} ${y}) rotate(-27)`} filter="url(#revision-grain)"><ellipse rx={9} ry={13} fill="#fbe6cc" stroke="#c58c74" strokeWidth={1.2}/><ellipse rx={3.2} ry={4.8} fill="#be816c" opacity={1-inactive*.86}/></g>;
const tissueScale=480/1448;
const tissuePoint=(x:number,y:number)=>({x:-240+x*tissueScale,y:-180+y*tissueScale});
const cellPixels=[[320,260],[440,320],[640,480],[930,280],[520,160],[820,820]];
const tissueImage=(file:string)=><image href={staticFile(`artwork-v3/${file}`)} x={-240} y={-180} width={480} height={360}/>;
export const Tissue=({inactive=0,repair=0,fracture=false,id='tissue'}:{inactive?:number;repair?:number;fracture?:boolean;id?:string})=>{
 const old=tissuePoint(400,270),growth=tissuePoint(1050,285),crack=tissuePoint(650,470);
 return <g style={{mixBlendMode:'multiply'}}><defs>
  <clipPath id={id}><rect x={-240} y={-180} width={480} height={360} rx={40}/></clipPath>
  <radialGradient id={`${id}-patch-edge`}><stop offset=".55" stopColor="white"/><stop offset="1" stopColor="black"/></radialGradient>
  <mask id={`${id}-local-repair`} maskUnits="userSpaceOnUse" x={-240} y={-180} width={480} height={360}>
   <rect x={-240} y={-180} width={480} height={360} fill="black"/>
   <ellipse cx={old.x} cy={old.y} rx={38} ry={30} fill={`url(#${id}-patch-edge)`}/>
   <ellipse cx={growth.x} cy={growth.y} rx={65} ry={38} fill={`url(#${id}-patch-edge)`}/>
  </mask>
 </defs><g clipPath={`url(#${id})`}>
  <g>{tissueImage('tissue-v01.png')}
   {repair>0&&<g mask={`url(#${id}-local-repair)`} opacity={repair}>{tissueImage('tissue-repair-v01.png')}</g>}
  </g>
  {cellPixels.map(([x,y],i)=><Cell key={i} {...tissuePoint(x,y)} inactive={inactive}/>)}
  {fracture&&<path d={`M${crack.x-6} ${crack.y-12} l8 9 -4 8 8 7 -3 9`} stroke="#af745f" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" fill="none"/>}
 </g></g>;
};

const tree='M280 386 C250 285 194 183 104 124 S51 41 20 16';
export const FlowTree=({frame,weaken=0}:{frame:number;weaken?:number})=><g fill="none" strokeLinecap="round">
 <path d={tree} stroke="#b9776f" strokeWidth="7"/><path d="M72 90 C15 80 -4 60 -29 39" stroke="#b9776f" strokeWidth="5"/>
 <path d="M104 124 C90 73 93 50 94 19" stroke="#b9776f" strokeWidth="5" opacity={1-weaken*.8}/>
 <path d="M104 124 C90 73 93 50 94 19" stroke="#b9776f" strokeWidth="4" strokeDasharray="8 12" opacity={weaken*.65}/>
 <path d={tree} stroke="#f6d6b0" strokeWidth="5" strokeDasharray="16 57" strokeDashoffset={-frame*3}/>
 <path d="M104 124 C90 73 93 50 94 19" stroke="#f6d6b0" strokeWidth="3.5" strokeDasharray="10 40" strokeDashoffset={-frame*2.6} opacity={1-weaken}/>
 </g>;
export const Arrow=({x,y,length=100,width=24,color=palette.ink}:{x:number;y:number;length?:number;width?:number;color?:string})=><g transform={`translate(${x} ${y})`} fill={color} opacity=".84"><path d={`M${-width/2} 0 Q0 -5 ${width/2} 0 L${width/2} ${length-29} L${width*1.2} ${length-32} Q${width*1.28} ${length-25} 0 ${length} Q${-width*1.28} ${length-25} ${-width*1.2} ${length-32} L${-width/2} ${length-29}Z`}/></g>;

// 生图原件保持白底；在视频中以正片叠底合成到共同纸色，不改写图片像素。
export const FullFemur=({x,y,scale=1,rotate=0,children}:{x:number;y:number;scale?:number;rotate?:number;children?:React.ReactNode})=><g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
 <image href={staticFile('artwork-v3/full-femur-v03.png')} x={-326*.41} y={-120*.41} width={1024*.41} height={1536*.41} style={{mixBlendMode:'multiply'}}/>
 {children}
</g>;
