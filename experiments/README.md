# 推荐实验索引

这里只保存实际进行的实验、结果与复现代码，不是当前产品规范。生产行为以根 [README](../README.md)、[AGENTS.md](../AGENTS.md)和当前源码为准。

| 目录 | 内容与状态 |
| --- | --- |
| [2026-09-27-rebuild](2026-09-27-rebuild/REPORT.md) | 0.11.0 全新方案依据；含 9 月 28 日最终发布数据，当前为近邻召回与验证门控排序 |
| [2026-09-27](2026-09-27/REPORT.md) | 重建前旧模型评测、候选修复；固定权重和资格口径已被后续方案取代 |
| [2026-09-10](2026-09-10/REPORT.md) | 旧评分语义、标准差、MMR 与近邻诊断；不沿用为新版规则 |
| `2026-09-07/` | 更早的离线对照；`report.cjs` 根据本地 `results.json` 生成报告。原始数据未提交，且模型脚本存在历史 API 不兼容，不能直接当成可运行基线 |

重建目录的 `fetch-peers.cjs` / `evaluate-*.py` / `evaluate-peers.cjs` 是探索与诊断工具；`pilot-input.cjs`、`seed-peer-cache.cjs`、`repair-initial-input.cjs` 是首次迁移恢复工具，不是月度任务步骤。正式刷新只使用根 `scripts/refresh-recommendations.cjs` 和 `scripts/build-recommendations.py`。

保留日期目录名，避免损坏缓存与相对引用；旧对照脚本明确引用 `legacy/src/core.cjs`。旧报告中的“当前模型”仅指报告日期。实验结论在当时数据和边界内成立，不能直接成为用户授权或生产约束。

2026-09-29 兼容性检查：`node --test experiments/2026-09-07/model.test.cjs` 的 5 项中 2 项通过、3 项因 `Core.expectedRating` 不存在而失败。该接口在整理前的根 `src/core.cjs` 中也已不存在，迁移没有引入这个问题。`legacy/src/core.cjs` 是重建前最后一版，不是每个日期实验当时的冻结核心。精确复现早期试验需恢复其当时源码和原始数据；本轮不猜测一个近似历史版本、不修改历史评测算法来让测试表面通过。这些试验不属于 `npm run verify` 的当前/归档核心回归范围。

逐人评分、快照、详情缓存和大体积结果留在 Git 忽略路径。仓库保留方法、必要聚合结果与代码；新机器需要重新合法获取公开数据，不能把缺少原始文件误报为无需数据即可复现。
