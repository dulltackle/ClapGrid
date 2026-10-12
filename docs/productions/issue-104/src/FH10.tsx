import React from 'react';
import {useCurrentFrame} from 'remotion';
import {AnatomyDefs,BoneGeometry,ExistingFracture} from './anatomy';
import {Canvas,TextLayer,type SceneProps} from './shared';

// #104 制作基线：时间由实际音频帧数驱动，slow 仅影响箭头移动时间。
const ease = (v:number) => {const x=Math.max(0,Math.min(1,v));return x*x*(3-2*x)};
export const FH10 = ({card,preview=false}:SceneProps) => {
 const slow=card.motion?.slow ?? false;
 const f=useCurrentFrame();
 const scale=card.durationInFrames/146;
 const arrowY=-16+30*ease((f-71*scale)/((slow?36:21)*scale));
 const zoom= ease((f-102*scale)/(10*scale));
 return <Canvas>
 <AnatomyDefs/>
 <rect width="1672" height="940" fill="#fbf4e4"/>
 <text x="54" y="69" fill="#527e7b" fontSize="34" fontWeight="600">机制示意 · 非固定病程</text>
 <BoneGeometry/>
 <ExistingFracture/>
 <text x="653" y="43" fill="#527e7b" fontSize="29" fontWeight="600">承重示意</text>
 <g transform={`translate(0 ${arrowY})`} fill="#79a8a1" id="load-arrows">
 <path d="M675 70 h12 v32 h12 l-18 20 -18-20 h12Z"/>
 <path d="M742 70 h12 v32 h12 l-18 20 -18-20 h12Z"/>
 </g>
 <text x="980" y="181" fill="#527e7b" fontSize="32" fontWeight="600">支撑受损时，可能发生</text>
 <path d="M959 176 L906 181 L883 200" stroke="#698e88" strokeWidth="3" fill="none"/>
 <circle cx="883" cy="200" r="5" fill="#698e88"/>
 <g opacity={zoom}>
 <circle cx="749" cy="254" r="26" stroke="#71918b" strokeWidth="3" strokeDasharray="5 4" fill="none"/>
 <path d="M725 267 L458 344" stroke="#71918b" strokeWidth="3" strokeDasharray="9 6"/>
 <g clipPath="url(#zoom)">
 <rect x="175" y="212" width="290" height="290" fill="#efb08b"/>
 <path d="M174 320 L459 258 L463 206 L169 199Z" fill="#91c1b8"/>
 <path d="M174 336 L463 273" stroke="#fff0cd" strokeWidth="32"/>
 <path d="M203 434 Q250 382 269 469 L288 510 L191 510Z M372 506 Q371 383 442 369 L477 504Z" fill="#dc896d"/>
 <path d="M220 391 Q265 428 320 453 L349 510 M321 360 Q299 405 320 453 M414 402 Q370 439 320 453" stroke="#ffd9b8" strokeWidth="17" fill="none" strokeLinecap="round"/>
 <path d="M285 333 l13 15 4 11 11 5 12 23" stroke="#ae6550" strokeWidth="5" fill="none" strokeLinecap="round"/>
 <rect x="175" y="212" width="290" height="290" filter="url(#paper)" opacity=".10" style={{mixBlendMode:'multiply'}}/>
 </g>
 <circle cx="320" cy="356" r="143" fill="none" stroke="#648b86" strokeWidth="4"/>
 <rect x="216" y="476" width="208" height="58" rx="20" fill="#527e7b"/>
 <text x="320" y="516" textAnchor="middle" fill="white" fontSize="32" fontWeight="600">细小骨折</text>
 </g>
 <TextLayer card={card} preview={preview}/>
 <text x="836" y="913" textAnchor="middle" fill="#827b6d" fontSize="19">机制示意 · 不代表每个人的病程</text>
 </Canvas>;
};
