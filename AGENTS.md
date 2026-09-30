# 项目协作与设计准则

本文件是 Bangumi 项目的长期开发约束，适用于本仓库的开发者与 agent。设计原则来自用户于 2026-09-23 制定的 `E:\Note\BUPT\app\AGENTS.md`，于 2026-09-29 完整落入本项目；以下正文可独立使用，不依赖另一台机器上的外部文件。用户后续的明确要求优先，历史实验和旧版文档不构成当前需求。

## 设计原则（用户原文）

AI 开发的核心风险不是能力不足，而是用训练惯性替代需求、用模板替代思考——对策是忠实执行显式约束、站在人类已有最佳实践之上工作、并在迭代闭环中持续对齐。

1. **显式需求优先于模型惯性**：用户给出的明确约束，优先级高于 AI 从训练分布中继承的"最常见做法"。当两者冲突时，忠实执行需求是底线；做不到应如实说明，而不是静默替换成自己熟悉的方案。最常见的失败模式是把"高概率答案"当作"正确答案"。
2. **警惕同质化输出**："AI 味"的本质是输出坍缩到训练分布的均值——技术上无错，但毫无辨识度。功能正确只是及格线，不是质量本身。产出应当体现针对该具体任务的思考与取舍，而非放之四海皆准的模板。
3. **先调研已有最佳实践，再动手创作**：任何成熟领域都积累了大量被验证的优秀方案。正确的路径是先研究人类已有的经典实现（必要时逆向分析），再在此基础上工作，而不是让模型从自己的分布里凭空采样、重复造轮子。
4. **双重视角验收**：同时站在使用者（好不好用、体验如何）和实现者（这个设计/实现选择有没有意图、有没有更优解）的角度审视产出。只满足字面规格的产出永远平庸——需求背后的问题才是真需求。
5. **非功能指标是一等约束**：资源占用、性能、观感、可维护性等"非功能性"属性与功能正确同等重要，属于需求本身，不是交付后的可选项。臃肿和粗糙是缺陷，与 bug 同级。
6. **承认知识边界，以闭环逼近目标**：当自身知识不足以支撑高质量产出时，正确动作是主动调研补齐，而非用默认值糊弄。开发不是一次性交付，而是调研 → 设计 → 实现 → 评估的迭代闭环，每轮都重新对齐真实需求。

## 在本项目中的执行要求

- 开始修改前，核对当前代码、版本、工作区和用户的真实目标；先说明必要的假设与范围。不能用旧推荐的评分阈值、国家/形式过滤等约束代替新需求，不能用收藏操作次数代替观看集数。
- 算法或架构调整先查已有可靠实践，保留关键来源、方案取舍与评测边界。推荐候选覆盖与排序质量分别验证，离线历史评分指标不能直接声称为未来满意度。
- 界面沿用用户认可的简洁、light 风格；保持暗色、窄屏和可访问性。避免无需求的装饰、浮层、统计重复与新依赖。
- 同时验收用户体验与实现质量：核对数据口径、错误回退、操作反馈，以及运行成本、网络请求、包体积、可维护性和数据暴露边界。
- `src/`、`scripts/` 与 `tests/` 只放当前实现、生产工具与当前测试；旧源码、测试和备份放 `legacy/`，历史对照试验保留在按日期命名的 `experiments/` 中。历史结论不得静默变成生产约束。
- 原始个人/公开用户逐条评分与采集缓存不得进入发布产物或 Git；只发布必要的聚合结果。不创建空文档框架或占位模板，文档围绕实际决策、接口和维护需要增长。
- 每轮完成后更新受影响的文档和验证记录；具体目录、验证和交付入口见 [开发维护说明](docs/development.md)。设计原则只在本文件维护，其他文档引用它，避免多个版本漂移。

## 浏览器与电脑交互工具

- 本项目需要浏览器交互时，优先使用 Codex 官方 [@浏览器](plugin://browser@openai-bundled) 或 [@Chrome](plugin://browser@openai-bundled?browserFamily=chrome)。需要用户现有登录态、标签页或 Chrome 扩展时使用 @Chrome；本地预览可使用 @浏览器。先检查实际连接与可用能力，不把官方工具当成第三方服务失败后的备用入口。
- `kimi-webbridge` 保留手动调用，仅在用户明确指定时使用；不因一般网页任务自动触发，也不作为官方浏览器工具的静默回退。
- 浏览器交互与原生电脑操控分开选择工具：本项目需要操控桌面应用或系统界面时，在工具可用且任务已授权的前提下优先使用 KimiCU。保持 KimiCU 服务及现有配置，不因浏览器选择规则禁用或屏蔽它。
- 上述工具优先级仅作为本项目约束，不修改全局 `AGENTS.md`。工具选择不扩大任务授权，也不替代适用的安全或确认要求。

## Project delivery workflow

Unless the user explicitly asks for a local-only draft, do not treat a product change as complete until the full delivery flow is finished:

Once the user has explicitly authorized the task scope and release targets, carry this workflow through without redundant confirmation prompts or asking the user to perform routine delivery steps. Pause only if the scope materially changes or an applicable safety/platform policy requires fresh user input.

1. Implement the requested source and test changes.
2. Run the relevant unit and browser-level verification.
3. Bump every affected release version in `package.json` and update `README.md` release notes.
4. Rebuild and verify the matching files under `dist/`.
5. Commit the source, tests, documentation, versions, and generated release artifacts.
6. Push the current branch to its configured Git remote.
7. Publish the affected Bangumi component version and verify the live version/page behavior:
   - App `6931`: `dist/bangumi-personal-recommender.user.js` (the `.bgm.txt` file is an identical paste-friendly copy).
   - App `7057`: `dist/bangumi-personal-timeline.user.js`.
   - App `7211`: `dist/bangumi-personal-calendar.user.js` (the `.bgm.txt` file is an identical paste-friendly copy).

If authentication, permissions, network state, review policy, or a required confirmation prevents publishing, report the exact blocker and the last completed delivery step. Never imply that a local build or Git commit is already live on Bangumi.

Documentation-only changes and behavior-preserving directory cleanup still require relevant verification, documentation updates, a commit, and a push. If all shipped files under `dist/` and the public recommendation feed remain byte-identical, there is no affected component release: keep its version unchanged and do not republish unchanged code. Any change to shipped behavior or release bytes must follow the full product delivery workflow above.
