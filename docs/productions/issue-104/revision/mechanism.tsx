import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Arrow,Femur,FlowTree,Label,Leader,Note,Section,Tissue,phase,palette,type RevisionProps} from './art';

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
  return <g>
   <Label x={130} y={135} size={44}>局部血供受损</Label>
   <Femur x={440} y={290} scale={.72} rotate={-5}>
    <FlowTree frame={frame} weaken={weaken}/>
   </Femur>
   <Leader d={`M508.6 297.7 C720 260 790 290 ${tissueX-255} 345`}/>
   <g transform={`translate(${tissueX} 425) scale(${tissueScale})`}>
    <Tissue inactive={phase(p,.45,.82)} id={`${prefix}-fh05-tissue`}/>
   </g>
   <Label x={440} y={645} anchor="middle" size={29}>少量细分支，局部减弱</Label>
   <Label x={1110} y={675} anchor="middle" size={30}>受损区域的骨组织</Label>
   <Note x={910} y={710} width={475}>骨组织可能发生坏死</Note>
  </g>;
 }
 if(card.id.startsWith('FH06')){
  const zoom=1.38+.2*activity;
  return <g>
   <Label x={145} y={125} size={44}>细胞状态改变，骨架仍在</Label>
   <g transform={`translate(${840-25*activity} ${418+8*activity}) scale(${zoom})`}>
    <Tissue inactive={activity} id={`${prefix}-fh06-tissue`}/>
   </g>
   <Label x={145} y={265} size={29} color={palette.muted}>细胞状态改变</Label>
   {/* 放大同一细胞状态符号：仅内部核变淡，外轮廓和主组织骨梁都不消失。 */}
   <g transform="translate(290 430) rotate(-27)" filter="url(#revision-grain)">
    <ellipse rx={60} ry={88} fill="#fbe6cc" stroke="#c58c74" strokeWidth={3}/>
    <ellipse rx={22} ry={33} fill="#be816c" opacity={1-activity*.86}/>
   </g>
   <Leader d={`M372 423 Q435 420 ${840-25*activity-148*zoom} ${418+8*activity-34*zoom}`}/>
   <Label x={285} y={585} anchor="middle" size={26} color={palette.muted}>局部放大示意</Label>
   <Label x={1290} y={565} anchor="middle" size={30}>原有骨梁保留</Label>
   <Note x={430} y={710} width={810}>细胞死亡，不等于骨架马上消失</Note>
  </g>;
 }
 if(card.id.startsWith('FH07')){
  const pull=phase(p,.13,.73);
  return <g>
   <Label x={135} y={135} size={45}>外形仍可能完整</Label>
   <Femur x={1000-160*pull} y={275+25*pull} scale={.91-.08*pull} rotate={-8+5*pull}>
    <path d="M-158 122 C-196 30 -158 -93 -50 -130 C27 -158 92 -113 126 -48 C148 -5 136 44 189 69" fill="none" stroke={palette.ink} strokeWidth={3} strokeDasharray="9 8" opacity={.2+.55*pull}/>
   </Femur>
   <g transform={`translate(${360+30*pull} ${430-10*pull}) scale(${.55-.08*pull})`} opacity={1}>
    <Tissue inactive={1} id={`${prefix}-fh07-inset`}/>
   </g>
   <Label x={290} y={620} size={31}>组织状态改变</Label>
   <Label x={900} y={170} size={31}>原轮廓保留</Label>
   <Note x={200} y={710} width={650}>外形完整，不等于已经痊愈</Note>
  </g>;
 }
 if(card.id.startsWith('FH08')){
  const repair=.58*activity;
  return <g>
   <Label x={145} y={125} size={45}>身体尝试局部修复</Label>
   <g transform={`translate(${835-20*activity} 430) scale(${1.42+.1*activity})`}>
    <Tissue inactive={1} repair={repair} id={`${prefix}-fh08-tissue`}/>
   </g>
   <Label x={255} y={245} size={32}>旧骨吸收</Label>
   <Leader d={`M420 261 Q510 300 ${835-20*activity-134*(1.42+.1*activity)} ${430-24*(1.42+.1*activity)}`}/>
   <Label x={1100} y={245} size={32} color={palette.newBone}>新骨形成</Label>
   <Leader d={`M1110 260 Q1080 320 ${835-20*activity+109*(1.42+.1*activity)} ${430-12*(1.42+.1*activity)}`} color={palette.newBone}/>
   <Note x={410} y={710} width={850}>旧骨吸收与新骨形成，发生在不同局部</Note>
  </g>;
 }
 if(card.id.startsWith('FH09')){
  const repair=.58+.42*phase(p,.15,.72);
  const emphasis=phase(p,.22,.78);
  const angle=(-8+5*emphasis)*Math.PI/180;
  const newBoneX=655-55*emphasis+(1.28+.12*emphasis)*(109*Math.cos(angle)+12*Math.sin(angle));
  const newBoneY=425+5*emphasis+(1.28+.12*emphasis)*(109*Math.sin(angle)-12*Math.cos(angle));
  return <g>
   <Label x={130} y={125} size={43}>修复不一定恢复足够支撑</Label>
   <g transform={`translate(${655-55*emphasis} ${425+5*emphasis}) rotate(${-8+5*emphasis}) scale(${1.28+.12*emphasis})`}>
    <Tissue inactive={1} repair={repair} id={`${prefix}-fh09-tissue`}/>
   </g>
   <Label x={1145} y={340} size={34} color={palette.newBone}>新骨形成</Label>
   <Leader d={`M1145 355 Q1020 410 ${newBoneX} ${newBoneY}`} color={palette.newBone}/>
   <Label x={1145} y={400} size={31}>仍是局部修复</Label>
   <Label x={1145} y={500} size={35}>支撑未必足够</Label>
   <Note x={305} y={710} width={950}>尝试修复，不一定能恢复足够支撑</Note>
  </g>;
 }
 if(card.id.startsWith('FH10')){
  const load=phase(p,.18,.72);
  return <g>
   <Label x={130} y={120} size={43}>结构受损时，承重可能出现细小骨折</Label>
   <Arrow x={590} y={80+70*load} length={80} width={25}/>
   <Label x={685} y={180} size={27}>承重示意</Label>
   <g transform="translate(590 445) scale(1.1)">
    <Section id={`${prefix}-fh10-section`}>
     <path d="M-40 55 l8 9 -4 8 8 7 -3 9" stroke="#af745f" strokeWidth={4.5} fill="none" strokeLinecap="round"/>
    </Section>
   </g>
   <Leader d={`M552.6 520.9 C750 590 1030 450 ${1200-15*load-29*.86} ${495-10*.86}`}/>
   <g transform={`translate(${1200-15*load} 495) scale(.86)`}>
    <Tissue inactive={1} fracture id={`${prefix}-fh10-detail`}/>
   </g>
   <Label x={1195} y={310} anchor="middle" size={31}>骨组织内的既有裂隙</Label>
   <Note x={410} y={710} width={870}>这是机制示意，并非每次承重都会发生骨折</Note>
  </g>;
 }
 if(card.id.startsWith('FH11')||card.id.startsWith('FH12')){
  const sink=58*phase(p,.18,.73);
  return <g>
   <Label x={145} y={125} size={44}>支撑失效后，表面可能局部下陷</Label>
   <g transform="translate(835 420) scale(1.20)">
    <Section sink={sink} outline id={`${prefix}-fh11-section`}/>
   </g>
   <Label x={1220} y={200} size={30}>原轮廓对照</Label>
   <Label x={130} y={515} size={29}>软骨与下方骨层共同变化</Label>
   <Note x={445} y={710} width={815}>仅局部连续下陷，不是所有人的必经阶段</Note>
  </g>;
 }
 throw new Error(`MechanismScenes不负责制作卡 ${card.id}`);
}
