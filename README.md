# 待办事项（todo-app）

一个单文件、零依赖的纯前端待办应用。数据全部存在浏览器 `localStorage`，无需后端。

| 项 | 值 |
|---|---|
| 线上地址 | https://yutuer.github.io/todo-app/ |
| 旧地址（兼容重定向） | https://yutuer.github.io/todo-app/todo.html |
| 仓库 | https://github.com/yutuer/todo-app |
| 本地目录 | `E:\codex_Projects\codex_list` |
| 接手基线 tag | `takeover-20261018`（对应提交 `0357a02`） |

---

## 1. 技术形态

- **单文件**：`index.html` 一个文件装下 HTML + CSS + JS，无构建、无打包、无 npm 依赖。
- **存储**：`localStorage`，键见文末第 8 节。
- **部署**：`.github/workflows/deploy.yml`，向 `main` 推送即自动发布到 GitHub Pages（`path: .` 全量上传，Actions 只 checkout 被 git 跟踪的文件，因此未跟踪的垃圾文件不会被发布）。
- **样式**：暗色主题，CSS 变量驱动，5 套强调色（violet / cyan / coral / rose / emerald），切换后记入 `localStorage`。

## 2. 功能清单

| 功能 | 状态 | 说明 |
|---|---|---|
| 新增任务 | 可用 | 支持指定日期，Enter 快捷提交 |
| 完成 / 取消完成 | 可用 | 记录 `completedAt` |
| 双击编辑文本 | 可用 | Enter 保存、Esc 取消 |
| 点击日期改期 | 可用 | 弹出原生日期选择器 |
| 按日期分组展示 | 可用 | 倒序排列 |
| 历史日期折叠 | 可用 | 折叠状态持久化 |
| 昨日未完成接续到今日 | 可用 | 橙色左边框 + "来自昨天"标记 |
| 全部 / 进行中 / 已完成筛选 | 可用 | — |
| 统计（总计 / 已完成 / 剩余） | 可用 | — |
| 主题切换 | 可用 | 5 色 |
| 清除已完成 | 可用 | — |
| **快捷语面板** | 可用 | 见第 4 节，2026-10-18 由 WorkBuddy 重做 |

## 3. 历史进度（codex 阶段）

按提交时间倒序：

| 提交 | 内容 | 结果 |
|---|---|---|
| `0357a02` | Revert "feat: add quick phrase panel" | **第 4 次回滚** |
| `1093a9d` | feat: add quick phrase panel for fast task input | 失败，被回滚 |
| `b0a018f` | feat: restore working version with calendar and tasks | 恢复可用版本 |
| `3c99ea8` | feat: add quick phrases panel with click-to-fill and CRUD | 失败 |
| `c5d50e8` | feat: add quick phrases panel and edit functionality (clean implementation) | 失败 |
| `56ae34a` | Add quick phrases panel and edit functionality | 失败 |
| `0484836` | feat: 完成时间显示 | 成功 |
| `72e196a` | feat: 历史日期可折叠 | 成功 |
| `a96376d` | feat: 点击任务日期可修改任务日期 | 成功 |
| `e74df63` | chore: 重写完整干净的版本 | 基线 |

**结论：快捷语面板在 codex 手上尝试了 4 次，4 次全部回滚，项目最终停在 `0357a02`，该功能不存在于代码中。**

### 3.1 失败根因（重要，勿重犯）

1. **外部脚本注入法不可靠**。codex 后续改用独立的 `.py` / `.js` 脚本读取 HTML，做 `content.replace(锚点, 新内容)` 再写回。**锚点只要有一处对不上，`replace` 就静默返回原串**，脚本照样打印 `Done`，文件却零改动——看起来成功了，实际什么都没发生。
   - 实证：脚本锚定 `initCalendar();`，而本文件的实际初始化函数叫 `renderCalendar();`，该锚点从未存在。
2. **脚本源文件编码错乱**。`add_quick_final.py` 里的中文「快捷语」被写成 `¿ì½ÝÓï`，即使在正确锚点插入也会产出乱码。
3. **用字符串拼 `innerHTML` + 内联 `onclick` 渲染动态内容**。配合手写转义 `escapeHtml(t.text).replace(/'/g, "\\'")`，任务文本里一出现引号、反斜杠、尖括号就容易整块渲染失败。

**规避方式：直接在 `index.html` 里就地编辑（见第 5 节锚点表），动态 DOM 一律用 `createElement` + `textContent` + `addEventListener`，不拼 `innerHTML`，不写内联 `onclick`。**

### 3.2 顺带修掉的线上故障

接手体检时发现 `https://yutuer.github.io/todo-app/` 返回 GitHub Pages 404。根因：仓库**从未存在过 `index.html`**，而 Pages 根路径只认 `index.html`；`todo.html` 本身一直是可以访问的。

已于 `ca88867` 修复：`todo.html` → `index.html`（`git mv`，保持单一真相源、不使用副本），`todo.html` 保留为轻量重定向页以兼容旧链接。

## 4. 交接记录（WorkBuddy）

| 日期 | 动作 | 提交 |
|---|---|---|
| 2026-10-18 | 打接手基线标签 `takeover-20261018`，锚定干净起点 | — |
| 2026-10-18 | 修根路径 404：`todo.html` → `index.html`，旧地址重定向 | `ca88867` |
| 2026-10-18 | 新增本 README，固化历史与流程 | `4ff03ac` |
| 2026-10-18 | 重做快捷语面板（不再用脚本注入，直接编辑三处锚点） | `13fb302` |

**回滚方式**：`git reset --hard takeover-20261018` 可回到 codex 交付的干净状态（该状态线上根路径是 404，需重新打补丁）。

### 4.1 快捷语面板实现要点

- 位置：输入卡片下方、筛选按钮上方，成为独立卡片，可折叠。
- 数据：`localStorage` 键 `quick_phrases_v1`，存字符串数组；键不存在时写入 5 条默认短语（开会 / 写报告 / 打电话 / 发邮件 / 做方案），键存在但解析失败时同样回落到默认值。
- 交互：点 chip → 填入输入框并聚焦（不直接创建任务，留给用户确认）；hover 出现「改 / 删」按钮；`+ 添加` 展开内联编辑行；Enter 保存、Esc 取消；折叠状态存 `quick_collapsed`。
- 渲染：全程 `createElement` + `textContent` + `addEventListener`，**零 `innerHTML` 拼接、零内联 onclick**。

### 4.2 验收记录（2026-10-18，Playwright 实点）

| 检查项 | 结果 |
|---|---|
| 首次打开渲染 5 条默认短语、计数 `(5)` | 通过 |
| 点 chip → 输入框被填入并聚焦 | 通过 |
| `+ 添加` → 输入 → Enter 保存 | 通过（第 6 条落库，输入框清空、编辑行收起） |
| hover chip → 点「改」→ 编辑器预填原值 | 通过（未误触发 chip 的填入行为） |
| 改后保存为原地替换 | 通过（计数仍为 6，非新增） |
| 含 `<b>`、双引号、`&` 的短语 | 通过（按纯文本渲染，`injectedBold: false`，无 HTML 注入） |
| 点「删」移除 | 通过 |
| 刷新后短语与折叠态均保持 | 通过 |
| 主流程回归（新增任务 / 统计 / 日历圆点） | 通过，未受影响 |
| 线上部署后 `https://yutuer.github.io/todo-app/` | 200，快捷语面板可用 |
| `git` 推送后旧地址 `/todo.html` | 200 并跳转至根路径 |

已知遗留（既有问题，非本次引入）：页面请求 `favicon.ico` 返回 404，控制台各页唯一一条报错，无功能影响。

## 5. 后续开发流程（SOP）

### Step 0　读档
先读本文件第 3、4 节，确认当前基线与已修问题；`git log --oneline -5` 对齐。

### Step 1　就地编辑 `index.html`

**只用编辑器直接改，不要写外部脚本做字符串替换。** 三处扩展锚点：

| 要加的东西 | 插入位置（锚点） |
|---|---|
| 样式 | 最后一个 `@media` 块之后、`</style>` 之前 |
| DOM 结构 | `<div class="filters">` 之前 |
| JS 逻辑 | `todoDate.value = selectedDate;` 之前（此处所有 `const` 与 DOM 引用均已就绪） |

注意事项：
- 新增 CSS 若要覆盖 `input[type="text"]` 一类规则，需保证选择器特异性 ≥ 原规则，或利用"后出现者胜"把新样式放在 `</style>` 前。
- 新 JS 变量命名避免与既有全局冲突（`todos`、`todoInput`、`render`、`renderCalendar`、`changeDate` 等已被占用）。

### Step 2　三条硬性校验（缺一不可）

```bash
# 1) 新标识符确实写进文件
grep -c "你的新函数名" index.html

# 2) JS 语法检查（抽出 <script> 内容后跑）
python -c "import re,io;h=io.open('index.html',encoding='utf-8').read();io.open('_c.js','w',encoding='utf-8').write(re.search(r'<script>(.*?)</script>',h,re.S).group(1))"
node --check _c.js && rm _c.js

# 3) 浏览器实点
python -m http.server 8080   # 打开 http://localhost:8080/
```
第 3 条必须覆盖：新增 → 编辑 → 删除 → **刷新后数据仍在** → 折叠状态保持 → 切换主题不串色。

### Step 3　提交
`feat: xxx` / `fix: xxx`，一次提交只做一件事，便于 `git revert` 精准回滚。**不要 `git add .`**（会带入第 7 节的垃圾文件）。

### Step 4　发布与验证
`git push origin main` → 等待 Actions 完成（约 1 分钟）→ 访问 https://yutuer.github.io/todo-app/ 确认根路径正常、功能可用。

### Step 5　出问题先回滚
`git revert <提交>` 优先于 `git reset --hard`（保留历史）。除非要彻底丢弃一批实验性提交，否则不使用 reset。

## 6. 禁止事项

1. **禁止**用外部 `.py` / `.js` 脚本对 `index.html` 做 `replace` 注入（第 3.1 节已证伪此路线）。
2. **禁止**复制出 `index.html` 的副本并行维护（`todo_backup.html`、`todo_new.html`、`todo_github.html` 就是这条路留下的残骸，三份 27~32K 的近似副本，极易改错文件）。
3. **禁止**动态 DOM 用 `innerHTML` 字符串拼接 + 内联 `onclick`。
4. **禁止** `git add .`。
5. **禁止**在未跑完 Step 2 三条校验的情况下提交。

## 7. 遗留文件（未跟踪，建议清理但尚未处理）

codex 脚本注入阶段的产物，不影响线上（Actions 不发布会话工作区里的未跟踪文件），但会干扰判断：

| 文件 | 说明 |
|---|---|
| `.py` | 改期功能的补丁脚本（文件名残缺） |
| `add_js.py` / `add_quick.js` / `add_quick_final.py` | 快捷语注入脚本，均未成功执行 |
| `gen.py` / `gen.js` | `gen.py` 内容实为 Node.js；`gen.js` 为 0 字节 |
| `write_todo.py` | 0 字节 |
| `test.txt` / `test_b64.txt` | 编码实验残留 |
| `todo_backup.html` / `todo_new.html` / `todo_github.html` | 旧版本副本 |

清理方式（确认后执行）：`mkdir -p _archive && git mv` 不适用（未跟踪），直接 `mv` 到 `_archive/` 或删除即可。

## 8. localStorage 键位

| 键 | 内容 |
|---|---|
| `todos_v3` | 任务数组，元素形如 `{id, text, completed, createdAt, completedAt, date}` |
| `todo_theme` | 主题名，如 `violet` / `cyan` / `coral` / `rose` / `emerald` |
| `todos_collapsed` | 已折叠日期键数组 |
| `quick_phrases_v1` | 快捷语字符串数组 |
| `quick_collapsed` | 快捷语面板折叠状态，`'1'` / `'0'` |

修改 `todos_v3` 的数据结构前务必做向后兼容（旧数据读入时补默认字段），否则用户已有的任务会丢。

## 9. 待办事项（TODO）

| 编号 | 事项 | 优先级 | 提出日期 | 状态 |
|---|---|---|---|---|
| TODO-1 | 快捷语面板从主栏移到**左侧日历下方**（贴着日历卡片，跟随侧栏宽度自适应） | P1 | 2026-10-18 | 待办 |
| TODO-2 | 任务输入框增加**一键清空**：有文字时在输入框最右侧显示 `×`，点击清空并保持聚焦 | P1 | 2026-10-18 | 待办 |
| TODO-3 | 补 `favicon.ico`，消除控制台唯一的 404 报错 | P3 | 2026-10-18 | 待办 |
| TODO-4 | 清理第 7 节登记的 11 个未跟踪垃圾文件 | P2 | 2026-10-18 | 待办（待授权） |

> 约定：新增待办先登记本表，再动手；完成后把「状态」改为 `已完成` 并附提交号。P1 = 影响日常使用，P2 = 影响维护，P3 = 纯体验瑕疵。

