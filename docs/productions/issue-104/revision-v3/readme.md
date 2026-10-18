# full-rough-v3 制作记录

> 历史记录：原始材料已退出当前 Git 跟踪；复现前请按[原件保留与恢复说明](../../README.md)恢复对应工程或证据。本页不代表当前版本验收。

第三版回应第二版的素材质感反馈，使用同一参考链生成股骨、剖面和骨组织，保留原15条音频和已确认文案。每段源与原素材可恢复，V1/V2历史文件不改写。

锁依赖在父目录package-lock.json。开发类型检查：`./node_modules/.bin/tsc --noEmit -p revision-v3/tsconfig.json`。制作：`node revision-v3/render.mjs --boundary`，保存真实15素材、45有限采样、60边界帧及渲染时源码/生图依赖快照。`python3 revision-v3/finalize-render.py <制作根目录>`仅汇合已有输出，不渲染。`python3 revision-v3/verify.py <制作根目录>`核原声身份、媒体帧长和完整解码。完整交付记录汇合首批15段和动态位移图加载修订的4段；每段保留自身批次SHA，前幕冻结也重渲。实际ClapGrid整片在关联15新素材后单独导出，current-inputs.json必须以实际结果更新。

生图原件保存在public/artwork-v3，完整提示词和工具记录在evidence/image-generation.json。白底通过Remotion正片叠底合成，不改变原件像素。实际全片、独立档案、固定提交正式检查和用户终审各自有对应证据，制作预览不是最终全片。当前用户对第三版的全部终审项待确认。
