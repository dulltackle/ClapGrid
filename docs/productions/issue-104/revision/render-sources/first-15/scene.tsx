import React from 'react';
import {Audio,Freeze,staticFile,useCurrentFrame} from 'remotion';
import {Canvas,TextLayer} from '../src/shared';
import cards from './cards.json';
import {ArtDefs,palette,type RevisionProps} from './art';
import {IntroScenes} from './intro';
import {MechanismScenes} from './mechanism';
import {OutroScenes} from './outro';

export const SceneBody=(props:RevisionProps)=>{
 const number=Number(props.card.id.slice(2,4));
 if(number<=4)return <IntroScenes {...props}/>;
 if(number<=12)return <MechanismScenes {...props}/>;
 return <OutroScenes {...props}/>;
};
export const RevisionScene=({card,preview=false,playAudio=true}:{playAudio?:boolean}&RevisionProps)=>{
 const frame=useCurrentFrame();const index=cards.findIndex(c=>c.id===card.id);const previous=cards[index-1];
 const transitionFrames=14;
 const linear=Math.min(1,Math.max(0,frame/transitionFrames));
 const progress=linear*linear*(3-2*linear);const edge=1672*progress;
 // 只在画面内使用前段末帧与纸边擦入；不重叠音频，不缩短任何片段。
 const entering=Boolean(previous)&&frame<transitionFrames;
 return <><Canvas><ArtDefs/>
  <rect width="1672" height="940" fill={palette.background}/>
  {entering&&<Freeze frame={previous.durationInFrames-1}><SceneBody card={previous}/></Freeze>}
  {entering&&<defs><clipPath id={`transition-${card.id}`}><path d={`M0 0 H${edge} Q${edge+23} 200 ${edge} 440 Q${edge-17} 640 ${edge} 940 H0 Z`}/></clipPath></defs>}
  <g clipPath={entering?`url(#transition-${card.id})`:undefined}><rect width="1672" height="940" fill={palette.background}/><SceneBody card={card}/></g>
  <rect width="1672" height="940" fill="#8f7b58" filter="url(#paper)" opacity=".022" style={{mixBlendMode:'multiply'}} pointerEvents="none"/>
  <text x="94" y="75" fill={palette.muted} fontSize="23" letterSpacing="2">成人股骨头 · 机制示意</text>
  <TextLayer card={card} preview={preview}/>
  <text x="836" y="913" textAnchor="middle" fill={palette.muted} fontSize="19">机制示意 · 结构颜色与厚度为示意 · 不代表每个人的病程</text>
 </Canvas>{preview&&playAudio&&<Audio src={staticFile(`revision-audio/${card.id}.mp3`)}/>}</>;
};
