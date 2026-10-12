import React, {useEffect, useState} from 'react';
import {AbsoluteFill,Composition,registerRoot,delayRender,continueRender,cancelRender,staticFile} from 'remotion';

export type Card={id:string;segmentId:string;text:string;audio:string;durationInFrames:number;audioDuration:number;motion?:{slow?:boolean}};
export type SceneProps={card:Card;preview?:boolean};
export const palette={background:'#fbf4e4',cartilage:'#91c1b8',subchondral:'#fff0cd',bone:'#efb08b',trabecula:'#ffd9b8',newBone:'#a886b6',ink:'#527e7b'};

export const Canvas=({children}:{children:React.ReactNode})=>{
 const [handle]=useState(()=>delayRender('加载归档中文字体'));
 useEffect(()=>{const font=new FontFace('Production CJK',`url(${staticFile('fonts/noto-cjk-sc.otf')})`);font.load().then(f=>{document.fonts.add(f);continueRender(handle)}).catch(cancelRender);},[handle]);
 return <AbsoluteFill style={{background:palette.background,fontFamily:'Production CJK'}}><svg viewBox="0 0 1672 940" width="100%" height="100%">{children}</svg></AbsoluteFill>;
};

// 文字独立成层；装配素材永不烧录旁白，审阅预览使用确认文案原文。
export const TextLayer=({card,preview}:SceneProps)=>{
 if(!preview)return null;
 const lines=card.text.length>36 ? [card.text.slice(0,Math.ceil(card.text.length/2)),card.text.slice(Math.ceil(card.text.length/2))] : [card.text];
 return <g id="narration-layer">{lines.map((line,i)=><text key={i} x="836" y={lines.length===1?854:820+i*45} textAnchor="middle" fill="#302f2c" fontSize="37" fontWeight="500">{line}</text>)}</g>;
};

export function registerProduction(Scene:React.ComponentType<SceneProps>){
 registerRoot(()=> <Composition id="Production" component={Scene} width={1920} height={1080} fps={30} durationInFrames={30} defaultProps={{card:{id:'',segmentId:'',text:'',audio:'',durationInFrames:30,audioDuration:1},preview:false}} calculateMetadata={({props})=>({durationInFrames:props.card.durationInFrames})}/>);
}
