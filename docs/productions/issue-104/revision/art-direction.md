# 第二版场景协作合同

用户已看完 full-rough-v1，终审未通过：动画不明显、转场少且反复同一股骨头构图、Remotion叠加不精致且与参考素材风格不符。

目标：保留15个原声和v0.2文字/实测时长/稳定身份。现有纸纹、青绿软骨、奶油骨层、桃色骨组织和紫色新骨，全部可编辑SVG用同一柔和渐变、低对比纸纹、有机圆润线条。镜头需有全景/定位/截面/组织近景/大局部/结尾对照的明显变化，动作需有可见位移或形态过程，不能只淡入标签。底部y780–900保留字幕；画面1672×940坐标。

root独占 revision/art.tsx、revision/scene.tsx、revision/outro.tsx、revision/entry.tsx、渲染/计划/档案/宿主。作者只改自己一个场景源文件。不修改v1代码/媒体/档案。先不要提交，root确认实际可视检查后再固定候选。当前所有分支从c33e229起。

root将提供 revision/art.tsx API：

- `RevisionProps = {card: Card, preview?:boolean}`，Card沿用../src/shared。
- `palette`：background/ink/cartilage/subchondral/bone/trabecula/newBone及muted。
- `ease(n)` 0–1平滑，`phase(p,start,end)`→0–1平滑。
- `Label({x,y,size=32,children,anchor='start',color=palette.ink,weight=600})`。
- `Leader({d,color=palette.ink})`细而圆的指示线。
- `Femur({x,y,scale=1,rotate=0,children})`：股骨頭中心local(0,0)，原始轮廓归一化，local bounds约x[-200,510],y[-160,510]；children为同local坐标的覆盖/指示，主骨用有机纸纹柔和渐变。
- `Section({sink=0,outline=false,children,id='section'})`：局部宽460，x[-230,230],y[-190,245]，连续青绿软骨+浅骨层+桃骨及奶油骨梁；sink=0..60 局部平滑下陷，层共同变化。children按同local坐标，需包装translate/scale安排。
- `Tissue({inactive=0,repair=0,fracture=false,id='tissue'})`：组织近景local x[-240,240],y[-170,170]，骨梁恒保留；inactive细胞内部状态变淡，repair不同局部旧骨吸收/紫色新骨，fracture已有骨梁裂隙且不改变软骨。
- `FlowTree({frame,weaken=0})`：Femur局部坐标的主/细供血分支，有可见流动，局部一细分支减弱，不全阻塞或预设命名血管。
- `Arrow({x,y,length=100,width=24,color=palette.ink})`：向下承重示意箭头。
- `Note({x,y,children,width=400})`轻纸色带文字，非dashboard卡片。

各场景组件只返回SVG `<g>`内容，不返回Canvas/背景/字幕/footer。root总框架统一字体/纸纹及文字层；每段前14帧用前段末画面与当前画面交叠+短位移做可见转场，不重叠或裁切原声、不改变全长。场景动作开始尽量在p0.1之后，结尾保留0.15停留。

IntroScenes负责FH01–04：问题大字与结构英雄画面 → 全股骨轮廓定位/动态圈选 → 大剖面分层相继展开或移出强调 → 供血贴近组织流动。必须不同构图，不始终原整股骨右置。

MechanismScenes负责FH05–FH10/FH11–FH12：局部供血可见变化 → 骨组织大近景细胞状态变化骨梁不消失 → 拉回头部原轮廓保留 → 大组织局部修复分两区同时过程 → 修复仍不足支持局部强调 → 既有骨组织裂隙+柔和承重箭头（不随一次动作新发裂隙） → 大关节面近景软骨/下骨层共同连续局部下陷对照原轮廓。不能只是名字标签动画。FH10纯素材新版本不冒称只是110箭头slow旧局部修改，旧110演练原样保留。

医学约束来自 #104，不改旁白：不空洞/腐烂，不整体拆除重建，不必经病程、不概率/分期/治疗，不软骨裂/翘起脱离。overlay不能假称真实解剖或专家审核。
