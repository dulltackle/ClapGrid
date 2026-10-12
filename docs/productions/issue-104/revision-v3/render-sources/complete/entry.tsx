import React from 'react';
import {Audio,Composition,Folder,Sequence,registerRoot,staticFile,useVideoConfig} from 'remotion';
import {RevisionScene} from './scene';
import cards from './cards.json';

const start=(n:number)=>Math.round(cards.slice(0,n).reduce((s,c)=>s+c.audioDuration,0)*30);
const total=Math.ceil(cards.reduce((s,c)=>s+c.audioDuration,0)*30);
const FullRevision=()=>{const {fps}=useVideoConfig();return <>
 <Sequence name="开场提问" from={start(0)} durationInFrames={start(1)-start(0)} premountFor={fps}><RevisionScene card={cards[0]} preview playAudio={false}/></Sequence>
 <Sequence name="股骨头定位" from={start(1)} durationInFrames={start(2)-start(1)} premountFor={fps}><RevisionScene card={cards[1]} preview playAudio={false}/></Sequence>
 <Sequence name="三层结构" from={start(2)} durationInFrames={start(3)-start(2)} premountFor={fps}><RevisionScene card={cards[2]} preview playAudio={false}/></Sequence>
 <Sequence name="氧气与营养" from={start(3)} durationInFrames={start(4)-start(3)} premountFor={fps}><RevisionScene card={cards[3]} preview playAudio={false}/></Sequence>
 <Sequence name="局部供血减弱" from={start(4)} durationInFrames={start(5)-start(4)} premountFor={fps}><RevisionScene card={cards[4]} preview playAudio={false}/></Sequence>
 <Sequence name="细胞与骨架" from={start(5)} durationInFrames={start(6)-start(5)} premountFor={fps}><RevisionScene card={cards[5]} preview playAudio={false}/></Sequence>
 <Sequence name="外形保留" from={start(6)} durationInFrames={start(7)-start(6)} premountFor={fps}><RevisionScene card={cards[6]} preview playAudio={false}/></Sequence>
 <Sequence name="局部修复" from={start(7)} durationInFrames={start(8)-start(7)} premountFor={fps}><RevisionScene card={cards[7]} preview playAudio={false}/></Sequence>
 <Sequence name="支撑不一定恢复" from={start(8)} durationInFrames={start(9)-start(8)} premountFor={fps}><RevisionScene card={cards[8]} preview playAudio={false}/></Sequence>
 <Sequence name="承重与既有骨裂" from={start(9)} durationInFrames={start(10)-start(9)} premountFor={fps}><RevisionScene card={cards[9]} preview playAudio={false}/></Sequence>
 <Sequence name="可能局部下陷" from={start(10)} durationInFrames={start(11)-start(10)} premountFor={fps}><RevisionScene card={cards[10]} preview playAudio={false}/></Sequence>
 <Sequence name="两种可能" from={start(11)} durationInFrames={start(12)-start(11)} premountFor={fps}><RevisionScene card={cards[11]} preview playAudio={false}/></Sequence>
 <Sequence name="范围与位置" from={start(12)} durationInFrames={start(13)-start(12)} premountFor={fps}><RevisionScene card={cards[12]} preview playAudio={false}/></Sequence>
 <Sequence name="坏死含义" from={start(13)} durationInFrames={start(14)-start(13)} premountFor={fps}><RevisionScene card={cards[13]} preview playAudio={false}/></Sequence>
 <Sequence name="塌陷含义" from={start(14)} durationInFrames={total-start(14)} premountFor={fps}><RevisionScene card={cards[14]} preview playAudio={false}/></Sequence>
 <Audio src={staticFile('revision-audio/full.wav')}/>
 </>};

const Root=()=> <>
 <Composition id="FullRevision" component={FullRevision} width={1920} height={1080} fps={30} durationInFrames={total}/>
 <Folder name="逐段修订">
  {cards.map(card=><Composition key={card.id} id={card.id} component={RevisionScene} width={1920} height={1080} fps={30} durationInFrames={card.durationInFrames} defaultProps={{card,preview:true,playAudio:true}} calculateMetadata={({props})=>({durationInFrames:props.card.durationInFrames})}/>)}
 </Folder>
 <Composition id="RevisionAsset" component={RevisionScene} width={1920} height={1080} fps={30} durationInFrames={cards[0].durationInFrames} defaultProps={{card:cards[0],preview:false,playAudio:false}} calculateMetadata={({props})=>({durationInFrames:props.card.durationInFrames})}/>
 </>;
registerRoot(Root);
