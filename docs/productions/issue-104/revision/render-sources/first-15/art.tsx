import React from 'react';
import {AnatomyDefs, BoneGeometry} from '../src/anatomy';
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

export const Femur=({x,y,scale=1,rotate=0,children}:{x:number;y:number;scale?:number;rotate?:number;children?:React.ReactNode})=><g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
 <g transform="translate(-740 -270)" className="art-femur" filter="url(#revision-grain)"><BoneGeometry/>
 <path d="M591 358 C565 265 615 169 701 149" stroke="#d2e5d9" strokeWidth="14" opacity=".35" fill="none" strokeLinecap="round"/>
 <path d="M926 752 C949 593 991 479 1100 346" stroke="#ffead5" strokeWidth="9" opacity=".16" fill="none" strokeLinecap="round"/>
 </g>{children}</g>;

const surface=(offset:number,sink:number)=>Array.from({length:81},(_,i)=>{const x=-230+i*5.75;const y=-176*Math.sqrt(Math.max(0,1-(x/230)**2))+offset+sink*Math.exp(-Math.pow(x/72,4));return [x,y]});
const curve=(offset:number,sink:number)=>surface(offset,sink).map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
const reversed=(offset:number,sink:number)=>surface(offset,sink).reverse().map(([x,y])=>`L${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
export const Section=({sink=0,outline=false,children,id='section'}:{sink?:number;outline?:boolean;children?:React.ReactNode;id?:string})=>{
 const body=curve(50,sink)+'L230 204 Q15 283 -230 204Z';
 return <g filter="url(#revision-grain)"><defs><clipPath id={id}><path d={body}/></clipPath></defs>
 <path d={body} fill="url(#marrow-wash)"/>
 <g clipPath={`url(#${id})`} stroke="url(#beam-wash)" strokeWidth="27" fill="none" strokeLinecap="round" strokeLinejoin="round">
 <path d="M-235 178 Q-185 116 -140 40 Q-101 13 -34 69 Q27 124 104 19 Q156 11 242 136 M-140 40 Q-98 104 -104 236 M-34 69 Q-12 160 12 255 M104 19 Q132 105 135 239 M-185 116 Q-100 156 -12 160 Q83 144 181 198"/>
 </g>
 <path d={curve(0,sink)+reversed(30,sink)+'Z'} fill="url(#cartilage-wash)"/>
 <path d={curve(30,sink)+reversed(50,sink)+'Z'} fill={palette.subchondral}/>
 {outline&&<path d={curve(0,0)} fill="none" stroke={palette.ink} strokeWidth="2.5" strokeDasharray="8 8" opacity=".72"/>}
 {children}</g>;
};

const Cell=({x,y,inactive=0}:{x:number;y:number;inactive?:number})=><g transform={`translate(${x} ${y}) rotate(-27)`}><ellipse rx="11" ry="16" fill="#fbe6cc" stroke="#c58c74" strokeWidth="1.5"/><ellipse rx="4" ry="6" fill="#be816c" opacity={1-inactive*.86}/></g>;
export const Tissue=({inactive=0,repair=0,fracture=false,id='tissue'}:{inactive?:number;repair?:number;fracture?:boolean;id?:string})=><g filter="url(#revision-grain)">
 <defs><clipPath id={id}><rect x="-240" y="-170" width="480" height="340" rx="46"/></clipPath></defs>
 <g clipPath={`url(#${id})`}><rect x="-240" y="-170" width="480" height="340" rx="46" fill="url(#marrow-wash)"/>
 <g stroke="url(#beam-wash)" strokeWidth="49" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M-260 -92 Q-126 -9 -38 9 Q71 40 260 -115 M-138 -220 Q-103 -56 -38 9 Q20 80 37 220 M131 0 Q142 87 260 158 M-38 9 Q-102 100 -204 206"/></g>
 <Cell x={-148} y={-34} inactive={inactive}/><Cell x={-76} y={-2} inactive={inactive}/><Cell x={49} y={16} inactive={inactive}/><Cell x={137} y={-33} inactive={inactive}/><Cell x={-100} y={-94} inactive={inactive}/><Cell x={17} y={104} inactive={inactive}/>
 {repair>0&&<><path d="M-157 -35 Q-134 -22 -111 -16" stroke="#da9678" strokeWidth={4+repair*16} strokeLinecap="round" fill="none"/><path d="M72 9 Q111 -8 144 -31" stroke="url(#violet-wash)" strokeWidth={5+repair*25} strokeLinecap="round" fill="none"/></>}
 {fracture&&<path d="M-29 -10 l8 9 -4 8 8 7 -3 9" stroke="#af745f" strokeWidth="4.5" strokeLinecap="round" fill="none"/>}
 </g></g>;

const tree='M280 386 C250 285 194 183 104 124 S51 41 20 16';
export const FlowTree=({frame,weaken=0}:{frame:number;weaken?:number})=><g fill="none" strokeLinecap="round">
 <path d={tree} stroke="#b9776f" strokeWidth="7"/><path d="M72 90 C15 80 -4 60 -29 39" stroke="#b9776f" strokeWidth="5"/>
 <path d="M104 124 C90 73 93 50 94 19" stroke="#b9776f" strokeWidth="5" opacity={1-weaken*.8}/>
 <path d="M104 124 C90 73 93 50 94 19" stroke="#b9776f" strokeWidth="4" strokeDasharray="8 12" opacity={weaken*.65}/>
 <path d={tree} stroke="#f6d6b0" strokeWidth="5" strokeDasharray="16 57" strokeDashoffset={-frame*3}/>
 <path d="M104 124 C90 73 93 50 94 19" stroke="#f6d6b0" strokeWidth="3.5" strokeDasharray="10 40" strokeDashoffset={-frame*2.6} opacity={1-weaken}/>
 </g>;
export const Arrow=({x,y,length=100,width=24,color=palette.ink}:{x:number;y:number;length?:number;width?:number;color?:string})=><g transform={`translate(${x} ${y})`} fill={color} opacity=".84"><path d={`M${-width/2} 0 Q0 -5 ${width/2} 0 L${width/2} ${length-29} L${width*1.2} ${length-32} Q${width*1.28} ${length-25} 0 ${length} Q${-width*1.28} ${length-25} ${-width*1.2} ${length-32} L${-width/2} ${length-29}Z`}/></g>;
