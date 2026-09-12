const fs=require('node:fs');
const path=require('node:path');
const r=JSON.parse(fs.readFileSync(path.join(__dirname,'results.json'),'utf8'));
const f=x=>Number(x).toFixed(4),pct=x=>(100*x).toFixed(1)+'%';
const foldMean=(v,k)=>r.evaluation[v].folds.reduce((s,x)=>s+x[k],0)/5;
const rows=Object.keys(r.evaluation).map(v=>{const e=r.evaluation[v].overall;return `| ${v} ${r.labels[v]} | ${f(e.mae)} | ${f(e.rmse)} | ${pct(foldMean(v,'precision20'))} | ${f(foldMean(v,'ndcg20'))} | ${f(e.predictionSD)} |`;});
const influence=Object.entries(r.influence).map(([v,x])=>`| ${v} | ${x.tested} | ${f(x.meanAbsoluteChange)} | ${f(x.worstCandidateChange)} | ${x.meanTop20Retained.toFixed(2)}/20 | ${x.worstTop20Retained}/20 |`);
const intervals=Object.entries(r.uncertainty).map(([v,x])=>`- ${v} 相对 ${v==='E'?'D（有角色数据子集）':'A'}：MAE 差 ${f(x.deltaMAE)}，按系列抽样的 95% 区间 [${x.clusterBootstrap95.map(f).join(', ')}]；负数表示误差下降。`);
const comparison=(stage,n=20)=>Array.from({length:n},(_,i)=>`| ${i+1} | ${['A','C','D',...(r.rankings.E?['E']:[])].map(v=>{const x=r.rankings[v][stage][i];return x?`[${x.name.replaceAll('|','／')}](https://bgm.tv/subject/${x.id}) ${x.predicted.toFixed(3)}`:'—';}).join(' | ')} |`);
const largest=r.data.largestFamilies.map(([id,n])=>`${id}（${n} 部）`).join('、');
const gender=r.gender.fit;
const lines=[
'# 动画推荐离线对照实验 · 2026-09-07','',
`数据快照：${r.snapshotAt}。${r.data.collections} 条动画收藏，其中 ${r.data.rated} 条已评分；固定 ${r.data.candidates} 个未标记、按现有规则确认日本来源的候选。系列关联读失败 ${r.data.relationErrors} 条。`,'',
'结论：这组修改明显减少了单部高分作品对主评分的扰动，但未证明预测质量提高。不要原样替换线上模型。女性角色占比在本次样本上没有稳定的额外收益，且 ±0.08 分依然可能引发高位排序明显变化，暂不建议启用。','',
'本实验不修改生产代码、浏览器配置或线上推荐。实验复现现行主评分阶段；结构化制作人员的 20% 补充混合未纳入任何实验组。因此 A 是同一新快照上的现行主模型，不应当理解为当前浏览器缓存的逐项复制。原始候选召回按现行 10 个榜单页和 12 个标签各 2 页获取。所有排序对照固定该候选库，不混入召回变化。','',
'## 实验组','',
'- A：现行标签画像和评分公式；按评分残差绝对值保留 80 个参考作品，再取最相似 6 个。',
'- B：标签画像不变，参考范围改为全部已评分收藏，仍取最相似 6 个。',
'- C：B 的邻居分分母从 Σ相似度改为 1 + Σ相似度，让单个弱相似样本的影响自动收缩。参数 1 是预先设定的实验值，没有根据榜单喜好调参。',
'- D：C 基础上，同系列 n 部作品在标签学习中的总权重为 √n；最低标签支持数按独立系列计，每组近邻至多取一部。个人均分和整体评分基线仍用全部原评分。',
'- E：D 加女性主要角色占比；用训练集内部交叉验证误差学习一个带收缩的线性系数，适合度增减绝对值不超过 0.08。未给“女性更多”设置固定奖励。','',
'主评分公式保持：0.60 × 标签等内容特征 + 0.25 × 相似作品评分残差 + 0.15 × 全站质量，再按原公式映射适合度。性别特征不参与相似度、候选过滤或 MMR 惩罚。全局 MMR 沿用现行参数；每组先取主评分前 180 再统一 MMR。','',
'## 验证方法与限制','',
`用 BGM 的前传、续集、番外、总集篇、不同演绎、主线和相同世界观关联构成 ${r.data.families} 个连通分组；共享同一个外部关联节点也会并为一组。最大组：${largest}。这是一种保守分组，可能将较大的共同世界观作品归为一组。未读取到的中间关联仍可能漏连。`,
'',
'五折按系列留出，所有模型在同一折上比较。女性特征采用外层五折、内层三折：仅用外层训练作品的内层预测误差拟合系数，外层测试评分不参与拟合。P@20 是每折最高预测的 20 部中实际评分 ≥8 的比例，表中报告五折平均；NDCG@20 同样报告五折平均。MAE/RMSE 为全部留出预测误差。区间使用 1,000 次按系列的成组 bootstrap，表示当前样本下的不确定性。',
'',
'收藏 API 中的条目摘要比独立条目详情稀疏，留出验证使用收藏摘要作为待预测输入，各组完全一致；这些误差不能当作完整元数据下的线上绝对准确率。已看作品也不代表所有未看作品，离线进步不能保证每条新推荐都更喜欢。','',
'## 预测效果','',
'| 模型 | MAE↓ | RMSE↓ | 五折 P@20↑ | 五折 NDCG@20↑ | 预测标准差 |',
'|---|---:|---:|---:|---:|---:|',...rows,'',...intervals,'',
'## 单部高分作品影响','',
'固定候选池，逐一删除“确定性抽样的 30 部 ≥8 分作品”以及“A 前二十的高分参考作品”并重新训练。各模型使用完全相同的删除样本。此项是主评分排序的敏感度，未把 MMR 的变化算入其中。','',
'| 模型 | 删除样本数 | 平均绝对分数变化↓ | 最坏单候选变化↓ | 平均前20保留↑ | 最坏前20保留↑ |',
'|---|---:|---:|---:|---:|---:|',...influence,'',
'## 女性主要角色占比','',
`抽样：${r.gender.sampling||'本次尚未获取角色数据'}。可用数据为 ${r.gender.knownTraining} 部已评分作品、${r.gender.knownCandidates} 个候选。角色详情读取失败 ${r.gender.errors} 条。`,
'',
'仅取 BGM 明确标记“主角”的去重角色，性别来自角色自身 gender 字段或明确的性别信息框；不从声优、姓名或外观推断。至少两位主角性别明确且覆盖率 ≥80% 才启用，女性占比为女性／已知男女主角数，其余保持未知。字段覆盖率参与衰减。该特征表示角色构成，不能衡量人设质量或推断喜欢某位女主。',
'',
gender?`全量拟合系数 ${f(gender.slope)}，中心占比 ${pct(gender.center)}，有效支持 ${gender.support} 部／${gender.independentGroups} 个系列。`:'未拟合。',
r.evaluation.E?`在有数据的留出子集中，D 的 MAE=${f(r.evaluation.E.coveredWithoutGender.mae)}，E=${f(r.evaluation.E.covered.mae)}（${r.evaluation.E.covered.n} 部）。`:'',
'角色数据只覆盖抽样训练作品和 A/D 主评分前40的并集，E 是弱特征的探索性实验，并非全候选完整角色覆盖；不应据此直接在生产环境宣称有稳定收益。','',
'## 额外发现与下一步优先级','',
`现行召回前十二个标签：${r.retrieval.A.tags.join('、')}。其中包含导演、编剧和制作公司姓名；这些字符串进入普通标签通道，无法受到结构化人员补充权重的统一约束。D 也没有消除该现象。`,
'',
'建议后续先统一识别普通标签中的人员／机构名，验证内容标签是否真正主导，再用验证集决定邻居收缩程度；不要直接扩大显示分数来制造区分度。角色占比保留为候选弱特征，需要更完整、均衡的元数据覆盖和新的留出验证。没有将任何口头提到的题材或女主偏好作为固定加分。',
'',
'本次所有改进组的 MAE 差区间都跨过零，因此“平均误差略升”也不构成明确退步的统计结论。分数标准差减小本身不等于更差，但结合命中率没有稳定改善，不足以支持上线。','',
'## 统一 MMR 后的前二十','',
`| 名次 | A 现行主模型 | C 全量邻居＋收缩 | D 再加系列调整${r.rankings.E?' | E 再加角色占比':''} |`,
`|---:|---|---|---${r.rankings.E?'|---':''}|`,...comparison('mmr'),'',
'## MMR 前的前二十','',
`| 名次 | A 现行主模型 | C 全量邻居＋收缩 | D 再加系列调整${r.rankings.E?' | E 再加角色占比':''} |`,
`|---:|---|---|---${r.rankings.E?'|---':''}|`,...comparison('raw'),'',
'## 复现','',
'```powershell',
'node experiments/2026-09-07/fetch-data.cjs --characters',
'node --test experiments/2026-09-07/model.test.cjs',
'node experiments/2026-09-07/run.cjs',
'node experiments/2026-09-07/report.cjs',
'```','',
'API 响应按请求哈希缓存，重复运行沿用快照；results.json 含逐条留出预测、删除样本与排名，rankings.csv 含各组完整原始排序及前180统一 MMR 排序。没有自动发布步骤。',''
];
fs.writeFileSync(path.join(__dirname,'REPORT.md'),lines.join('\n'));
console.log('REPORT.md written');
