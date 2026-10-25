# task-meta v0.4.0 — Reliable Collection & Execution Intelligence
## Product Requirements Document · R2 / ADS v4.18 Claude Independent Differential Review Candidate

| 字段 | 冻结前状态 |
| --- | --- |
| Product Status | **R2_CANDIDATE / ADS_V418_TARGET / NOT_FROZEN / R1_BLOCK_9P1_8P2_UNDER_REPAIR** |
| Review | `INDEPENDENT_CLAUDE_REVIEW=NOT_RUN`；`FREEZE_READY=NO_PENDING_REVIEW` |
| Version | `v0.4.0`，不修改已接受 `v0.3.0` 发布身份 |
| Repository | `kaicreator-mm/task-meta` |
| Product Issue | [#60](https://github.com/kaicreator-mm/task-meta/issues/60) |
| Implementation authority | **NONE**；本文不是 L2/Task DAG/Task Claim/Builder 准入 |
| task-meta source basis | `main@adc0a823bc2be636292fef4dd96d24076646ee20` |
| Frozen v0.3.0 release source | `9731b03e263527e15ae24815a7e26b45e4dd809a`；8/8 Task，Windows Node24 544/544 |
| **ADS 目标规范** | **v4.18.0**；[Product #1320 Freeze](https://github.com/kaicreator-mm/ai-development-standard/issues/1320#issuecomment-6388802387) PRD blob `98772b4594caa44b2611853ae482132f7aefa36b`；[L2 #1321 Freeze](https://github.com/kaicreator-mm/ai-development-standard/issues/1321#issuecomment-6395575157) L2 blob `e3b5106c2fdaa8b2a0bbac5adb32b810fcbd51dd`；设计核查基准 `version/v4.18@2c627606b40f7c82120ae1a0d6736148fe0943e6`，**尚未完成 RQ/main** |
| ADS 历史 main（非当前目标） | `main@a45644d734fdf94da3e6f9c3f90ffe4ce3c25fda`，v4.17 前任源码；v4.18 [#1322](https://github.com/kaicreator-mm/ai-development-standard/issues/1322) 正在完成 I/R |
| Tally source basis | `tally main@fab321845a0eb630d50eb5791f3de54b6870f5fb`；[Tally #62](https://github.com/kaicreator-mm/tally/issues/62) 真实消费端未完成 |

> 本文件所述 `PASS` 指历史 **有精确来源的 v0.3 证据**，不是本 PRD、新版本、跨平台或新 CLI 命令的实际测试通过。除非另有实测回执，本文所有 v0.4 实现、真实 E2E 和 Release Gate 均为 `NOT_RUN`。

---

## 1. 产品决策和用户价值

**定位：** task-meta 是 ADS 约束下的 Agent/Host **被动执行证据采集、事实关联、质量度量及安全 GitHub 报告生产端**。在现有 ZCode、Claude Code、Codex 插件和 v0.3 公共报告实现之上，使采集链能够 **可诊断、可恢复、可度量、可比较**。Tally 仅消费依法发布的 GitHub 原生 Issue/PR/CI/Review/ADS Report/Task Learning 记录；它负责策略、Agent 选择、Task 协调、经验适用性及效果决策。

**面向的用户问题：**
- 插件更新、Agent CLI/桌面差异、Hook 静默失效、Spool/Outbox 堆积，常要人工重复摸索，缺少可复现的健康诊断与恢复说明。
- 只有“观察到的调用次数和耗时”还不能回答是否缺了事件、会话、Token、成本账单或完整 Source/Attempt 绑定；错误统计可能比缺统计更危险。
- TLS/代理/GitHub 失败、ACK 丢失、SessionEnd 不发等真实 Host 问题需要有界恢复，既不中断 Agent，也不误发布、重复发布。
- ADS v4.18 Task DAG/Scaffold 协作更并行后，需要记录真实 Lane/角色/等待/返工和物理环境证据，才能判断计划是否优化了执行。
- 真实 task-meta→GitHub→Tally→GitHub 闭环尚缺独立生产消费者回读；不能用生产端 Golden 或单次 GitHub 评论替代。

**v0.4 结果边界：** **明确采用 ADS v4.18.0 作为 Product/L2/DAG 设计基准。** 先把可靠采集与观测质量打牢，再开放可复算的执行成本/协作分析事实。不得把 task-meta 升级为调度器、规则引擎、Agent 排名平台或新公共报告协议。

## 2. 基线 / 差异矩阵（禁止重复实现）

| 能力 | v0.3 已存在 / 有证据 | v0.4 的最小有效增量 |
| --- | --- | --- |
| 三 Agent 采集 | ZCode/Claude/Codex Hook、插件版本 0.3.0、私有 Spool、Agent→GitHub 有界 E2E | 跨已安装 Agent CLI/插件版本的 **health diagnosis**、可靠自动发现与不破坏配置的修复建议；未知 CLI 功能不猜 |
| 事实关联 | `src/evidence-join`、`src/lineage`、Task/Attempt/physical call 分离 | 覆盖率/未知原因分类，未关联或丢失事件的可验证统计与可解释状态 |
| 发布 | `src/autoreport/*`、隔离 source-adoption+clearance、Outbox、读回/幂等 | 中断/网络故障后的有界恢复与可观测诊断；无新增“绕过 HELD 的发布捷径” |
| 质量/成本 | `src/metrics/comparison.ts`、`src/aggregates`、v5 typed metric/source/cost basis | **可比性和数据质量证据**，真实捕获开销的基线/增量，失败/重试/缺测分母 |
| TraceML/C08 | `src/trajectory`、owner-governed Pivot/Revisit、独立分母 | 仅补充有来源的执行协作与阶段时间 *事实*，不把技术候选升级成策略判断 |
| 规范/契约 | ADS v4/v5 vendor pin、Golden、Release qualification | 只消费项目**明确采纳且兼容**的 ADS；v4.18 未正式采纳前仅做可逆私有映射/fixture，不能创造公开字段 |
| Tally | GitHub-only handoff 已约定；消费者真实应用 E2E `NOT_RUN` | 隔离的跨项目测试计划/生产者配合、实际回读对账；外部依赖不可假装 task-meta 自己完成 |
| 规则与知识复用 | `AGENTS.md` + `.agents/skills/task-meta-agent-cli-validation/SKILL.md`；Claude alias、现有 README 排障流程 | v0.4 由**单一 typed Doctor 诊断规则表**负责问题类别/检测与状态；Skill 保留操作步骤并引用 Doctor 规则 ID，不复制另一套事实规则（无二次安装器/守护进程） |

**历史验证事实：** v0.3 Windows Node24 544/544、source-only Golden 和三 Agent 不同范围真实证据见 [#27](https://github.com/kaicreator-mm/task-meta/issues/27) / [#46](https://github.com/kaicreator-mm/task-meta/issues/46)。Codex 桌面 0.3.0 Stop→Outbox 曾通过，但 **五种结束路径无 SessionEnd 事件**，`SessionEnd_Correlation=NOT_QUALIFIED`；参见 [#46 真实 Host 补充](https://github.com/kaicreator-mm/task-meta/issues/46#issuecomment-6384041266)。Claude 真实 Hook 观察与模型鉴权成功是两件事；ZCode 当前并不约定 SessionEnd Hook。所有本地配置/CLI 可用性均应在实际目标 Host 再核定。

### 2.1 ADS v4.18 的目标采用与当前权限边界

**产品决定：明确选用 ADS v4.18.0 冻结 Product/L2 作为 v0.4 的设计参考；v4.18 未完成发布前不将规划提示视为新的运行时权限。** 冻结权威来自 [#1320 Product Freeze 评论](https://github.com/kaicreator-mm/ai-development-standard/issues/1320#issuecomment-6388802387) / Git blob `98772b4594caa44b2611853ae482132f7aefa36b` 和 [#1321 L2 Freeze 评论](https://github.com/kaicreator-mm/ai-development-standard/issues/1321#issuecomment-6395575157) / blob `e3b5106c2fdaa8b2a0bbac5adb32b810fcbd51dd`，**不是 PRD 文件头部旧 `NOT_FROZEN` 描述**。当前设计比对源 `version/v4.18@2c627606b40f7c82120ae1a0d6736148fe0943e6`；已观察 A/B/C/I 已关闭，R 正在实施、RQ/main 尚未完成；后续再次检查 currentness。

| 规范层 | task-meta v0.4 的处理 |
| --- | --- |
| Capability / Concern / Lane | **先按独立子需求拆 Concern**，Lane 内可有自己的 Contract/Core/Test 步骤；不能把开发步骤直接当唯一全局串行 Task DAG |
| Scaffold / Sources | **条件性**复用已接受的 SF↔DF/MI、模块 Contract、源码 Anchor/单 Writer；没有已接受 Scaffold 时 `SF_Binding=NOT_APPLICABLE`，不强行创建 |
| DAG / Builder / Claim | GitHub **native blocked_by** 仍是权威；v4.18 **Option A** 不创建 merge-only 绕过或新的 ready_builder/ready_merge。只读 PREP 不能授予源码写入；合法 Task 拆分与 native dependency mutation/readback 后独立 Claim 才能实施 |
| 角色和 handoff | 在现有 Task Pack/Execution Pack 规划 WEB/CI/LOCAL/独立 Reviewer、可用 Agent 能力、写集/共享资源及最小 Local handoff；不新建调度器、模型 Router、强制人审或每 Step Issue |
| task-meta 数据面 | 被动捕获 Native Issue/Claim/Review/Host、Lane/Step 的证据及缺失状态，不创建第二事实源、改变 Claim/Gate/Task 或以策略分析代替证据 |
| 公开数据与发布 | **v4.18 不新增 ADS 公开 Schema**，因此即使未来 RQ/main 完成，也不会自动存在 lane/concern/parallelism 的合法公开字段。FR07 在 v0.4 **只做私有 source-pinned 事实/Golden**；公开此类新维度必须另走 [ADS #1258](https://github.com/kaicreator-mm/ai-development-standard/issues/1258)/[#1260](https://github.com/kaicreator-mm/ai-development-standard/issues/1260) 的规范新版本。现有 report 发布使用当时实际 qualified adopted pin + strict schema + target/source clearance，绝不借规划规范解锁权限 |

**两个不同用途不得混淆：** (a) ADS v4.18 作为 task-meta **自身 Product/L2/DAG 规划方法**，在正式 Release 前仅能采纳与现行有效规则不冲突的建议性结构分析；**当前有效 pin** 的 native Issue/JIT/Claim/ready_builder/Release 仍是执行硬门禁，不能用 v4.18 草案抢先降级；(b) ADS v4.18 作为 FR07 **观察对象**，只读实际 native 事实/明确 owner-written refs，不推断未物化的 Concern/Lane/Step。

**单独的 ADS 采纳 Concern（不是 A/B/C Release 前置）：** 将来 ADS v4.18 Release-qualified/main 成立后，由独立版本采纳 PR 核对并更新 `config/ads-adoption.json`、`vendor/ads/PINS.md` 及 byte-identical vendored 来源（当前普通 v5 有效采用为 `adopted: 4.16.0 main@718fb02e33b31f568736447b2b905883cc6fcc3a`, schema blob `7478313cc006162432649d734e59c5cd77db5106`；候选版本 `owner_authorized.ads_pin=3041a1be...` 保留为无正式权限的历史记录）；复用 v3/v4/v5 回归 Golden、精确 source/blob 和 source-owned clearance。采用 v4.18 本身也 **不会**新增公开 Lane/Scaffold wire。Product/L2 Freeze、DAG Materialization 与 RQ 时分别复核有效 pin 和标准 currentness；实际新权限仅以合法 owner 发布记录授权。

## 3. 主用户旅程与主体

**J1 安装/升级/诊断（项目开发者 / 本地 Agent）：** 读取已提交 Skill → 只读检测 Agent 及 Node 版本、当前插件/Hook、健康状态 → 报出已知且有证据的异常/恢复方式 → 显式确认后才允许有写副作用的安装或修复 → 发起短小真实 CLI Agent 任务 → 生成明确分层验证回执。

**J2 正常采集（Agent + 本地 Host）：** 一次被授权 Task 运行产出私有 Hook/模型/工具事件 → source/session/physical Attempt 归属 → 保持 private evidence、质量覆盖度和计费来源 → Stop/SessionEnd（若受该 Agent 支持）/settle → 有权限才进行 ADS 报告发布；否则 `HELD` 且可恢复，绝不阻断 Agent 结束。

**J3 故障恢复（项目运维）：** 停电/Host 退出/TLS 断开/429/POST ACK 丢失后再次启动 → 从 append-only Spool/Outbox/真实 GitHub 完整读回确认 → 同标识+同 digest 识别已发布；不同 digest typed `CONFLICT`；无法确认则 `UNKNOWN/HELD` 而不是盲 POST。

**J4 执行改进度量（ADS/Tally 用户）：** 对两个具有合法同风险/任务类型/环境/来源的 Task，查看来源完整度、失败/重试、有效工作与等待区间、真实 billed/provider-reported/estimated、物理 retry；不满足共同分母则 `NOT_COMPARABLE`。Tally 依据 GitHub 有界公开事实决定是否采用经验，task-meta 不给自动派发建议。

**J5 跨系统验收（Tally 产品/独立 Reviewer）：** 在专用隔离受授权 Task 上，真实生产端 GitHub 报告 → Tally 真实 GitHub-only reader → Tally 写入合法事实反馈 → task-meta 重读 GitHub 反馈；所有方向以真实实体 ID/digest/权限/版本 pin 证明，任一缺失保留 `NOT_RUN`，不得回退为 Tally 直接读取 task-meta 数据。

## 4. 功能需求（按 Lane/优先级）

### FR01 [P0, Lane A] CLI-first Doctor — **仓库源码 CLI，不打包到插件**

1. **Product 定案**：v0.4 提供 `node src/cli.ts doctor` 作为项目 checkout 的只读诊断入口；保持 `package.json private=true` 和无 `bin`，**不做全局 `task-meta doctor` 安装、不向三个 Agent 插件复制 Doctor、不新增升级管理器或长驻服务**。目标用户是持有 task-meta checkout 的工程 Agent/维护者；外部用户可先按现有 Skill 检查，不暗示插件天然附带 Doctor。
2. **唯一问题定义源**：Doctor 代码内的 **typed versioned diagnostic catalog** 为规则 ID、条件、证据、等级、建议、支持矩阵的唯一机器权威；现有 `.agents/skills/task-meta-agent-cli-validation/SKILL.md` 只维护操作步骤/安全原则并引用 catalog ID 或 CLI 输出，不另复制诊断判断逻辑。规则版本/OS/Agent CLI 能力必须带可重现来源；改动相同症状时用源码/文档一致性检查防止两份知识分叉。
3. 默认 `READ_ONLY`，明确只读允许集：manifest/marketplace/Hook config（仅支持字段）、`node --version`、受支持的 Agent `--help` 与 `--version`、插件版本、Spool/Outbox **元数据和聚合计数**、`_errors.log` 的**错误类别**、已选的公开 ADS pin 状态；仅查看 Trust **是否存在** 的可观测标志，不读取 Trust 值/hash 或认证储存库。**禁止读取** Codex/Claude/ZCode 的 auth/credentials、token/key/cookie、原始 prompt/转录、工具输入输出、绝对本地私有路径；不未经允许连接远程 GitHub 或打印 home 路径。报告必须过 privacy scrub。
4. 输出分开：`SOURCE_ONLY|HOOK_FIXTURE|REAL_AGENT_CLI|REAL_HOST_GITHUB|DESKTOP_ONLY` 证据级别；`SUPPORTED|UNSUPPORTED|UNKNOWN|DISABLED|NOT_RUN` Client 能力。没有真实 Agent 自动触发 Hook 的事件时 `REAL_AGENT_CLI=NOT_RUN`；不通过调用 Hook fixture 替代。ZCode workspace `.agents/skills` 优先，Claude Skill alias、Codex 桌面 Trust/CLI 分别诊断；任何 CLI 子命令以本机 `--help` 为准。
5. v0.4 **无自动 repair 命令**。Doctor 仅提示最小 CLI-first 手动修复方式；如涉及 Marketplace 更新、用户级 Home/trust 或权限修改，必须由用户实际显式授权另行执行，不能由 Doctor 提权。历史 Codex 五种桌面退出的 [#46 实测](https://github.com/kaicreator-mm/task-meta/issues/46#issuecomment-6384041266) 仅在相同版本/Host 下作为已有证据，绝不为了跑 Doctor 反复打开 UI。

### FR02 [P0, Lane A] 生命周期和 Hook/Spool 完整度（共享 T0 私有契约消费端）

1. 复用 v0.3 Hook/source event/session/turn/tool ID/JCS digest 与 Agent capability；不强迫所有 Host 都发 SessionEnd。Stop/settle/outbox 是自身证据，绝不伪造 SessionEnd 或 Task/Review/Host PASS。
2. **统一采用 T0 私有枚举/结构**，FR02 不再定义第二套原因 taxonomy：`missing_reason = NOT_INSTRUMENTED|HOST_EVENT_NOT_OBSERVED|ADAPTER_FAILURE|UNBOUND|SOURCE_DROPPED|CLOCK_UNTRUSTED|OUT_OF_SCOPE|UNKNOWN`；`evidence_level = OBSERVED|SELF_REPORTED|INFERRED|UNKNOWN`，二者**正交**。缺事件不自动归因 HOST 或 ADAPTER；不能判定根因时是 `UNKNOWN`。ZCode SessionEnd 未声明为 `NOT_INSTRUMENTED`（不形成应观测分母）；Codex 已声明但当前五路径无事件为 `HOST_EVENT_NOT_OBSERVED` **只限事件缺失被实际证明时**，根因仍 UNKNOWN。
3. FR02 根据实际 Source/Host/Agent 能力生成生命周期状态和缺失证据，FR03 只读取并聚合这一类型；同 source-event+digest 去重，同 ID 不同 digest = CONFLICT；不同 physical retry、逻辑 Agent、Session、GitHub 同登录独立保留。
4. 真实 Host 缺 SessionEnd、重复 Stop、进程失效、窗口 ID 不一致可以影响覆盖率，但不阻塞 Agent 安全结束；Desk-only 五路径不作为新的 Windows CLI 验收通过。

### FR03 [P0, Lane C1] 可审计 Capture Quality — 六种测量按实际分母分级

1. 唯一私有诊断类型来自 T0（`src/model.ts` 单 Writer）：`source_revision`、adapter/Agent/Host version、epistemic、clock、coverage_scope、missing_reason、denominator proof/ref。重用 v0.3 `Epistemic`/`Coverage`/`MetricIdentity`/provider capability，**不另建 ADS public enum**。
2. 各指标必须返回 `numerator`, `denominator|null`, `denominator_source`, `scope`, `coverage_kind=CONDITIONAL|ABSOLUTE`, `capability`, `provenance`, `exclusion_reason`。6 项按下表计算；条件比率**不等于全局绝对覆盖率**：

| 私有指标 | 合法分子 | 可证明分母及来源 | 缺失/受限语义 |
| --- | --- | --- | --- |
| Binding | 已与精确 Task/Attempt 绑定的**合法已观测**事件数 | JCS 验证后的去重观察事件集合（`CONDITIONAL`）；Host/Provider 若未报告总发出事件数，不得宣称总体采集完整率 | 无完整输入集合时总体 `DENOMINATOR_UNKNOWN` |
| Tool pair | 匹配 Pre/Post 且 ID/类型可核的 Tool 调用数 | 已观测有真实 PreToolUse 的唯一调用 ID（`CONDITIONAL`）；未发 Pre 的潜在 Tool 不计入预期总体 | 仅单 Pre/无 Post 记作未配对；无 hook 的 Agent 为 NOT_INSTRUMENTED |
| Lifecycle | 被该 Agent **声明支持且明确发出了起点**的 Session 中，观察到可比较终态事件的数量 | 可归属的 SessionStart session 集合 + provider/Host 支持与可观测结束事件契约（`CONDITIONAL`，终态必须标注 Stop≠SessionEnd） | ZCode SessionEnd N/A；Codex 终止事件未发只报告对应路径的非完整；SessionEnd 无预期证明不算缺漏 |
| Token/cost basis | 有可核 provider usage/账单来源和单位/窗口的**已观测** model 调用数 | 有明确 model-call ID 的调用集合；若 Provider 不给总调用集合，标 `CONDITIONAL`，真正 billed 覆盖率另需账单全集 | 不支持 usage → `NOT_INSTRUMENTED`，不是 0 tokens；无可数 model call 时 `DENOMINATOR_UNKNOWN` |
| Publication reconciliation | GitHub 实际确认 comment ID+digest 或明确拒绝/冲突的受管出版尝试数（状态分开统计） | 私有 Outbox 中可验证且身份稳定的 publish attempt 集合（`CONDITIONAL`） | ACK 丢失/不完整分页为 UNKNOWN；HELD 不等于成功发帖 |
| Verifier/source | 有真实 exact source/Verifier 自身终态证据的 eligible Attempt 数 | Source 指明 eligible Attempt 全集；若范围只有已观察 Attempt 则 `CONDITIONAL` | 未被选入观察集的 verifier 不推断；未运行是 NOT_RUN |

3. 表内 denominator = 0 **不返回 100% 或 0%**，输出 `NOT_COMPARABLE` / null；每个指标实际不支持/尚未观察到就显示 `DENOMINATOR_UNKNOWN`，不编造总体 Agent 使用率。新增正例 A22 明确两个有 Pre 的独立 Tool、一个匹配 Post，Tool pair = **1/2 CONDITIONAL**；三条合法可归属事件中两条有 Attempt ref，则 Binding = **2/3 CONDITIONAL**；重复事件不增分母（A05）。
4. 相同比较 cohort 的最小 identity：`task_kind, risk_class, agent_id, plugin_version, provider_capability_revision, pricing_revision_or_UNKNOWN, OS/Host_class, observation_window, measurement_basis`；只有对应维度具备足够 Source 并兼容才 `COMPARABLE`，否则标 `NOT_COMPARABLE`。FR06/FR07 统一引用这一规则；不得仅凭模型名称/成功样本生成排行榜。

### FR04 [P0, Lane B] Outbox 恢复的 **v0.4 真增量**（复用 T18）

**已有真实证据，禁止重做为新功能**：v0.3 `src/publish/publish.ts` 已实现完整分页核对、同身份幂等/冲突；`src/publish/client.ts` 已解析 Retry-After；`src/autoreport/outbox.ts` 具备私有 append-only 与 Session 锁；`scripts/e2e-fault-injection.ts` **T18 已在 v0.3 固定精确源码**测试丢 ACK/POST 后崩溃、并发 Publisher/Session Lock、已编辑评论及分页等路径，参见 [v0.3 #46 RQ](https://github.com/kaicreator-mm/task-meta/issues/46) / [PR #54 独立 RQ](https://github.com/kaicreator-mm/task-meta/pull/54#issuecomment-6382732452)。A08 仅需当前 v0.4 SHA 上对现有 T18 Oracle 回归；发布逻辑无变更时可以复用原真实 GitHub 回执，不强迫刷新网络负面试验。

**v0.4 独有增量：**
1. 在现有 `auto-report --retry` **人工重试** 之上，支持独立、可停止的 **受控自动重试**（可设最大次数、单次退避/Retry-After、总时限与资源预算；默认不开无限恢复）。错误 429/503/TLS/断网选择原因敏感、权限与 Source 再核验；每次外部效果前进行真实原生分页 readback，结果不完全保持 UNKNOWN/HELD。
2. 私有 Outbox 新增 `UNKNOWN` 用于**已尝试效果但远端结果不可证明**；`FAILED` 专指有可靠证据确认**未执行或未成功应用**的确定失败。已存在 `HELD`/其他 Outbox 状态保持语义，不能把 UNKNOWN 混到 FAILED 重驱；新类型由 T0 统一只定义一次，其迁移/旧 Outbox replay 必须不篡改历史数据。
3. 每次重试重新验证 ADS effective adoption+schema blob/Target/Source/clearance/当前 GitHub grant；不可复核的权限/网络不许乐观 POST。删除的评论或同键异 digest 必须走 **原有 publish reconciliation** 或明确 UNKNOWN/CONFLICT，不盲目创建第二条。延迟 403/429/timeout 的源头采用可控本地代理+隔离 E2E sink，不使用恶意真实配额刺激。
4. 收集 GET/readback 数量、恢复延迟、重试预算消耗、最后状态、信息安全的错误原因；Spool/Outbox/private 记录保持 append-only/JCS-digest，日志不得包含 token、原始模型/工具正文或私有路径。
5. 和 A/C 的接口仅使用冻结 T0 private types；**B 独占** `src/autoreport/**`, `src/publish/**`, `scripts/e2e-fault-injection.ts` 等写集，且不修改共享 `src/model.ts`。

### FR05a [P0, Lane C2] 最小真实测量基线（MUST）

1. **不可被 NOT_MEASURED 空白替代**：在**Windows + Node24** 实际 Host，至少构造一个可重复、无外部模型费率依赖的 `HOOK_FIXTURE` 同版本对照组：捕获关闭/仅启动 shell/Node 空 Hook vs 启用真实 metadata-only Hook（**同样任务负载、事件 fixture、Host、进程版本**）。采集实际子进程 wall clock、CPU、peak RSS（不可计则单项明确 N/A 但 wall+Spool bytes 必须真实）、Spool bytes/append 数；对 Stop→Outbox 执行单独有来源测量。
2. 所有必须测量的最小组合至少做 **5 次成对重复**，给出样本量、median、range、测量工具与精度、Host OS/Node/插件/commit SHA 和原始但脱敏回执。此采集基线为运行时测量，不等于实际 Agent CLI 全链路质量或 CI PASS。
3. 若 Windows Node24 实际 Host 不可达，`FR05a=NOT_RUN` 且版本核心 RQ **不得默认为 READY**；只能按既有合法 Release-owner 对该具体 Host 义务作有证据的限定 waiver/CONDITIONAL 评估，不能把未测量说成通过。**不是**“无可信对照所以未测也满足 MUST”。

### FR05b [P1, Lane C2 or future] 性能优化（SHOULD）

4. 高并发 Agent/实际完整模型会话、Ubuntu、新电脑/Agent 版本等**额外** cohort 在缺乏同风险合法对照时允许 `NOT_MEASURED`，不能宣称加速百分比；不预设 0 开销、30% 性能提升等。
5. **保留现有 append-only/CAS 无 DB 优先**。先测磁盘/队列与 Host 调用成本，只有真实瓶颈才评估 batch/incremental-scan/索引/WAL；不默认添加 SQLite/Postgres、Web Dashboard 或常驻服务。磁盘满、Backlog 增长、stale lock 要有有界且不阻塞 Agent 的状态/告警（A21）。

### FR06 [P1, Lane C] Token/工具/成本可比性与来源质量

1. 现有 `src/metrics/comparison.ts` 的度量身份与重复去重继续为权威实现；新增的是实际 provider capability/时窗/覆盖率与 **重算解释**，而非第二个 billing reducer。
2. 严格分离 `BILLED`（实际结算证据）、`PROVIDER_REPORTED`、`ESTIMATED`、`UNKNOWN`，标注定价 revision、货币、窗口、cache read/write 是独立桶还是包含于 input token、logical 调用与多次 physical retry、嵌套/重叠 span。
3. 统计至少包括失败/取消/UNKNOWN Attempt 分母；不能只选成功样本给出 Agent 成本排名。跨模型/项目/Host 仅在任务种类/风险、能力捕获和定价一致时可比较，不满足则 `NOT_COMPARABLE`。
4. 数据够用的事实输出仅通过已合法选定 ADS public schema/clearance 发布；否则内部可查，但不能在 GitHub free text 冒充结构化可计算指标。规范缺口指向 [ADS #1258](https://github.com/kaicreator-mm/ai-development-standard/issues/1258)。

### FR07 [P1, Lane D] ADS v4.18 **私有、被动、真实来源** 的 Task DAG 观察（公开增强 DEFER）

1. v4.18 Product/L2 已冻结的 Capability/Concern/Lane/Scaffold 仅用于 **本项目 DAG 规划与私有 source-only 研究**。ADS v4.18 **不产生新机器可读的 Capability/Lane/Step 字段或公开 Schema**；FR07 不进行任意 Markdown 模板文本语义抽取、不构建替代 Native DAG/Claim/Readiness、不授予执行准入。
2. 可观测事实来源映射：

| 私有事实 | 唯一许可的原始 Source | 缺失时 |
| --- | --- | --- |
| Task/Issue/PR/native edge | GitHub Issue/PR 编号、native blocked_by 完整读回、exact HEAD/Tree | UNKNOWN（无完整分页/权限时不可推断无 edge） |
| Dispatch/Claim/Actor role | ADS 实际有效的有身份签发的 Dispatch/Claim、原生 Reviewer/CI run source refs；仅记录实际 `actor_role/operator_id` | UNKNOWN，不能从 GitHub 登录或模型名称推断 |
| Concern/Lane | **只有**物化 Task Issue 或冻结 Task Pack 内由 owner **显式填写并精确 pin** 的 identifier 才可追踪；普通非机器化 Lane 文本不解析 | `NOT_APPLICABLE` 或 `UNKNOWN`（按对象是否应存在） |
| Step | 内部局部 Step 不保证成为 Issue 或公开字段，**默认 NOT_APPLICABLE**；确有 owner/source ID 才可做私有 ref | NOT_APPLICABLE |
| Review/CI/Host/Elapsed | 真实 GitHub Review/CI URL+Run ID、实际 Host/Agent Hook 原始时间及钟域与精度 | UNKNOWN/NOT_RUN，绝不伪造已通过 |
| Source Scaffold | 已**合法接受**的 SF↔DF/MI 与精确 Anchor/owner，Task Pack 明确绑定 | 当前 task-meta **无已接受 Source Scaffold**：`SF_Binding=NOT_APPLICABLE` |

3. v4.18 **Option A**：Native blocked_by/JIT/Claim/ready_builder/Review Gate 仍取本项目当时**实际 effective standard pin** 的正式准入；一个“准备可以并行”的规划注释绝不能改变原生依赖。只读 PREP 与 Task 可写权限分离；Reviewer 的 `operator_id` 与 Builder 不同仅是事实字段，**不是独立性 PASS**（由真正 Review 权威判断）。
4. 仅有可比较的单 Host/单时钟域原始 Span/开始-结束证据才给出 `active_union_ms` 等有意义的时间数字；跨 Host Skew/重叠与缺失为 UNKNOWN，不能从 tool_name 推断分析/思考时长，也不判断串行 Task DAG “不合理”。可以给出**计划表边数 vs 原生 edge 数 vs 观察到的重叠时段**，但不能输出 `JUSTIFIED|UNJUSTIFIED` 的拓扑质量评审结论。
5. **公开范围 DEFER**：即使 ADS v4.18 未来 RQ/main/adoption 完成，它也**没有任何新的公开 lane/concern/topology metric wire**。FR07 的事实、演练、Golden 只在 private/source-only 保存；真正需要公开需由 [ADS #1258](https://github.com/kaicreator-mm/ai-development-standard/issues/1258)/[#1260](https://github.com/kaicreator-mm/ai-development-standard/issues/1260) 的后续独立规范版本制定合法 Schema 和权限，再单独 Product 准入。Tally 不读取私有 FR07。
6. v0.4 **不把 D 作为核心 Release Gate**；仅要求在 Product/L2 评审中有真实来源/权限决策、与 v4.18 frozen 语义兼容的 **source-only fixture/文档**。如果 D 的实现未被后续 Task DAG 采纳，作为明确 DEFER 而不声称完整执行可观测性。

### FR08 [P1, Lane E] GitHub-only Tally 真实闭环的生产者配合

1. 建立版本明确、能力明确的生产者/消费者互操作矩阵：被授权 ADS report dialect、Schema blob、GitHub native comment、Tally C GitHub reader 解析/去重/Currentness/权限、Tally feedback、task-meta 重新观察反馈。Tally 仅从 GitHub 消费，禁止直连 task-meta SDK/API/DB/Manifest/raw Trace。
2. 测试至少一个合法正例和一个权限/Source/revision/断页负例；每段单独标记 `SOURCE_ONLY|REAL_PUBLISHER|REAL_TALLY_APP|REAL_FEEDBACK_READBACK|REAL_HOST|CI`。
3. **版本发布边界：** 真实 Tally v2 App 尚未交付/未授权 Host 时，v0.4 可完成生产者协议 Golden/接口文档，保留 `REAL_TALLY_APP=NOT_RUN`；**不把外部消费者未完成作为任务采集可靠性 Release 的默认硬阻断**。但不得宣称“task-meta→GitHub→Tally→GitHub 已完整 PASS”。
4. 外部责任明确归于 [Tally #62](https://github.com/kaicreator-mm/tally/issues/62)、[Tally #72](https://github.com/kaicreator-mm/tally/issues/72)、[ADS #1210](https://github.com/kaicreator-mm/ai-development-standard/issues/1210)；task-meta 原 [#8](https://github.com/kaicreator-mm/task-meta/issues/8)/[#14](https://github.com/kaicreator-mm/task-meta/issues/14) 继续保留未完成的消费者边界，不另建独立 Tally reader。

### FR09 [P2 / 后续版本候选, Lane F] 数据化学习与经验效果证据

1. 复用当前 [#7](https://github.com/kaicreator-mm/task-meta/issues/7)、[#9](https://github.com/kaicreator-mm/task-meta/issues/9)、[#17](https://github.com/kaicreator-mm/task-meta/issues/17) 的事实、捕获质量、比较矩阵，按可证明根因归并重复观察；否则 `SAME|RELATED|DIFFERENT|UNKNOWN` 中保持 UNKNOWN。
2. 经验被**呈现**、被**应用**、被**独立验证**、产生**观测后果**是四个不同事实；不能仅因同一模型、GitHub 登录、引用 Skill 或文字相似就断言效果。保留 `TASK_LEARNING=NONE_MATERIAL` 低成本路径。
3. v0.4 **仅明确兼容性和最小支持**；自动改 Skill/Rule/Workflow、生成 Domain Package、挑选 Agent、训练模型或自动调参均不进入 v0.4 实施，属于 Tally/后续 v0.5 的产品和权限决策。

## 5. 非功能要求 / 不变量

| 维度 | 必须保持的约束 |
| --- | --- |
| 权限和标准 | ADS 是公共 wire 与权限规则 Owner；原始 native GitHub/CI/Host/Review 是 Task 结果来源；Tally 是调度/决策 Owner；task-meta 无 Gate/Claim/Task 决定权 |
| 安全与隐私 | 仅受控元数据采集；不存/不公开 CoT、原始 Prompt、工具输入输出、凭据、私有路径、hidden grader；先安全投影再授权发布 |
| 故障语义 | `HELD/UNKNOWN/CONFLICT/NOT_RUN` 不改写为 PASS、空集合或 0；同物理 Attempt 不因不同 retry/delivery 被合并 |
| 可移植性 | Node 24；Windows 为 v0.3 已验证范围，Ubuntu/Linux 若 v0.4 声称支持必须有真实 Host 证据；不强迫无关外部环境门禁 |
| 数据一致性 | 复用 private append-only/CAS/Outbox，稳定 identity 与 RFC 8785 JCS digest；无新默认数据库或第二套 GitHub 报告协议 |
| 低干扰 | Hook 快速、失败不阻塞 Agent；少量终态 GitHub 报告，不按工具事件 flood comments |
| 运维 | 默认只读 Doctor；自动修复不能篡改信任、弱化授权或未经允许修改用户级配置 |
| 版本 | 冻结 v0.3.0 SHA 保持历史；v0.4 版本隔离分支、PR 局部 Review、独立 Release Qualification 后才允许合 main |
| 测试诚实 | source-only fixture、Hook fixture、真实 Agent CLI、真实 GitHub、真实 Tally、CI/Host/Release 结论分别签发；CI 不可用用限定 waiver/NOT_RUN，不假 PASS |
| 兼容成本 | 1.0 前不强制兼容旧内部 API，但已公开的 ADS v3/v4/v5 历史记录不得重新解释或破坏；新增私有诊断字段必须明确当前版本 |

## 6. 可证伪验收矩阵（R2 候选；精确结果不可代替真实 Host）

| Case | 输入/场景 | 明确 Oracle / 证据等级 |
| --- | --- | --- |
| A01 | 在 repo checkout 运行 `node src/cli.ts doctor`，三 CLI 支持状态不同 | 只读实际 Agent/Plugin/Node24; `NOT_RUN/UNKNOWN/UNSUPPORTED` 诚实，`SOURCE_ONLY`/命令帮助来源 |
| A02 | 手动 Node Hook fixture，没有 Agent 自动调用 | 只得 `HOOK_FIXTURE_PASS`；`REAL_AGENT_CLI=NOT_RUN` |
| A03 | Codex desktop 0.3.0 五路径退出没有 SessionEnd；新的 Client 未实测 | 仅复用 [#46](https://github.com/kaicreator-mm/task-meta/issues/46#issuecomment-6384041266) 历史 `DESKTOP_ONLY` 事实；新 CLI 未验收；不制造终态或新 UI 义务 |
| A04 | ZCode 0.3.0 Hook profile 不声明 SessionEnd | `NOT_INSTRUMENTED`，SessionEnd 不进入生命周期预期分母 |
| A05 | 同 event/digest duplicate + 同 ID 异 digest + 两次真正 Retry | 前者计 1、第二种 CONFLICT、合法 physical attempts 计 2；覆盖率分母同样去重 |
| A06 | 缺 PostToolUse、Provider token usage、Verifier 或真实 Source | 按 FR03 六指标的具体分母和 `missing_reason` 返回 null/UNKNOWN；未观测值不等于 0 |
| A07 | Hook 出错、权限不足无法写 Spool、错误分类 | Agent 仍可完成，Doctor 不读取/输出敏感文件，分类与 source-level 问题目录一致 |
| A08 | v0.3 T18 lost-ACK/post-crash/同键冲突/分页回归 | 复用 `scripts/e2e-fault-injection.ts` + v0.3 原回执；新 v0.4 SHA 上的 source regression；**仅 publish/retry 路径变更后才需追加真实 GH 回读** |
| A09 | 受控本地代理注入 429/503/TLS timeout，断网、失败分页、重启 | 预算有界、Retry-After 受控、权限再核对、`UNKNOWN/HELD` 不盲 POST、实测回执 |
| A10 | 无合格 ADS adopted-main pin/source clearance 的普通 GitHub repo | `doctor/retry/collect` 都未授权 POST，`HELD` 且具体原因；负例可本地 fixture |
| A11 | **Windows Node24** 最少 5 组相同 synthetic workload Hook OFF/ON | wall clock、Spool bytes、Stop→Outbox 实际测量；标 sample n/median/range/version/exit；未运行 `FR05a=NOT_RUN`，不得算 MUST PASS |
| A12 | 嵌套/重叠 parent-tool Span 与物理 retry | leaf 统计/时间区间 union 不双计；`wall-active` 不解释为 thinking |
| A13 | 只有 provider-reported，没有真正 invoice | 结果 `PROVIDER_REPORTED` 而非 `BILLED`；币种/窗口不兼容则不可比较 |
| A14 | native blocked_by 是串行，但 Planning 文档说可并行，Host 钟漂移 | 私有仅输出 source/provenance 与 observed overlap；不做“无故串行”策略判定 |
| A15 | ADS v4.18 已选 Product/L2 但尚无新公开 Schema | 不论未来是否 RQ/main，**任何新 Lane/Topology/Scaffold public key 都不得发**；需另行 ADS Schema Owner |
| A16 | Tally 实际 C GitHub reader 未交付 | producer conformance Golden 在 Gate；`REAL_TALLY_APP=NOT_RUN` 被允许为外部未完成，不能自称全环 PASS |
| A17 | Tally feedback PRESENTED≠APPLIED≠独立核定成效 | 维持不同事实阶段/Ref，零无来源 effectiveness promotion |
| A18 | Doctor/公开报告输入 synthetic secret、prompt/tool content、local absolute path | Doctor 严格只读 allowlist 且 scrub，公开来源无泄漏、无越权读 auth stores |
| A19 | 三 Agent 的版本与 Hook 支持不一致 | 三者 source-level 契约 MUST；至少一个实测 **Claude Code CLI 优先**（若非可用或认证阻断则 ZCode CLI 作为经 source 验证的后备，Codex CLI 不因桌面 PASS 被推定支持），其余明确 NOT_RUN/真实来源；Windows Node24 |
| A20 | 仅成功 Attempt 的 cohort + 已失败/取消未观察样本 | cohort key 至少 `task_kind/risk/agent+plugin/provider capability/pricing/Host+OS/window/basis`；缺风险/失败分母时 `NOT_COMPARABLE`，不输出 Agent 排名 |
| A21 | Spool/Outbox 发生 backlog、disk-full 或 stale lock | 有界队列/错误分类、显式告警/可恢复状态，不阻塞正常 Agent 操作，不静默丢已确认事件 |
| A22 | 三条合法去重事件 2 个有 Task/Attempt refs；两 Pre 调用仅一匹配 Post | Binding `2/3 CONDITIONAL`；Tool pair `1/2 CONDITIONAL`；**不宣称总体 coverage**；重复来源不改变分母 |
| A23 | Skill 与 Doctor 对同一已知问题的诊断规则不一致 | typed Doctor catalog 是唯一 rule source；Skill 仅引用诊断 ID；source-level 一致性 oracle 不能同时两种不同 severity |
| A24 | FR07 文档称可并行、Task-native edge 实际依赖、无合法 SF | 来源完整 native readback + 规划说明只作对照；`SF_Binding=NOT_APPLICABLE`，不判断哪个拓扑更优 |
| A25 | FR07 两 Task 写同 Manifest、无 source writer/Claim，或只读 PREP 想改源码 | 输出真实写集冲突证据与 `CLAIM_NOT_ADMITTED` 的引用，**不代替 GitHub Gate**；source-only fixture |
| A26 | FR07 多 Host 钟漂移、未显式物化 Concern/Lane/Step | `UNKNOWN`/N/A，不从 Markdown/Large-Language-model 自创 machine IDs；source-only fixture |
| A27 | Reviewer/Builder ID 不同但登录相同且无独立上下文凭据 | 可记录身份不同的原始 Claim/Review 来源，不输出 `INDEPENDENT_REVIEW=PASS`；授权独立性由 ADS Reviewer/Authority |
| A28 | v4.18 candidate 规范未来 RQ/main，task-meta effective ads pin 尚未改 | 正式 Source/Gate 始终用现有有效 pin；新的规划 v4.18 方法不自动 grant publication/profile |

**测试复用**：优先已有 v0.3 source-level/T18 真实授权隔离 sink 的具体 Oracle，只对变更的发布路径补跑真实 GitHub；429/503/TLS fault 注入使用受控本地代理，不向真实 provider 制造流量。R0/R1 审核是文档回执，不能替代 Windows Node24 A11 和最小真实 CLI E2E。

## 7. v0.4 范围、平台与冻结 Release 门槛（Product Owner 决策）

**v0.4 实际平台**：**Windows + Node24** 是核心 Release 真实 Host 支持矩阵；Ubuntu/Linux 本版本 `NOT_CLAIMED`，若后来增加，必须 Amendment/真正 Ubuntu evidence，不因 Windows/fixture PASS 宣称 Linux。**Agent 范围**：ZCode、Claude Code、Codex 三插件 source-level 兼容与隐私 MUST；至少 **1 个**真实 Windows CLI Agent→Hook→Spool→Outbox 正例和 1 个独立受控故障/权限负例 MUST，首选 **Claude Code CLI**，若可用性/模型认证受限则 **ZCode headless CLI** 经现行 `--help` 和真实 Hook 证明后作为替代；Codex CLI 不支持插件时记录 `UNSUPPORTED/NOT_RUN`，不可将 Codex desktop 证据当 CLI PASS；若三种 CLI 都无法实际激活，Release Owner 必须 BLOCK/有依据 CONDITIONAL，不可凭 Hook fixture 替代。**不存在强制重新体验所有 UI**。

### MUST — RQ 前必须有真实证据或合法限定处理
- T0 私有状态/覆盖分母契约、FR01 read-only source CLI Doctor、FR02 生命周期区分、FR03 六种私有指标及 A22 正确计算、FR04 v0.4 真增量（bounded retry/UNKNOWN/permission re-check/metrics），FR05a **Windows Node24 5 组对照实测**。
- 三个插件 source-only Hook/manifest/Golden 防回归；适用的 v0.3 T18 回归（对未改逻辑不重跑昂贵真实发布）、1 个真实 CLI end-to-end + 1 个安全负例，Windows Node24 scoped 回归/独立 Review/whole-version RQ。
- **FR08 中仅生产者侧**已采纳 ADS GitHub safe Report/Golden+Tally 消费者接口文档、负面 contract fixtures **必须完成**；`REAL_TALLY_APP` 因外部 App 未交付允许 `NOT_RUN` 且不宣称全闭环。

### SHOULD — 不成为核心 Release Gate
- FR05b 真实测量推动的优化、FR06 provider/cost comparability 精化；FR07 **source-only private facts/Golden/协议说明** 可独立做，但**明确排除 v0.4 核心 Release Gate**，未实际采纳需留下 DEFER 的 Issue/原因。不得因 ADS v4.18 版本外部发布不及时而卡死 A/B/C。
- Tally 实际 C GitHub reader、feedback 往返属于 Tally #62/ADS #1210 外部 E2E，`REAL_TALLY_APP=NOT_RUN` 不代表 v0.4 失败，但不得对完整消费链签 PASS。

### DEFER
- FR07 的**公开**新增 Lane/Concern/Topology 字段必须等另一个 ADS Public Schema Amendment，**v4.18 RQ/main 不会自行解锁**；FR09 大规模 Experience/Skill/Domain Package/Agent Router/模型训练/UI，Linux 支持承诺、分布式存储、性能未证实的优化。
- **v4.18 effective pin 的正式生产采纳**单独 Product/版本 Issue（待合格 v4.18 main 后）。当前 v0.4 采集核心可以继续在已合法 adopted effective ADS 标准+权限下运行，不把 ADS v4.18 规划建议当新 Gate。

### 现有五开放 Issue 的不重复处分

| Intake Issue | v0.4 实际接入点 | Release/保留决定 |
| --- | --- | --- |
| [#7 Learning/Agent evidence](https://github.com/kaicreator-mm/task-meta/issues/7) | FR03 provenance 部分复用、FR09 扩展 | **KEEP_OPEN / DEFER 大部分**：经验判断/匹配由 Tally/下版负责 |
| [#8 Real E2E/fault/quality](https://github.com/kaicreator-mm/task-meta/issues/8) | FR01/02/03/04/05a、A08/09/11/A22 | **KEEP_OPEN**：v0.4 可关闭其中可确证生产者相关的子范围，但含外部完整应用链的尾项未达真实 E2E 前不关闭总 Issue |
| [#9 Experience usage & capture-quality](https://github.com/kaicreator-mm/task-meta/issues/9) | **FR03 Capture Quality 是 v0.4 MUST**；FR09 feedback effectiveness defer | **KEEP_OPEN**：不能把 #9 全部误标为 FR09 DEFER；可在版本完成时建立真实 scope-based evidence crosswalk |
| [#14 ADS publisher/reader integration](https://github.com/kaicreator-mm/task-meta/issues/14) | FR04 publisher + FR08 Golden / Tally reader seam | **KEEP_OPEN** 直到真实合法 Publisher+Tally GitHub-only Reader E2E |
| [#17 TraceML analytics](https://github.com/kaicreator-mm/task-meta/issues/17) | FR06 metric comparability、FR07 private observation、FR09 future insight | **KEEP_OPEN / DEFER** 公共 cohort 成果直至 ADS 兼容公有 wire 和足够现场证据 |

以上是 Intake 处理范围，不因文档交叉引用关闭旧 Issue。

## 8. ADS v4.18 Capability-first / Scaffold-aware 并行 Task 预览（未物化）

本节仅是候选 Workfront，不是合法 Source Claim、GitHub native blocked_by 或正式 Task DAG；仍需 Product Freeze→L2→源码写集检视→native Issue materialization/readback 和单 Writer/Claim。

**Scaffold 结论：** 当前 task-meta **没有已被接受的 Source Scaffold**，`SF_Binding=NOT_APPLICABLE`；若未来正式接受才按已有 SF↔DF/MI 绑定，绝不为优化并行虚构 Anchor。

| Concern/Capability | 需求 | 候选独占写集/Owner | 来源权限/环境/证据 | 真依赖/准入理由 |
| --- | --- | --- | --- | --- |
| **T0 Private Contract** | FR02/03 missing reason+epistemic, B UNKNOWN | **唯一 writer `src/model.ts`**，冻结已有共享身份/types 的增量接口；必要私有单一 contract fixture | WEB source/独立 Reviewer（如 Task 规则要求），CI source | 首批共享类型合同；A/C1 依赖其接受后才源码实现，B 可先 PREP |
| **C2 Overhead baseline** | FR05a 测量 MUST | 仅隔离测量脚本/证据路径（后续 L2 定），不写 `src/model.ts` | LOCAL Windows Node24 真实 Hook fixture，CLI source receipts | **与 T0 并行**；无虚构功能先验，最少 5 组 |
| **A Doctor + Lifecycle** | FR01/02 | 私有 `src/doctor/**`, `src/adapters/**` 的约定子树；不动共享 `src/cli.ts` 注册 | WEB/CI source+LOCAL Windows Node24 Agent CLI Hook，Reviewer 按风险 | T0 合同已接受、真实 CLI 支持能力可核 |
| **B Safe Recovery** | FR04 | `src/autoreport/**`, `src/publish/**`, `scripts/e2e-fault-injection.ts` 的**唯一 B writer**；不碰共享模型/CLI | WEB/CI source+LOCAL Windows 代理/隔离 GitHub sink，审查权限 | B 现有安全路径可先独立 PREP；`UNKNOWN` outbox 使用 T0 接口后实施 |
| **C1 Capture Quality** | FR03 | `src/aggregates/**`, `src/metrics/**` 被 C1 唯一 writer（C3 FR06 若采纳必须隔离文件或串行） | WEB/CI source+真实脱敏 fixture；LOCAL 对照由 C2 | T0 结构后真正计算，A 的来源为现有 Adapter 契约 |
| **C3 Cost comparability（SHOULD）** | FR06 | 与 C1 隔离源文件或置 C1 后，绝不双写 `src/metrics/comparison.ts` | WEB/CI Source、可选真实 Provider usage | C1 API 稳定之后可开发；不作为核心版本硬门禁 |
| **D v4.18 private DAG facts（SHOULD）** | FR07 | 独立 private fixtures/文档，不写 shared model、public ADS schema | WEB source-only，Reviewer 可选 | ADS 已冻结设计可预研；真实 runtime/公开 wire 不在当前 Gate |
| **E GitHub-only producer contract** | FR08 | 专门 producer Golden/契约文档（Tally 仅外部读），不改本地 Tally | WEB/CI source-only，真实 App E2E 外部 | 旧 ADS 有效 adopted pin，Golden 源确认；不依赖 Tally 实现 |
| **I Central Wiring** | 共用 CLI/manifest/文档和 integration tests | **唯一 writer `src/cli.ts` 命令注册、`package.json` 脚本、`AGENTS.md`/Skill 指针、跨 concern 集成测试** | WEB/CI + 独立 Reviewer，涉及 Host 的具体来源归 LOCAL | Core A/B/C1 + C2 的实际适用交付与 source contract；如果 E 改共享入口必须先协调，D/C3 若未采纳不阻塞 |
| **R Release** | version metadata/whole Version RQ | 唯一 R owner，冻结版本分支元数据、资格与 main 准入 | 主控、CI/LOCAL 真实证据、独立 Release Reviewer | I 源已集成及所有适用 MUST tests，whole exact-SHA 资格 |

**候选拓扑：** `(T0 ∥ C2)`，然后 `A ∥ B ∥ C1 ∥ D ∥ E`（A、C1 合同受 T0 限制；B 在 T0 前只读 PREP，E/D source-only 可更早）；`C3` 按是否采纳并有唯一写集；`MUST A+B+C1+C2+E → I → R`。D/C3 不纳入硬 Gate。最终真实 native edges、当前分支、Claim、审查和资源互斥以 ADS 权威重算，不用本表授予 Builder READY。

**并行/串行可复算评估：** 方案 1 `T0→A→B→C1→C2→I→R` 人为串行、写集无此必要；方案 2 如上有合法独立 workfront，中央 I 集成共享入口，优先；方案 3 在无合同/同文件 Writer 条件下全部并行违反安全，不允许。实际工期、成本、速率改善均 `NOT_MEASURED`，不得宣称数值节省；只读 PREP 可以独立先做但 **Option A** 的受 native 边阻断 Task 不能提前写源码。

**关键外部边界**：D 只消费 ADS v4.18 frozen planning norms，不抢先放新的 lane 字段到 ADS v5；E 真正 Tally reader 由 [Tally #62](https://github.com/kaicreator-mm/tally/issues/62) 和 [ADS #1210](https://github.com/kaicreator-mm/ai-development-standard/issues/1210) 负责，不为 task-meta 额外创造 private API。

## 9. Release Qualification 与证据要求

版本级至少记录 `main/branch exact SHA+Tree`、ADS effective standard & schema blob、Agent+plugin+OS+Node 的实际矩阵、数据质量来源/分母、真实发布或拒绝事件、Golden/负面测试/Host、CI/Review、P0/P1/P2 结论与全部 `NOT_RUN`/waiver。

- `PR PASS != Task Acceptance != Version Release PASS`。差异 Reviewer 与 Builder 的逻辑角色要独立；本 PRD 的 Claude 审核仅对 Product 文本而非运行时发 PASS。
- CI 若不可用，单独记录 `CI_UNAVAILABLE_WAIVER` 的版本 Owner 范围与具体缺失，不能声称 CI PASS；真实 Host/平台是否仍为必需由当版冻结 Release 规则决定。
- v0.3 已冻结 Release PIN `9731b03…` 仅作历史比较来源；v0.4 只有自身独立 Candidate 和 RQ 成立才能入 main。不得借本 PRD 改写旧 RQ。

## 10. 数据/收益验收指标（R1 不设虚构阈值）

- **采集可靠性**：按 Host/Agent/Plugin cohort 记录已证实成功 Hook 会话数、已证实事件缺失、未知结局及重复事件；出现 `denominator unknown` 的覆盖率不以数字表示。
- **恢复有效性**：已确认正常恢复、HELD、CONFLICT、UNKNOWN、不可恢复/人工处理数量、恢复延迟、远端请求数；“0 重复 POST”需通过实际原生 readback 而不是只看本地日志。
- **成本/开销**：同一合法 cohort 的捕获启停 CPU、Memory、I/O、进程耗时、数据大小与测量误差；无基线不宣称提升。
- **效率解释**：有效行动耗时、外部等待、重试/返工、真实 Tool/Model call 计数与 coverage；由独立事件支持，不推导不可观察的“思考时间”。
- **学习与价值**：新发现可复现插件问题、重复人工排查减少的证据、跨来源可比 Task 数量；没有真实前后对照不推出成本节约百分比。

L2 根据首轮实际基线与使用场景提出轻量合理预算/验收阈值，由 Product Reviewer 审核是否足够可证伪；避免未经测量就设定过度承诺的性能目标。

## 11. 产品决策与仍需监测的风险（R2 已作 Freeze 必需选择）

| ID | 本轮 Product 定案或风险 | 判断 |
| --- | --- | --- |
| Q01 | v0.4 过大 | MUST 范围 T0/A/B/C1/C2/E+I/R；D/C3 SHOULD 不为核心 RQ Gate；FR09 和新公有 Schema DEFER |
| Q02 | Doctor 交付与唯一知识源 | repo checkout `node src/cli.ts doctor`；不新 `bin`/installer；typed catalog 是唯一 rule source，Skill 引用 CLI 诊断 ID |
| Q03 | 覆盖率正确性 | FR03 六指标表的 conditional 分母明确定义，null/unknown 无假百分比，A22 精确值 Oracle |
| Q04 | Codex SessionEnd 不发 | #46 历史桌面事实不强迫 Host 发 Hook；未知 root cause；真实 CLI 路径须有不同证据 |
| Q05 | ADS v4.18 的双重身份 | v4.18 是设计规范；当前有效 pin 决定实时 Claim/JIT/public GitHub；v4.18 不新增公开 Schema，所以 FR07 private；未来正式采纳独立 concern |
| Q06 | Tally 跨系统阻断 | E producer Golden+contract 是 MUST，但真实 Tally app 单独 NOT_RUN，不阻断 core Release 但不能宣称全环 PASS |
| Q07 | OS/Agent Release 支持矩阵 | Windows Node24；三 Agent 源兼容；Claude CLI 优先至少一真 Agent E2E，失败/不可用转 ZCode headless；Ubuntu/Linux NOT_CLAIMED |
| Q08 | 可公开数据 | 只能已有 strict ADS public profile + effective source-owned grants；本版的 FR07 lane/topology 不合法公开 |
| Q09 | CLI repair | Doctor 仅只读；不自动安装/变更用户 Trust 或 Token；明确人工授权仍可使用现有 Skill |
| Q10 | Retention/性能 | 先实测 C2 采集磁盘/CPU/Spool；压缩/数据库/保留量化优化推迟，任何资源溢出不阻塞 Agent |
| Q11 | 经验效果与 Provider 阶段 | D 私有 observation + E producer facts，不从 feedback presented 推断 effectiveness，Tally 决策 |
| Q12 | 历史文档混有旧版本文字 | 只在必要文档 concern 中加 currentness 索引，不能重写旧 v0.3 RQ 或对旧 SHA 补签 PASS |

**Review 重点不再请求 L2 替 Product 决定这些发布范围。** L2 只能在本矩阵上细化模块、接口、资源、安全机制与测量预算，不得擅自把 SHOULD/DEFER 转成新 Gate。

## 12. Claude 独立 Product R2 差异审核范围

请以本次 PR #61 **最新 exact HEAD + 新 PRD Git blob** 为对象，对照两份既有独立审核 [R0 P1×6/P2×5](https://github.com/kaicreator-mm/task-meta/pull/61#issuecomment-6398129388) 与 [R1 P1×9/P2×8](https://github.com/kaicreator-mm/task-meta/pull/61#issuecomment-6398264751)。专注确认 **R0 六项 P1、v4.18 新三项 P1、八项 P2** 的真实关闭，不重读不可变旧代码当新 Host PASS：

1. 对照 T18 v0.3 既有源/回执与 FR04 **有界自动重试/UNKNOWN/outbox 权限** 新增，而非昂贵回归重复；统一私有 T0 missing reason / single source Writer。
2. Doctor 是 **repo-only `node src/cli.ts doctor`**；唯一 Catalog 不与 Skill 诊断状态重复维护；隐私 allowlist 与无全局 mutation。
3. FR03 六指标的分子/可证明分母/Provider capability/conditional-vs-absolute/正例 A22；FR05a 真实五组 Windows Node24 对照仍是 MUST。
4. v0.4 的 Windows+Node24/Agent matrix, E producer Golden MUST、D 和 Tally REAL_APP 非阻断、旧 Issue #7/#8/#9/#14/#17 的 KEEP_OPEN 有无正确拆分；A∥B∥C1 + T0 + I/R 的写集独占/合法 native Option A。
5. ADS v4.18 Product/L2 source Freeze コメント是权威；文档中 `version/v4.18@` 是当前性快照；其 v4.18 **只作规划建议**而不替换有效 Claim/JIT/ready_builder；公开 Lane/Topology 仍不存在 Schema，即使 v4.18 主线发布也须另立 ADS schema issue。
6. FR07 只能以真实 native GitHub/owner-written exact Task Pack 得到 Concern/Lane/ref，不能 parse 人类模板猜字段，不判断“无故串行”；Reviewer 不自行签独立角色 PASS。
7. 核对新增 A21–A28/Doctor privacy/T18 注入/cohort-key 样例，回报 P0/P1/P2、新问题、`PRODUCT_REVIEW=PASS|BLOCK`、`FREEZE_READY=YES|NO`，**只读写回本 PR 和 Issue #60**。任何合法 Product Freeze/L2/Task DAG/Build/Host 都是后续独立动作，不在本审核授权范围内。

**R2 候选未获独立批准：** `PRODUCT_REVIEW=NOT_RUN_AT_R2_HEAD`；`PRODUCT_OWNER_FREEZE=NO`；`L2=NOT_STARTED`；`TASK_DAG=NOT_ADMITTED`；`IMPLEMENTATION=NOT_STARTED`；`HOST_CLI=NOT_RUN`；`RQ=NOT_RUN`。



**R1 → R2 差异说明：** Claude R1 `P0=0/P1=9/P2=8/BLOCK`。R2 的修复覆盖 9 个 P1（恢复历史既证范围、统一模型、Doctor 决策、可证伪实测/coverage、实际平台/Gate/Issue、v4.18 Workfront/来源/公开 Schema）及 8 个 P2（资源耗尽、敏感只读、Codex Desktop-only、T18、cohort 规则、ADS SHA currentness、D fixture、Reviewer 不独立判定）。最终以新的 Git blob/HEAD 和独立 Reviewer 的正式差异结论为准。
