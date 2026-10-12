import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Arrow,Femur,FlowTree,Label,Leader,Note,Section,Tissue,phase,palette,type RevisionProps} from './art';

type Point={x:number;y:number};
// 根据实际生图与统一缩放映射定位：组织点落在骨梁，剖面裂点位于骨组织内。
const anchors={cell:{x:-133.92265,y:-93.81215},absorption:{x:-107.4033,y:-90.4972},formation:{x:108.0663,y:-85.52486},fracture:{x:-24.5304,y:-24.1989},sectionFracture:{x:47.2,y:14.8},weakBranch:{x:94,y:19}};
const placed=(local:Point,x:number,y:number,scale:number,rotation=0):Point=>{
 const a=rotation*Math.PI/180;
 return {x:x+scale*(local.x*Math.cos(a)-local.y*Math.sin(a)),y:y+scale*(local.x*Math.sin(a)+local.y*Math.cos(a))};
};

// 使用与大画面相同的组织核心做放大窗，保持状态、骨梁和素材风格一致。
const TissueWindow=({id,x,y,scale=3,inactive=0}:{id:string;x:number;y:number;scale?:number;inactive?:number})=>{
 const edge='M-88 -47 C-74 -91 -18 -110 36 -92 C94 -74 111 -14 94 39 C81 95 22 112 -35 93 C-96 76 -112 8 -88 -47Z';
 return <g transform={`translate(${x} ${y})`} style={{mixBlendMode:'multiply'}}>
  <defs><clipPath id={`${id}-window`}><path d={edge}/></clipPath></defs>
  <path d={edge} fill={palette.background} stroke="#d5c4ac" strokeWidth={1.8}/>
  <g clipPath={`url(#${id}-window)`}>
   <g transform={`scale(${scale}) translate(${-anchors.cell.x} ${-anchors.cell.y})`}>
    <Tissue inactive={inactive} id={`${id}-same-tissue`}/>
   </g>
  </g>
 </g>;
};
const Focus=({point}:{point:Point})=><g transform={`translate(${point.x} ${point.y})`} stroke={palette.ink} strokeWidth={1.7} strokeLinecap="round" opacity={.55} fill="none">
 <path d="M-18 -9 Q-19 -18 -9 -19 M9 -19 Q19 -18 19 -8 M19 8 Q19 18 9 19 M-9 19 Q-19 18 -19 9"/>
</g>;

// 各幕改变镜头尺度和构图；只表达可能的机制，不把这些镜头连接成必经病程。
export function MechanismScenes({card}:RevisionProps){
 const frame=useCurrentFrame();
 const prefix=card.id.replace(/[^A-Za-z0-9_-]/g,'-');
 const p=Math.max(0,Math.min(1,frame/Math.max(1,card.durationInFrames-1)));
 const activity=phase(p,.13,.78);
 if(card.id.startsWith('FH05')){
  const weaken=phase(p,.22,.78);
  const tissueX=1180-80*activity;
  const tissueScale=1.08+.18*activity;
  const weakPoint=placed(anchors.weakBranch,440,290,.72,-5);
  return <g>
   <Label x={130} y={135} size={44} weight={500}>局部血供受损</Label>
   <Femur x={440} y={290} scale={.72} rotate={-5}>
    <FlowTree frame={frame} weaken={weaken}/>
   </Femur>
   <Leader d={`M${weakPoint.x} ${weakPoint.y} C720 260 790 290 ${tissueX-255} 345`}/>
   <g transform={`translate(${tissueX} 425) scale(${tissueScale})`}>
    <Tissue inactive={phase(p,.45,.82)} id={`${prefix}-fh05-tissue`}/>
   </g>
   <Label x={440} y={645} anchor="middle" size={29}>少量细分支，局部减弱</Label>
   <Label x={1110} y={660} anchor="middle" size={30}>受损区域的骨组织</Label>
   <Note x={910} y={710} width={475}>骨组织可能发生坏死</Note>
  </g>;
 }
 if(card.id.startsWith('FH06')){
  const zoom=1.28+.16*activity;
  const cellPoint=placed(anchors.cell,840-25*activity,397+8*activity,zoom);
  return <g>
   <Label x={145} y={125} size={44} weight={500}>细胞状态改变，骨架仍在</Label>
   <g transform={`translate(${840-25*activity} ${397+8*activity}) scale(${zoom})`}>
    <Tissue inactive={activity} id={`${prefix}-fh06-tissue`}/>
   </g>
   <Label x={145} y={265} size={29} color={palette.muted}>细胞状态改变</Label>
   <TissueWindow id={`${prefix}-cell-detail`} x={285} y={430} scale={2.75+.45*activity} inactive={activity}/>
   <Leader d={`M378 422 Q452 397 ${cellPoint.x} ${cellPoint.y}`}/>
   <Focus point={cellPoint}/>
   <Label x={285} y={585} anchor="middle" size={26} color={palette.muted}>局部放大示意</Label>
   <Label x={1290} y={565} anchor="middle" size={30}>原有骨梁保留</Label>
   <Note x={430} y={710} width={810}>细胞死亡，不等于骨架马上消失</Note>
  </g>;
 }
 if(card.id.startsWith('FH07')){
  const pull=phase(p,.13,.73);
  return <g>
   <Label x={135} y={135} size={45} weight={500}>外形仍可能完整</Label>
   <Femur x={1000-160*pull} y={235+15*pull} scale={.74-.07*pull} rotate={-8+5*pull}>

   </Femur>
   <g transform={`translate(${360+30*pull} ${430-10*pull}) scale(${.55-.08*pull})`} opacity={1}>
    <Tissue inactive={1} id={`${prefix}-fh07-inset`}/>
   </g>
   <Label x={290} y={620} size={31}>组织状态改变</Label>
   <Label x={900} y={170} size={31}>外形仍可能保留</Label>
   <Note x={200} y={710} width={650}>外形完整，不等于已经痊愈</Note>
  </g>;
 }
 if(card.id.startsWith('FH08')){
  const repair=.58*activity;
  const oldPoint=placed(anchors.absorption,835-20*activity,400,1.38+.08*activity);
  const newPoint=placed(anchors.formation,835-20*activity,400,1.38+.08*activity);
  return <g>
   <Label x={145} y={125} size={45} weight={500}>身体尝试局部修复</Label>
   <g transform={`translate(${835-20*activity} 400) scale(${1.38+.08*activity})`}>
    <Tissue inactive={1} repair={repair} id={`${prefix}-fh08-tissue`}/>
   </g>
   <Label x={255} y={245} size={32}>旧骨吸收</Label>
   <Leader d={`M420 261 Q510 300 ${oldPoint.x} ${oldPoint.y}`}/>
   <Label x={1100} y={245} size={32} color={palette.newBone}>新骨形成</Label>
   <Leader d={`M1110 260 Q1080 320 ${newPoint.x} ${newPoint.y}`} color={palette.newBone}/>
   <Note x={410} y={710} width={850}>旧骨吸收与新骨形成，发生在不同局部</Note>
  </g>;
 }
 if(card.id.startsWith('FH09')){
  const repair=.58+.42*phase(p,.15,.72);
  const emphasis=phase(p,.22,.78);
  const newPoint=placed(anchors.formation,655-55*emphasis,400+5*emphasis,1.24+.10*emphasis,-8+5*emphasis);
  return <g>
   <Label x={130} y={125} size={43} weight={500}>修复不一定恢复足够支撑</Label>
   <g transform={`translate(${655-55*emphasis} ${400+5*emphasis}) rotate(${-8+5*emphasis}) scale(${1.24+.10*emphasis})`}>
    <Tissue inactive={1} repair={repair} id={`${prefix}-fh09-tissue`}/>
   </g>
   <Label x={1145} y={340} size={34} color={palette.newBone}>新骨形成</Label>
   <Leader d={`M1145 355 Q1020 410 ${newPoint.x} ${newPoint.y}`} color={palette.newBone}/>
   <Label x={1145} y={400} size={31}>仍是局部修复</Label>
   <Label x={1145} y={500} size={35}>支撑未必足够</Label>
   <Note x={305} y={710} width={950}>尝试修复，不一定能恢复足够支撑</Note>
  </g>;
 }
 if(card.id.startsWith('FH10')){
  const load=phase(p,.18,.72);
  const mainCrack=placed(anchors.sectionFracture,590,404,.92);
  const detailCrack=placed(anchors.fracture,1200-15*load,495,.86);
  return <g>
   <Label x={130} y={120} size={43} weight={500}>结构受损时，承重可能出现细小骨折</Label>
   <Arrow x={590} y={80+70*load} length={80} width={25}/>
   <Label x={685} y={180} size={27}>承重示意</Label>
   <g transform="translate(590 404) scale(.92)">
    <Section id={`${prefix}-fh10-section`}>
     <path d={`M${anchors.sectionFracture.x-8} ${anchors.sectionFracture.y-10} l6 6 -4 7 7 6 -3 9`} stroke="#af745f" strokeWidth={3.3} fill="none" strokeLinecap="round"/>
    </Section>
   </g>
   <Leader d={`M${mainCrack.x} ${mainCrack.y} C740 572 1030 460 ${detailCrack.x} ${detailCrack.y}`}/>
   <g transform={`translate(${1200-15*load} 495) scale(.86)`}>
    <Tissue inactive={1} fracture id={`${prefix}-fh10-detail`}/>
   </g>
   <Focus point={mainCrack}/><Focus point={detailCrack}/>
   <Label x={1195} y={310} anchor="middle" size={31}>骨组织内的既有裂隙</Label>
   <Note x={410} y={710} width={870}>这是机制示意，并非每次承重都会发生骨折</Note>
  </g>;
 }
 if(card.id.startsWith('FH11')||card.id.startsWith('FH12')){
  const sink=58*phase(p,.18,.73);
  return <g>
   <Label x={145} y={125} size={44} weight={500}>支撑失效后，表面可能局部下陷</Label>
   <g transform="translate(835 355) scale(1.10)">
    <Section sink={sink} outline id={`${prefix}-fh11-section`}/>
   </g>
   <Label x={1220} y={200} size={30}>原轮廓对照</Label>
   <Label x={130} y={515} size={29}>软骨与下方骨层共同变化</Label>
   <Note x={445} y={710} width={815}>仅局部连续下陷，不是所有人的必经阶段</Note>
  </g>;
 }
 throw new Error(`MechanismScenes不负责制作卡 ${card.id}`);
}
