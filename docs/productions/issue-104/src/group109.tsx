import React from 'react';
import {useCurrentFrame} from 'remotion';
import {AnatomyDefs, BoneGeometry} from './anatomy';
import {Canvas, TextLayer, palette, type SceneProps} from './shared';

const ease=(v:number)=>{const x=Math.max(0,Math.min(1,v));return x*x*(3-2*x)};
const label=(x:number,y:number,text:string,size=32)=><text x={x} y={y} fill={palette.ink} fontSize={size} fontWeight="600">{text}</text>;

// 局部截面中的软骨和软骨下骨层采用同一条连续轮廓，仅整体相差层厚。
// 下陷仅发生在中间小区域，周边轮廓与骨组织保留；颜色、厚度均为示意。
function SurfaceSection({sink=0,id,outline=false}:{sink?:number;id:string;outline?:boolean}){
 const points=(offset:number,depth:number):Array<[number,number]>=>Array.from({length:61},(_,i):[number,number]=>{
  const x=-210+i*7;
  return [x,offset-142*Math.sqrt(Math.max(0,1-(x/210)**2))+depth*Math.exp(-((x/65)**2))];
 });
 const contour=(offset:number,depth:number)=>points(offset,depth).map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(3)} ${y.toFixed(3)}`).join(' ');
 const reverse=(offset:number,depth:number)=>points(offset,depth).reverse().map(([x,y])=>`L${x.toFixed(3)} ${y.toFixed(3)}`).join(' ')+' Z';
 const body=contour(35,sink)+'L210 185 Q0 210,-210 185 Z';
 return <g>
  <defs><clipPath id={id}><path d={body}/></clipPath></defs>
  <path d={body} fill={palette.bone}/>
  <g clipPath={`url(#${id})`}>
   <g stroke={palette.trabecula} strokeWidth="15" fill="none" strokeLinecap="round">
    <path d="M-195 155 L-112 35 L-20 100 L95 15 L202 115 M-112 35 L-65 188 M-20 100 L10 202 M95 15 L122 192 M-140 112 L-20 100 L120 145"/>
   </g>
   <rect x="-210" y="-150" width="420" height="365" filter="url(#paper)" opacity=".10"/>
  </g>
  <path d={contour(0,sink)+reverse(20,sink)} fill={palette.cartilage}/>
  <path d={contour(20,sink)+reverse(35,sink)} fill={palette.subchondral}/>
  {outline&&<path d={contour(0,0)} stroke="#698e88" strokeWidth="3" strokeDasharray="8 7" fill="none"/>}
 </g>;
}

export function Group109({card,preview=false}:SceneProps){
 const frame=useCurrentFrame();
 const progress=frame/Math.max(1,card.durationInFrames-1);
 const appear=ease(progress/.24);
 const sink=52*ease((progress-.15)/.45);
 return <Canvas>
  <AnatomyDefs/>
  <rect width="1672" height="940" fill={palette.background}/>
  {label(54,65,'机制示意 · 非固定病程',34)}
  {card.id==='FH13'&&<>
   {label(110,140,'不是每个坏死的股骨头都会塌陷',38)}
   <g transform="translate(-270 80) scale(.78)"><BoneGeometry/></g>
   <g opacity={appear} transform="translate(1290 415) scale(.78)"><SurfaceSection sink={52} id="outcome13"/></g>
   {label(245,725,'仍可能保持完整',36)}
   {label(245,767,'保持完整不等于痊愈',25)}
   {label(1100,640,'也可能局部下陷',31)}
   {label(1100,681,'局部截面示意',23)}
   {label(980,750,'图形大小不表示发生比例',24)}
  </>}
  {card.id==='FH14'&&<>
   {label(110,140,'范围、位置等因素会影响进展',38)}
   <BoneGeometry/>
   <g clipPath="url(#bone)" opacity={appear}>
    <path d="M690 310 Q730 250 810 259 L845 345 L780 428 L705 379 Z" fill="#a88b8b" fillOpacity=".34" stroke="#a17a79" strokeWidth="3" strokeDasharray="8 6"/>
    <path d="M902 515 Q955 482 1000 511 L984 568 L929 580 Z" fill="#a88b8b" fillOpacity=".18" stroke="#a17a79" strokeWidth="3" strokeDasharray="8 6"/>
   </g>
   {label(235,325,'受损范围',35)}
   <path d="M410 315 L600 315 L695 335" stroke={palette.ink} strokeWidth="3" fill="none"/>
   {label(1280,500,'位置',35)}
   <path d="M1260 490 L1080 490 L970 533" stroke={palette.ink} strokeWidth="3" fill="none"/>
   {label(130,735,'示意区域不表示概率，也不用于分期或诊断',25)}
  </>}
  {card.id==='FH15'&&<>
   {label(110,145,'坏死：骨组织死亡',42)}
   <BoneGeometry/>
   <g opacity={appear} fill="#9d8b89" stroke="#6c6462" strokeWidth="2">
    <ellipse cx="738" cy="378" rx="10" ry="7"/>
    <ellipse cx="791" cy="389" rx="10" ry="7"/>
    <ellipse cx="895" cy="501" rx="10" ry="7"/>
   </g>
   {label(180,325,'细胞状态改变',34)}
   <path d="M438 314 L598 314 L735 377" stroke={palette.ink} strokeWidth="3" fill="none"/>
   {label(170,735,'不等于原有骨架马上消失',30)}
  </>}
  {card.id==='FH16'&&<>
   {label(110,145,'塌陷：支撑失效后的外形改变',39)}
   <g transform="translate(836 420) scale(1.30)"><SurfaceSection sink={sink} id="outcome16" outline/></g>
   {label(1180,270,'原轮廓',29)}
   <path d="M1150 263 L995 246 L836 235.4" fill="none" stroke={palette.ink} strokeWidth="3" strokeDasharray="7 5"/>
   {label(1170,370,'可能局部下陷',30)}
   <path d="M1140 361 L1010 361 L859 300" fill="none" stroke={palette.ink} strokeWidth="3"/>
   {label(240,735,'坏死与塌陷描述的是不同变化',31)}
  </>}
  <TextLayer card={card} preview={preview}/>
  <text x="836" y="913" textAnchor="middle" fill="#827b6d" fontSize="19">机制示意 · 不代表每个人的病程</text>
 </Canvas>;
}
