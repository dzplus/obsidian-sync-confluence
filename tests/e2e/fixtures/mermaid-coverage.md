---
confluence_parent_url: https://cf.dawanju.net/pages/viewpage.action?pageId=223740097
---

# Mermaid 渲染 e2e 覆盖测试

> 自动生成的测试 fixture。覆盖 mermaid 全部主要图表类型 + 中文 / emoji / 边界场景。
> 跑 `tests/e2e/run.sh` 时会被复制进 vault 并触发同步。
> 不要手动编辑(脚本会重新生成)。

## 1. flowchart

```mermaid
flowchart LR
    A[开始 🚀] --> B{判断条件}
    B -->|是| C[执行处理]
    B -->|否| D[结束 🏁]
    C --> D
```

## 2. sequenceDiagram

```mermaid
sequenceDiagram
    participant 用户
    participant 网关
    participant 后端
    用户->>网关: 请求登录
    网关->>后端: 校验令牌
    后端-->>网关: 200 OK
    网关-->>用户: 登录成功 ✓
```

## 3. classDiagram

```mermaid
classDiagram
    class 用户 {
        +String 姓名
        +int 年龄
        +登录()
        +登出()
    }
    class 管理员 {
        +String 权限级别
        +管理()
    }
    用户 <|-- 管理员
```

## 4. stateDiagram-v2

```mermaid
stateDiagram-v2
    [*] --> 待办
    待办 --> 进行中: 开始
    进行中 --> 完成: 提交
    进行中 --> 待办: 暂停
    完成 --> [*]
```

## 5. erDiagram

```mermaid
erDiagram
    USER ||--o{ ORDER : 下单
    ORDER ||--|{ ITEM : 包含
    USER {
        string 姓名
        string 邮箱
    }
    ORDER {
        int 订单号
        date 创建时间
    }
```

## 6. gantt (本次回归核心 — 时间轴宽度问题)

```mermaid
gantt
    title 项目排期 v1.0
    dateFormat YYYY-MM-DD
    axisFormat %m-%d
    excludes weekends
    tickInterval 1day

    section 开发阶段
    需求评审   :p1, 2026-06-24, 2026-06-27
    技术设计   :p2, after p1, 3d
    编码实现   :p3, after p2, 5d

    section 测试阶段
    单元测试   :t1, after p3, 2d
    集成测试   :t2, after t1, 3d
    🚨 上线   :crit, t3, after t2, 1d
```

## 7. timeline

```mermaid
timeline
    title 产品路线图 2026
    Q1 : 立项 : 用户调研
    Q2 : MVP 上线 : 内测
    Q3 : 公测 : 商业化
    Q4 : 国际化 : 多语言
```

## 8. pie

```mermaid
pie title 团队组成
    "后端" : 12
    "前端" : 8
    "测试" : 5
    "PM" : 3
```

## 9. journey

```mermaid
journey
    title 用户购买旅程
    section 浏览
      首页: 5: 用户
      详情页: 4: 用户
    section 决策
      加购物车: 3: 用户
      下单: 2: 用户, 系统
    section 支付
      付款: 5: 用户, 银行
```

## 10. gitGraph

```mermaid
gitGraph
    commit id: "初始化"
    branch develop
    checkout develop
    commit id: "功能 A"
    commit id: "功能 B"
    checkout main
    merge develop tag: "v1.0"
    commit id: "热修复"
```

## 11. mindmap

```mermaid
mindmap
  root((Obsidian 插件))
    同步
      Confluence
      Notion
    编辑
      Mermaid
      LaTeX
    工作流
      Daily Notes
      模板
```

## 12. quadrantChart

```mermaid
quadrantChart
    title 任务优先级
    x-axis 不紧急 --> 紧急
    y-axis 不重要 --> 重要
    quadrant-1 立即做
    quadrant-2 计划做
    quadrant-3 委派
    quadrant-4 放弃
    任务A: [0.8, 0.9]
    任务B: [0.2, 0.7]
    任务C: [0.6, 0.3]
```

## 13. requirementDiagram

```mermaid
requirementDiagram
    requirement 登录功能 {
        id: 1
        text: 用户必须能用邮箱登录
        risk: high
        verifymethod: test
    }
    element 登录模块 {
        type: 模块
    }
    登录模块 - satisfies -> 登录功能
```

## 14. xychart-beta

```mermaid
xychart-beta
    title "月度销售"
    x-axis ["1月", "2月", "3月", "4月", "5月", "6月"]
    y-axis "销售额 (万)" 0 --> 100
    bar [30, 45, 60, 55, 80, 75]
    line [30, 45, 60, 55, 80, 75]
```

## 15. sankey-beta

```mermaid
sankey-beta

源,目标,值
访客,首页,1000
首页,详情页,400
首页,搜索,300
详情页,下单,150
搜索,详情页,200
```

## 16. C4Context

```mermaid
C4Context
    title 系统上下文图
    Person(用户, "用户")
    System(产品, "电商平台")
    System_Ext(支付, "支付系统")
    Rel(用户, 产品, "浏览/下单")
    Rel(产品, 支付, "调起支付")
```

## 17. 边界 — 同一种图复用(去重测试)

> 跟 §1 完全一样的 flowchart,验证 hash 去重逻辑。

```mermaid
flowchart LR
    A[开始 🚀] --> B{判断条件}
    B -->|是| C[执行处理]
    B -->|否| D[结束 🏁]
    C --> D
```

## 18. 边界 — 含 LaTeX-like 标签

```mermaid
flowchart TB
    A["x² + y² = r²"] --> B["α + β > γ"]
    B --> C["∀x ∈ ℝ"]
```

## 19. 故意写坏 — 验证 fallback 退回代码块

> 渲染器应该捕获异常 + 在 storage 里保留为代码块,而不是抛出导致整页同步失败。

```mermaid
this is not valid mermaid syntax
xxx --> yyy ((( broken
```

## 20. 回归测试 — issue #1 / bibendi 报告 Bug A:文件名含空格的图片附件

> Obsidian 的 "Pasted image YYYYMMDDHHMMSS.png" 文件名带空格,wikilink 形式 → 标准 markdown 链接时
> URL 没编码,markdown-it 解析失败,原文输出。**期望 Confluence 上看到 `<ac:image>` 而非原始 markdown 文本。**
>
> 引用的图片由 e2e 脚本运行时投放到 vault(`test image with spaces.png`,1×1 透明 PNG)。

![[test image with spaces.png|alt-with-space]]

## 21. 回归测试 — issue #1 / bibendi 报告 Bug B:PlantUML 附件未替换为 ac:image

> PlantUML 渲染附件已生成、上传成功,但 fence 代码块没替换为 `<ac:image>`,仍以代码块形式显示。
> Mermaid 同链路正常,所以是 plantuml 专属问题。**期望 Confluence 上看到 `<ac:image ri:filename="plantuml-*.png">`。**
>
> 需要 e2e 脚本提前把 `renderPlantUmlToPng` 开关打开。

```plantuml
@startuml
Alice -> Bob: Authentication Request
Bob --> Alice: Authentication Response

Alice -> Bob: Another authentication Request
Alice <-- Bob: Another authentication Response
@enduml
```

## 22. 回归测试 — 空格缩进 fence(list-indent)

> Bug 现象:`extractFenceBlocks` 按整行 slice 拿 content(含 4 格缩进),markdown-it 按 CommonMark
> 剥缩进 → 两侧 hash 不一致 → fence renderer 查不到 → fallback 为代码块。
> 修法:`extractFenceBlocks` 也按 fence 开头的 indent 剥每行前导空格。

- 列表项 + 4 空格缩进 plantuml fence:

    ```plantuml
    @startuml
    Indented -> Block: 测试空格缩进 fence
    @enduml
    ```

- 同一项 + 4 空格缩进 mermaid fence(对照):

    ```mermaid
    flowchart LR
        Indented[空格缩进的 mermaid] --> OK[也该正常]
    ```

## 23. Mac 场景 — tab 缩进 fence(Obsidian 默认列表缩进可能是 tab)

> 假说:我目前的 fix `' '.repeat(indent)` 只剥空格,不剥 tab → tab 缩进的 fence 仍然 hash 不一致。

-	tab 缩进 plantuml(本行 `-` 后是一个 tab):

	```plantuml
	@startuml
	Tab -> Block: tab 缩进测试
	@enduml
	```

## 24. Mac 场景 — lang 带 attribute / 元数据

> 假说:有些插件 / 编辑器允许 ``` ```plantuml id=foo``` 这种 fence info,
> `extractFenceBlocks` 的 lang regex `[\w-]*\s*$` 不允许后面有非空白 → 整行 match 失败,fence 不被收集 → hash 没了。
> 同时 fence renderer 走 `token.info.toLowerCase()` 是 `"plantuml id=foo"`,等号比较 `=== 'plantuml'` 也 false → 直接 fallback。

```plantuml id=auth-flow
@startuml
WithAttr -> Block: 带元数据
@enduml
```

## 25. Mac 场景 — blockquote 内 fence

> 假说:`extractFenceBlocks` 不识别 `>` 前缀,blockquoted fence 完全收不到。

> ```plantuml
> @startuml
> Quoted -> Block: 引用里
> @enduml
> ```

## 26. 回归测试 — CRLF 行尾(Windows vault / 外部工具生成的笔记)

> 假说:markdown-it 入口把 \r\n 归一成 \n,而 extractFenceBlocks 直接按 \n split 会把 \r 留在行尾 → 所有 CRLF fence 的 hash 与渲染侧永远不一致 → 附件上传成功但正文 fallback 成代码块。本节所有行(含 fence 体)均为字面 CRLF。

```plantuml
@startuml
Crlf -> Block: CRLF 行尾测试
@enduml
```

```mermaid
flowchart LR
    CRLF[CRLF 行尾] --> OK[应正常出图]
```
