# 历史推荐实现

这里保存 0.11.0 重建以前的推荐代码和人工源码快照，用于追溯与旧实验查阅，不参与当前组件构建或月度生产训练，也不是当前需求。核心是重建前最后一版，不保证兼容每个日期的历史实验；精确复现需恢复试验当时的源码和数据。

- `src/core.cjs`、`src/component.js`：旧画像、排序、过滤和界面逻辑。“7 分中性”、80/20 权重、国家/形式规则均为旧方案。
- `tests/core.test.cjs`：旧核心历史测试，运行 `npm run test:legacy`。保留测试不代表恢复旧产品规则。
- `backups/`：四份原始源码备份，文件名保留版本含义；不自动更新、不覆盖、不用于发布。

旧说明见 [截至 0.10.8 的历史 README](../docs/legacy-readme-through-0.10.8.md)，对照试验见 [实验索引](../experiments/README.md)。旧文档保留当时的路径描述；原 `src/core.cjs` / `src/component.js` 已迁到本目录，原 `backups/` 已迁到 `legacy/backups/`。实验代码引用已更新，原始缓存仍留在日期目录，不移动或删除。

生产评测此前仅借用旧核心的 `seriesFamilyKey`，现在等价实现独立在仓库根的 `src/series-family.cjs` 中，用来防止系列跨折泄漏；它不是旧排序策略。新增生产功能应放当前 `src/`，不要继续在归档开发。
