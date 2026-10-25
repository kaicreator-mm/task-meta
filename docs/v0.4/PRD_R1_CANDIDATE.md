# task-meta v0.4.0 — Reliable Collection & Execution Intelligence
## Product Requirements Document · R1 / ADS v4.18 Claude Independent Review Candidate

| 字段 | 冻结前状态 |
| --- | --- |
| Product Status | **R1_CANDIDATE / ADS_V418_TARGET / NOT_FROZEN** |
| Review | `INDEPENDENT_CLAUDE_REVIEW=NOT_RUN`；`FREEZE_READY=NO_PENDING_REVIEW` |
| Version | `v0.4.0`，不修改已接受 `v0.3.0` 发布身份 |
| Repository | `kaicreator-mm/task-meta` |
| Product Issue | [#60](https://github.com/kaicreator-mm/task-meta/issues/60) |
| Implementation authority | **NONE**；本文不是 L2/Task DAG/Task Claim/Builder 准入 |
| task-meta source basis | `main@adc0a823bc2be636292fef4dd96d24076646ee20` |
| Frozen v0.3.0 release source | `9731b03e263527e15ae24815a7e26b45e4dd809a`；8/8 Task，Windows Node24 544/544 |
| **ADS 目标规范** | **v4.18.0**；[Product #1320 Freeze](https://github.com/kaicreator-mm/ai-development-standard/issues/1320#issuecomment-6388802387) PRD blob `98772b4594caa44b2611853ae482132f7aefa36b`；[L2 #1321 Freeze](https://github.com/kaicreator-mm/ai-development-standard/issues/1321#issuecomment-6395575157) L2 blob `e3b5106c2fdaa8b2a0bbac5adb32b810fcbd51dd`；设计核查基准 `version/v4.18@6581eb218524e453d16e23bef848f233b49f91c9`，**尚未完成 RQ/main** |
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
| 规则与知识复用 | `AGENTS.md` + `.agents/skills/task-meta-agent-cli-validation/SKILL.md`；Claude discovery alias | 运行时诊断复用既有 Skill，不再增加第二套安装脚本或重复维护静态兼容表 |

**历史验证事实：** v0.3 Windows Node24 544/544、source-only Golden 和三 Agent 不同范围真实证据见 [#27](https://github.com/kaicreator-mm/task-meta/issues/27) / [#46](https://github.com/kaicreator-mm/task-meta/issues/46)。Codex 桌面 0.3.0 Stop→Outbox 曾通过，但 **五种结束路径无 SessionEnd 事件**，`SessionEnd_Correlation=NOT_QUALIFIED`；参见 [#46 真实 Host 补充](https://github.com/kaicreator-mm/task-meta/issues/46#issuecomment-6384041266)。Claude 真实 Hook 观察与模型鉴权成功是两件事；ZCode 当前并不约定 SessionEnd Hook。所有本地配置/CLI 可用性均应在实际目标 Host 再核定。

### 2.1 ADS v4.18 的目标采用与当前权限边界

**产品决定：选用最新 ADS v4.18.0 规范；R0 使用 v4.17 main 作为设计基准的做法被 R1 取代。** 设计语义的固定事实为 Product Freeze Git blob `98772b4594caa44b2611853ae482132f7aefa36b` 与 L2 Freeze blob `e3b5106c2fdaa8b2a0bbac5adb32b810fcbd51dd`。当前可读取标准分支 `version/v4.18@6581eb218524e453d16e23bef848f233b49f91c9`；截至该源核查，A/B/C 已完成、I 在独立复审、R 尚未执行。**设计与发布是不同权威：v4.18 尚未合 main、RQ 未完成，分支 SHA 不构成生产项目自动采用/发布授权。**

| 规范层 | task-meta v0.4 的处理 |
| --- | --- |
| Capability / Concern / Lane | **先按独立子需求拆 Concern**，Lane 内可有自己的 Contract/Core/Test 步骤；不能把开发步骤直接当唯一全局串行 Task DAG |
| Scaffold / Sources | **条件性**复用已接受的 SF↔DF/MI、模块 Contract、源码 Anchor/单 Writer；没有已接受 Scaffold 时 `SF_Binding=NOT_APPLICABLE`，不强行创建 |
| DAG / Builder / Claim | GitHub **native blocked_by** 仍是权威；v4.18 **Option A** 不创建 merge-only 绕过或新的 ready_builder/ready_merge。只读 PREP 不能授予源码写入；合法 Task 拆分与 native dependency mutation/readback 后独立 Claim 才能实施 |
| 角色和 handoff | 在现有 Task Pack/Execution Pack 规划 WEB/CI/LOCAL/独立 Reviewer、可用 Agent 能力、写集/共享资源及最小 Local handoff；不新建调度器、模型 Router、强制人审或每 Step Issue |
| task-meta 数据面 | 被动捕获 Native Issue/Claim/Review/Host、Lane/Step 的证据及缺失状态，不创建第二事实源、改变 Claim/Gate/Task 或以策略分析代替证据 |
| 生产采用 | 仅在 ADS v4.18 **实际 Release-qualified、有明确项目 effective adoption + schema/source-owned clearance** 后按当时精确 pin 使用新规范做合法生产交互；在此之前 v4.18 所需新字段仅用 **私有 source-pinned 实验/Golden**，现有合法 ADS v5/旧报告遵循原固定采用契约、不可添加未知公共字段 |

此处 v4.18 是**选定的目标标准**，不是“可选研究方向”；但不能提前声称其分支代码已合法发布。task-meta v0.4 的 Product Freeze、L2 Freeze、Task DAG materialization 和最终 RQ 都应重新核查实际 ADS v4.18 HEAD/Blob、版本 RQ/main 状态及合法采纳 pin。若正式规范内容变化，走明确的兼容性差异修订，不能静默改写旧报告或把新字段写进旧 ADS v5。

## 3. 主用户旅程与主体

**J1 安装/升级/诊断（项目开发者 / 本地 Agent）：** 读取已提交 Skill → 只读检测 Agent 及 Node 版本、当前插件/Hook、健康状态 → 报出已知且有证据的异常/恢复方式 → 显式确认后才允许有写副作用的安装或修复 → 发起短小真实 CLI Agent 任务 → 生成明确分层验证回执。

**J2 正常采集（Agent + 本地 Host）：** 一次被授权 Task 运行产出私有 Hook/模型/工具事件 → source/session/physical Attempt 归属 → 保持 private evidence、质量覆盖度和计费来源 → Stop/SessionEnd（若受该 Agent 支持）/settle → 有权限才进行 ADS 报告发布；否则 `HELD` 且可恢复，绝不阻断 Agent 结束。

**J3 故障恢复（项目运维）：** 停电/Host 退出/TLS 断开/429/POST ACK 丢失后再次启动 → 从 append-only Spool/Outbox/真实 GitHub 完整读回确认 → 同标识+同 digest 识别已发布；不同 digest typed `CONFLICT`；无法确认则 `UNKNOWN/HELD` 而不是盲 POST。

**J4 执行改进度量（ADS/Tally 用户）：** 对两个具有合法同风险/任务类型/环境/来源的 Task，查看来源完整度、失败/重试、有效工作与等待区间、真实 billed/provider-reported/estimated、物理 retry；不满足共同分母则 `NOT_COMPARABLE`。Tally 依据 GitHub 有界公开事实决定是否采用经验，task-meta 不给自动派发建议。

**J5 跨系统验收（Tally 产品/独立 Reviewer）：** 在专用隔离受授权 Task 上，真实生产端 GitHub 报告 → Tally 真实 GitHub-only reader → Tally 写入合法事实反馈 → task-meta 重读 GitHub 反馈；所有方向以真实实体 ID/digest/权限/版本 pin 证明，任一缺失保留 `NOT_RUN`，不得回退为 Tally 直接读取 task-meta 数据。

## 4. 功能需求（按 Lane/优先级）

### FR01 [P0, Lane A] CLI-first Doctor 与插件兼容性诊断

1. 建议的用户体验入口为 `task-meta doctor`（**产品候选命令，不是已存在 CLI**），默认 `READ_ONLY`。检测 Node 24、Windows/Ubuntu 平台、实际 Agent CLI 可达性与版本、已装插件 manifest/source、Hook 是否受支持/启用/受信任、Spool/Outbox 路径可访问性、runtime/config/ADS pin 状态和关键 `_errors.log` 错误类别；结果附来源和缺测状态。
2. 诊断层区分 `SOURCE_ONLY`、`HOOK_FIXTURE`、`REAL_AGENT_CLI`、`REAL_HOST_GITHUB`、`DESKTOP_ONLY`。没有真实进程自动触发的 Hook 不得声明“插件集成 PASS”。
3. 兼容性按 Agent/客户端版本、插件版本、Node/OS、已证实 Hook 事件及 CLI 能力记录；`--help` 无法证明的安装/升级/开启 Hook 子命令不执行。ZCode 工作区原生发现 `.agents/skills` 优先；可选用户级导入不是默认前置；Claude 项目 Skill alias、Codex 桌面 trust/CLI 分离。
4. `doctor` 不接触密码/Token/原始 prompt，不对外发送 Host 信息；不得自动修改 `~/.codex`/`~/.claude`/`~/.zcode`、trust hashes、git working tree 或全局权限。`repair` 若设计，仅在准确诊断、明确边界与用户授权后才能做可回滚的最小操作。
5. 必须清晰显示事件/功能 `SUPPORTED|UNSUPPORTED|UNKNOWN|DISABLED|NOT_RUN`；Codex `SessionEnd` 已声明但真实 Host 未发是 **missing observed event**，ZCode 没有声明 SessionEnd 是 **UNSUPPORTED_BY_PLUGIN_PROFILE**，语义不得混同。

### FR02 [P0, Lane A] 会话生命周期与 Hook/Spool 完整度

1. 通过现有 Hook、source event ID、session/turn/tool ID、Spool JCS digest 和已观察的 provider capability 构建私有生命周期状态。允许缺 SessionEnd/重复 Stop、子进程退出、挂起会话；不以静默超时推导“正常完成”或外部 verifier PASS。
2. 若存在 session/window 不匹配、Host Hook 根本未发、插件捕获崩溃，分离 `HOST_NO_EVENT|ADAPTER_FAILURE|UNBOUND_ID|UNOBSERVED|UNKNOWN`；根因仅证实后才归类，允许 `ROOT_CAUSE=UNKNOWN`。
3. 保留真实不同的 logical/physical Attempt；仅相同 source event ID + digest 可安全去重，冲突须保留。不同 Agent 会话使用同 GitHub 登录或同 SHA 不合并。
4. 诊断可以在缺 SessionEnd 下使用 Stop/settle/outbox 自身证据，但 **不制造** SessionEnd，也不因为有 HELD Outbox 就宣称已发布。

### FR03 [P0, Lane C] 可审计 Capture Quality

1. 每类观测应保留 `source_revision`、`agent/adapter_version`、`clock_basis`、`epistemic (OBSERVED|SELF_REPORTED|INFERRED|UNKNOWN)`、`capture_scope`、`missing_reason`、`coverage_denominator_source`。应尽量重用 v0.3 `src/model.ts`/Capability/MetricIdentity，不另建公共协议。
2. 至少支持以下**可重算私有**指标：source-identity binding coverage、tool hook pair/latency coverage、lifecycle coverage、token/billing basis coverage、publication reconciliation coverage、verifier/source coverage。分母只来自可证明的事件集合/Host/Provider 声明；无法获知应显示 `DENOMINATOR_UNKNOWN/NOT_COMPARABLE`，绝不可用“已观测总量”伪装总应观测量。
3. 原因分组可包括 `NOT_INSTRUMENTED|SOURCE_DROPPED|UNBOUND|CLOCK_UNTRUSTED|OUT_OF_SCOPE|UNKNOWN`（**私有候选分类**，不得直接塞进 ADS v5 public enum）。
4. 质量变化按真实同 adapter/环境/版本 cohort 比较；未知不是 0、缺失不等于零成本；每个聚合必须附来源集合/窗口/去重规则和可信统计解释。

### FR04 [P0, Lane B] 有界 Outbox/GitHub 恢复与隐私边界

1. **复用** `src/autoreport`/`src/publish` 的 CAS、Outbox、已验证读回和锁。定义重启、网络抖动、503/429/403、TLS handshake timeout、提交后 ACK 丢失、分页中断、编辑/删除评论、同键异 digest、并发重复发布的确定性恢复/拒绝状态。
2. 重试应有次数/退避/总体预算、权限复核、完整受限分页和精确 Report identity+digest reconciliation；可回收的失败先复核远端是否已生效。不可证实发布结果保持 `UNKNOWN/HELD`；禁止“404/超时立即重 POST”、无限重试或破坏性本地重置。
3. 默认普通仓库 `PUBLISH_DENIED/HELD`，除非选定精确已授权 ADS adoption/version+schema、target/Source pin、clearance 和 native GitHub write grant 均通过。候选 schema 仅在授权隔离 test sink 明确 test-only 使用；任何 `doctor`/`retry` 均不得绕过。
4. 日志和错误信息仅保存安全原因类别/时间/非敏感 IDs；Outbox/Spool/CLI 输出不得泄漏 prompt、CoT、tool args/result、模型文本、API key、私有绝对路径、Host 内部对象内容、hidden grading/验证数据。
5. 记录恢复代价（重复 GET 次数、等待、最终状态、错误类别）；真实 GitHub 429/403 负面实验采用受控代理/隔离凭据，不人为刷爆远端配额。

### FR05 [P0/P1, Lane C] Capture Overhead 与存储/并发基线

1. 真实 Node24 Host 测量 Hook 子进程启动/Wall、CPU/内存、Spool I/O、Git metadata 调用、auto-report 从 Stop 到 Outbox 时间、GitHub 请求次数、缓存/锁竞争。必须先建立 **未安装/禁用采集** 对照，再测**同 Agent 版本、同任务、同 Host** 启用采集。
2. 不预设“0 开销”、“提升 30%”或固定通过阈值。Product R1 指定先测，并由 Product/L2 Review 批准实际预算/告警阈值；若无法构造合法对照，报告 `NOT_MEASURED` 而不是声称性能改进。
3. 保持现有无需 DB 的持久化/append-only/CAS 路径；默认不引入 SQLite/Postgres/Web dashboard/常驻服务器。仅在测得的真实规模需求支持时，才评估 batch、incremental scan、WAL 或轻量索引。
4. 采集/上传失败不得阻塞 Agent 正常执行；必须为资源耗尽和无限队列提供有界行为和告警。

### FR06 [P1, Lane C] Token/工具/成本可比性与来源质量

1. 现有 `src/metrics/comparison.ts` 的度量身份与重复去重继续为权威实现；新增的是实际 provider capability/时窗/覆盖率与 **重算解释**，而非第二个 billing reducer。
2. 严格分离 `BILLED`（实际结算证据）、`PROVIDER_REPORTED`、`ESTIMATED`、`UNKNOWN`，标注定价 revision、货币、窗口、cache read/write 是独立桶还是包含于 input token、logical 调用与多次 physical retry、嵌套/重叠 span。
3. 统计至少包括失败/取消/UNKNOWN Attempt 分母；不能只选成功样本给出 Agent 成本排名。跨模型/项目/Host 仅在任务种类/风险、能力捕获和定价一致时可比较，不满足则 `NOT_COMPARABLE`。
4. 数据够用的事实输出仅通过已合法选定 ADS public schema/clearance 发布；否则内部可查，但不能在 GitHub free text 冒充结构化可计算指标。规范缺口指向 [ADS #1258](https://github.com/kaicreator-mm/ai-development-standard/issues/1258)。

### FR07 [P1, Lane D] **ADS v4.18** Capability/Lane/Scaffold/Agent 执行事实

1. 明确以 **ADS v4.18 已冻结 Product/L2** 的 Capability-first、Concern/Lane、Scaffold-aware Task DAG、Agent/Human 协作语义为设计目标；被动关联实际 GitHub Issue/PR/native blocked_by/Claim/Dispatch/Review/CI/Host 与 Task/Run/Attempt/Step。任务、Claim、JIT、Release 权限全部由 GitHub/ADS 原 owner 管理，task-meta 不作调度。
2. 候选私有索引可以保存 `capability_ref/concern_ref/lane_ref/step_ref/role/source_ref/clock_basis`；仅使用原始 Source pin、native ID、实际 Agent/Host/Reviewer 时序与允许的事实关联。计划中并行不等于真实执行并行，不得按工具名猜测 Agent 所处阶段。
3. v4.18 采用 **Option A**：native `blocked_by` / Task Pack /合法 Claim/JIT 不能被 “merge-only edge” 或只读 PREP 规划绕过；提前可合法独立实现的 Concern 要依据正式 Task Split/Add、native 依赖更新与新 Writer Claim 进入，不由 task-meta 自动授权。
4. Scaffold 只引用已有被接受的 SF↔DF/MI、唯一 Writer/Anchor。无已接受 SF 标记 `NOT_APPLICABLE`；不因为 Task DAG 规划自动生成 Scaffold，不能以不同行使相同共享文件写入权。
5. 能确证时统计 `active_union_ms`、`waiting_union_ms`、交接延迟、重试、返工与验收活动的来源及覆盖率；多个 Host 时钟不一致、并发重叠或缺失时标注 UNKNOWN；`wall-active != thinking`。基础时间语义沿用 ADS 现有 §10；[ADS #1260](https://github.com/kaicreator-mm/ai-development-standard/issues/1260) 仍为未来细化，不在本项目发明新强制 phase/OTel wire。
6. **正式公共报告需独立有效采用**：v4.18 冻结设计和当前开发分支均不能授权向现有 ADS v5 typed Report 注入额外字段；只允许在私有事实/源限定 Golden 实验阶段先行实现。生产发布前重新核验 v4.18 已有效 RQ/main/adoption、原目标 Source/Schema/clearance，禁止旧报告静默迁移。
7. 验收正负例包括 A∥B∥C→I→R 与无故全串行、共享 Manifest 写冲突、无 Scaffold 的 N/A、只读 PREP 不得 Builder 及跨 Host 时钟 UNKNOWN。真实 Task 决策/Agent 能力挑选仍属于 Tally。

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

## 6. 可证伪验收矩阵（R1 候选）

| Case | 场景 | 期望结果 / 层级 |
| --- | --- | --- |
| A01 | 已安装三种插件；Node24/Agent CLI 可用性不同；无修改权限 | Doctor 只读、分 Agent 列版本/Hook/状态和来源；不存在的命令为 UNKNOWN/UNSUPPORTED |
| A02 | 手工执行 Node Hook 夹具但 Agent 本体未启动 | 只能 `HOOK_FIXTURE_PASS`；`REAL_AGENT_CLI=NOT_RUN` |
| A03 | 实际 Codex SessionStart→Stop 且五种正常退出都没有 SessionEnd | 事件/Spool真实保留；`SessionEnd=NOT_QUALIFIED`，root cause UNKNOWN；不假造 |
| A04 | 实际 ZCode 插件并未声明 SessionEnd | `UNSUPPORTED_BY_PROFILE`，而非“ZCode 丢事件/失败” |
| A05 | Spool 中同 ID 同 digest 重复、同 ID 不同 digest、两个合法 physical retry | 同 digest 幂等、不同 digest 冲突、合法 retry 分开统计 |
| A06 | 缺工具结束事件、Provider usage 未提供、Git Head 不可信 | 各覆盖率分母/缺失原因明确；UNKNOWN 不统计为 0 或 COMPLETE |
| A07 | Hook 退出/超时/无法创建文件 | Agent 正常完成受控操作；诊断返回可定位错误而不暴露日志内容 |
| A08 | GitHub POST 已成功但 ACK 丢失、随后重复启动 | 完整受限 readback 证明同一 comment/digest，最终仅 1 份发布；无第二次无条件 POST |
| A09 | 真实/受控 429、TLS timeout、403、分页不完整 | 有界退避/权限拒绝；UNKNOWN/HELD，不假负面或无限重试 |
| A10 | 普通仓库无 ADS adopted qualified-main pin / clearance | 所有 doctor/retry/publish 均 0 未授权 POST；HELD + 原因 |
| A11 | 同一已校准 Host/Task，禁用采集 vs 启用采集 | 报真实差值与采样、版本、成本；无可信对照则 `NOT_MEASURED` |
| A12 | parent span 与 tool spans 重叠、多个 physical retry 和 cache inclusive tokens | 可重算不双计；不由 `wall-active` 推定 thinking |
| A13 | 无账单只有 provider-reported usage 和估算价 | basis 正确、不能宣称 BILLED；不同币种/窗口不能误合 |
| A14 | Task DAG 声称并行，但 GitHub 实际有 native serial dependency；Host 时钟漂移 | 并行计划与真实状态区分；无可比区间则 UNKNOWN |
| A15 | 已选定 ADS v4.18 冻结 Product/L2，但目标版本仍未 RQ/main，新 lane/scaffold 字段不能作为现有生产 ADS v5 字段 | 字段只保留私有实验，公开 v5 无新增未知 key |
| A16 | Tally C GitHub-only consumer 尚不存在 | 生产者 Golden 可 PASS；`REAL_TALLY_APP=NOT_RUN`；不阻断独立基础 Release |
| A17 | 实际 Tally 反馈仅 PRESENTED 未 APPLIED 或已 APPLIED 未独立验证 | 不自动宣称有效经验；源对象、revision、native feedback 关联准确 |
| A18 | 公开报告/诊断包含合成 secret、prompt/tool content 或私有绝对路径 | 严格拒绝/清理；允许元数据继续按授权行为运行 |
| A19 | 三 Agent 真实 CLI/Host 测试有不同版本差异 | 每个 lane 固定 Agent/Plugin/Node/OS/命令/exit code；不可用者明确 NOT_RUN 与 waiver，不伪造全平台 PASS |
| A20 | 单个 Task/项目聚合只包含成功样本 | 显示缺失失败/取消分母与不相容风险；`NOT_COMPARABLE`，不生成 Agent Leaderboard |

**测试策略：** source-only 表驱动 Golden + 最小 CLI fixture + 少量**真实** Host/Agent/隔离 GitHub E2E；失败注入优先受控本地代理，避免远程 GitHub 配额/凭据损伤。对已证明且 SHA/环境完全一致的既有证据复用，不按每小任务全量重测。任一物理测试如未实际执行，Release 账本必须保留 `NOT_RUN`。

## 7. 版本范围、优先级和 Release 门槛

### MUST（v0.4 核心价值，可独立验收）
- FR01、FR02、FR03、FR04 的可靠性闭环；FR05 **先测基线及对照**，是否实现性能优化由测量驱动。
- 保留 v0.3 三 Agent Hook/Golden/ADS v5 权限和真实 GitHub 路径，不回退历史行为。
- 最少有 **一个**实际 Agent CLI→Hook→Spool→Outbox 的真实 end-to-end 正例和一个真实/安全受控的恢复或拒绝负例；三 Agent source-level 契约均需核定；其他 Client/OS/Plugin trust 项根据声明支持范围独立实际验证或明确限定 waiver。不能用一个 Agent 替代三个都 PASS。
- 实测所有“新增受支持平台/CLI 行为”；Release OWNER 将最低能力矩阵在 L2 时冻结，不能在结束时临时改变分母。
- Windows Node24 全量/相关真实 Host Evidence、独立审查、最终 Candidate Freeze/RQ、版本分支先合后 main，实际 Tag 可选。

### SHOULD（可并行开发，有界 Release 资格）
- FR06 兼容性/质量可比性、FR07 以 **ADS v4.18 冻结 Product/L2 作为明确目标** 的 Task DAG/Lane/Scaffold 时间与交接事实，实际生产公开仍**仅允许被授权有效采纳的 ADS 语义和来源子集**；无法采用时仍交付私有 source-only fixtures 与明确阻断，不编造公开 v5。
- FR08 生产者 Golden/Consumer 合约与只读对账；Tally 已可运行时额外真实闭环，但**不强制成为 task-meta 基础 Release 硬门禁**。

### DEFER（v0.5 或独立跨项目）
- FR09 大规模经验/效果评估、AutoSaddler 类优化器、Agent 排名/模型路由、自动生成/改写 Skill/Rule/Package、Web Dashboard、分布式数据集群。
- 真实 Tally B/S/K/C 应用、ADS public schema 升级、Scaffold authoring、跨项目人/Agent 调度策略不在 task-meta Repo 中实施。

## 8. 依赖与候选并行工作流（仅 Product 规划，不是已批准 Task DAG）

`Product Review/Freeze → L2（适用 ADS+权限/命令/Host 契约）→ Native Task DAG/Task Claim → concern 实施+独立 Review → 版本级回归/Host/Golden/Qualification → main`。

**可并行 workfront 建议：**
- **A 采集/诊断**：FR01/FR02，Owner 仅修改 CLI/Hook/adapter bounded APIs；与 B/C 通过冻结的共享 source event/status 契约接口协作。
- **B 发布恢复**：FR04，以已有 `src/autoreport`/`src/publish` 为唯一写集 Owner，可独立开发；与 A 使用只读 private envelope contract。
- **C 质量/性能**：FR03/FR05/FR06，复用 `src/model.ts`、MetricIdentity、CAS，先冻结 metric provenance contract；共享文件冲突要指定单 writer，不能盲并行写 model。
- **D ADS Task DAG facts**：FR07 的 schema/来源映射/fixture 可独立并行预研；**新正式公开字段依赖 ADS 合法采纳**。
- **E Tally 外部闭环**：FR08 的 producer-side contract fixture 可独立准备，真实消费者受 Tally [#62](https://github.com/kaicreator-mm/tally/issues/62) 和 [ADS #1210](https://github.com/kaicreator-mm/ai-development-standard/issues/1210) 外部状态约束。
- **R 版本整合**：需要 A/B/C 适用必需证据；D/E 是否被纳入当前 Release Gate 应在 Product/L2 Freeze 明确，不能过后把 `NOT_RUN` 冒充完成。

依赖至少区分 **Contract/Source draft readiness**、**exclusive write set**、**validation/review eligibility**、**actual merge/release convergence**、**physical Host/credential capability**。对于未争用共享路径的任务，源准备可并行，不要人为制造 A→B→C→D 串行链；但不能绕开原生 GitHub Task/Claim/Issue Dependencies 和实际提交权限。避免“一条大任务”替代按 concern 拆分；对应 **ADS v4.18 已冻结设计目标**，真实 Task/Claim/Scaffold 准入仍由当时有效规范和 GitHub native readback 判定；正式生产 v4.18 采用需核实 Release-qualified pin。

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

## 11. 风险、取舍与开放 Product 问题

| ID | 风险/待决定事项 | R1 候选决策与 Reviewer 核查 |
| --- | --- | --- |
| Q01 | v0.4 是否过大？ | P0 FR01–04 核心闭环 + FR05 首测；FR06–08 可子任务/条件验收；FR09 延后。请审核 MUST/SHOULD 的边界 |
| Q02 | Doctor 应新增命令还是复用现有 CLI？ | 产品只定义能力 `task-meta doctor` 候选，具体 CLI/模块复用由 L2 决定；不可无端增加安装代理或守护进程 |
| Q03 | 如何避免误报覆盖率？ | 先证明观测分母和 provider capability；未知分母→UNKNOWN/NOT_COMPARABLE，禁止用推测总量 |
| Q04 | Codex SessionEnd 不发是否 P0 阻断？ | 不将不受控 Host 缺事件改成插件“成功”；应有 Stop/settle fallback 与真实诊断。若承诺某 Client 的 SessionEnd 完成语义，需要真实证明 |
| Q05 | 已选 ADS v4.18 Product/L2、但正式 RQ/main 尚未完成，如何处理？ | Product/L2 与源码 Golden 锚定最新已冻结 v4.18 Product/L2；正式生产 GitHub wire/权限仍按有效 pin。D 私有事实可独立开发，D 正式公开字段待 ADS 合法采用；v0.4 核心 A/B/C 不应因外部发布无期限阻塞 |
| Q06 | Tally 真实 E2E 能否阻断 v0.4？ | 不阻断主采集可靠性 Release；独立 issue/资格在 Tally/ADS 完成，v0.4 不能自称完整跨系统 E2E |
| Q07 | Node24 Windows/Ubuntu 支持承诺？ | 先检查现有实际用户运行平台/Build Host，再明确冻结支持矩阵；每个声称 PASS 的 lane 须有真实证据 |
| Q08 | 质量数据是否公开？ | 只能采用现有 ADS 合规 typed/public 可表达子集及 per-source clearance；剩余私有观测不流向 Tally |
| Q09 | CLI 自动 repair 权限边界？ | 默认 read-only、用户确认、无修改 trusted_hash/Token、无静默 Home/全局配置写入 |
| Q10 | 私有对象保留期限/压缩策略？ | 不在 Product R1 擅设 retention 数值；L2 先量测磁盘/隐私/恢复需求和明确删除/纠错语义 |
| Q11 | 实际反馈尚未集成如何展示演进效果？ | 只提供证据来源与 MISSING/NOT_RUN；不制造胜率或 Agent 排行，正式实验决策仍在 Tally |
| Q12 | task-meta 当前 README/历史账本部分仍使用 v0.1/早期 NOT_RUN 描述？ | 由下一文档维护 concern 规范化“历史 snapshot / 当前索引”，不修改旧 exact-SHA/不可篡改回执 |

## 12. Claude 独立 Product Review 指令（审核本文 exact SHA）

请以当前 PRD 的 **Git blob + PR exact HEAD** 为锚点，仅审核本次 Product PR 的范围，不使用对话推断已通过的 Gate：

1. **基线差异/重复 ROI**：v0.3 已有的 Hook/Autoreport/Compare/Feedback/Trajectory/Golden 是否被错误重建？FR01–FR08 是否存在重叠或过度大而无法独立拆 Task？
2. **权责/安全**：是否越过 ADS 公共 wire、Tally 决策/K、GitHub 原生事实、真实 Node24/Client 权限？是否可能新增未授权写入、Prompt/CoT/凭据泄漏？
3. **验收与数据正确性**：每项 MUST/SHOULD 是否可证伪？Hook/CLI/Desktop/Source/Host/Real GH/Tally 证据是否正确分层？统计分母、Token 缓存、成本重试、时间重叠、SessionEnd/未知是否可信？
4. **并行/依赖**：A∥B∥C 能否真正在冻结共享契约和独立写集后并行？D/E 外部依赖是否会意外无限阻塞核心 Release？是否正确落实**已冻结的 ADS v4.18 Product/L2**，并避免在未 RQ/main/adoption 时错误认定生产有效？重点复核 native blocked_by/Option A/JIT/Claim、条件 SF↔DF 和 Writer 排他
5. **Reviewer 输出**：`P0/P1/P2`（每项有准确章节、缺陷、最小修复）；`PRODUCT_REVIEW=PASS|BLOCK`、`FREEZE_READY=YES|NO`；若缺必需决策给出优先顺序，不要求 Builder 先实施。
6. **权限**：仅只读审核并将结论写回 Product PR/#60，不合并、不修改源文件、不设 Product Freeze、不生成 L2/Task DAG；如新 HEAD，需按差异重审。

**R1 最终状态（ADS v4.18 目标规范修订）：** `PRD_WRITTEN_ONLY`；`PRODUCT_REVIEW=NOT_RUN`；`PRODUCT_OWNER_FREEZE=NO`；`L2=NOT_STARTED`；`TASK_DAG=NOT_ADMITTED`；`IMPLEMENTATION=NOT_STARTED`；`HOST_CLI=NOT_RUN`；`RQ=NOT_RUN`。

**R0 → R1 差异范围：** 用户明确要求采用 ADS 最新 v4.18。R1 只调整 ADS 设计规范 pin/§2.1 权威矩阵、FR07、A15、优先级/依赖、Q05 与 Review 指令；FR01–06/FR08–09 的原先可靠性/隐私边界保持。旧 R0 PRD blob `afeebab4476b9fa4b8c1c8ec0e35b0f55234c32c` / HEAD `a672386e49ddc8656faca195c70e4477b5db5191` 已被新候选取代；Claude 必须审核本 PR 新的 exact SHA/PRD blob。
