import React from 'react';
// 几何保持 #100 已确认原型；1672×940 示意坐标，纹理 seed=17。
export const AnatomyDefs=()=> <>
 <defs>
 <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="3" seed="17"/><feColorMatrix type="saturate" values="0"/></filter>
 <clipPath id="bone"><path d="M582 392 C544 300 582 177 690 140 C767 112 832 157 866 222 C888 265 876 314 929 339 C982 369 1038 369 1058 301 C1078 232 1157 217 1194 281 C1216 319 1225 381 1242 427 C1234 510 1170 574 1150 648 L1142 776 L879 776 L875 668 C866 600 807 557 787 504 C722 475 631 465 582 392 Z"/></clipPath>
 <clipPath id="zoom"><circle cx="320" cy="356" r="143"/></clipPath>
 </defs>
</>;
export const BoneGeometry=()=> <>
 <g clipPath="url(#bone)">
 <rect x="530" y="110" width="740" height="680" fill="#efb08b"/>
 <path d="M587 394 C621 353 660 302 714 253 C766 207 817 191 865 221 L850 181 L759 106 L637 129 L541 262 Z" fill="#91c1b8"/>
 <path d="M583 394 C633 336 666 289 719 243 C772 195 818 191 864 220" fill="none" stroke="#fff0cd" strokeWidth="30"/>
 <g fill="#dc896d">
 <path d="M670 342 Q705 338 745 367 L804 413 Q740 398 703 381Z"/>
 <path d="M742 276 Q772 262 791 276 L797 347 Q774 318 742 276Z"/>
 <path d="M812 249 Q851 255 849 290 L831 347Z"/>
 <path d="M826 394 Q861 338 884 325 Q901 375 938 395 L878 463Z"/>
 <path d="M734 431 L801 451 L829 512 Q769 471 734 431Z"/>
 <path d="M911 427 Q960 420 1001 405 L971 490 L917 530Z"/>
 <path d="M1065 349 Q1095 294 1128 307 L1149 387 L1044 469Z"/>
 <path d="M1020 492 Q1088 450 1145 414 L1123 521 L1053 584Z"/>
 <path d="M884 526 Q935 551 944 636 L927 776 L905 776Z"/>
 <path d="M991 565 Q1042 592 1044 679 L1071 776 L978 776Z"/>
 </g>
 <g fill="none" stroke="#ffd9b8" strokeWidth="17" strokeLinecap="round">
 <path d="M671 342 Q734 380 824 428 Q912 483 938 619 L953 776"/>
 <path d="M756 303 Q774 361 825 428"/>
 <path d="M811 275 Q821 357 856 400"/>
 <path d="M851 289 Q836 362 856 400"/>
 <path d="M836 443 Q940 438 1119 328"/>
 <path d="M895 501 Q1016 448 1164 393"/>
 <path d="M928 574 Q1005 555 1124 484"/>
 <path d="M1010 776 Q1018 636 1072 576 Q1156 505 1164 393"/>
 </g>
 <rect x="530" y="110" width="740" height="680" filter="url(#paper)" opacity=".10" style={{mixBlendMode:'multiply'}}/>
 </g>
</>;
// 既有裂隙独立层；其他片段复用骨结构不会继承 FH10 损伤。
export const ExistingFracture=()=> <path d="M740 239 l9 12 0 10 8 12" stroke="#b36b56" strokeWidth="4" fill="none" strokeLinecap="round"/>;
