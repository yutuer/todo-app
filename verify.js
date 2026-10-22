/* =============================================================================
 * 待办事项（todo-app）验证脚本 —— 零依赖，一条命令跑完
 *
 *   node verify.js
 *
 * 做三件事：
 *   1) **文件形态检查**：index.html 是否保持单文件结构 / 是否已拆成 app.css + app.js，
 *      构建戳锚点还在不在，CSS 与 JS 有没有被误删。
 *   2) **逻辑单元测试**：从**真实源码**里抽出函数跑断言（沿用 README §4.8 / §4.9 的方法，
 *      测的是线上真正在跑的代码，不是复刻品）。覆盖：localStorage 兼容层、标签体系、
 *      标签筛选、分组显示顺序、增删改等数据层行为。
 *   3) 任何一项失败 → 退出码 1（可直接挂 CI / pre-commit）。
 *
 * 约束：**不引入任何 npm 依赖**。DOM 相关行为靠浏览器实点验证，不在这里模拟。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const INDEX = path.join(ROOT, 'index.html');
const APP_CSS = path.join(ROOT, 'app.css');
const APP_JS = path.join(ROOT, 'app.js');

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else {
    fail++; failures.push(name);
    console.log('  [FAIL] ' + name + (detail ? '  ' + detail : ''));
  }
}
function group(title) { console.log('\n== ' + title + ' =='); }

/* ---------------------------------------------------------------- 1. 文件形态 */
group('1. 文件形态检查');

check('index.html 存在', fs.existsSync(INDEX));
if (!fs.existsSync(INDEX)) { console.error('\nindex.html 不存在，后面没法测了。'); process.exit(1); }

const indexHtml = fs.readFileSync(INDEX, 'utf8');
const splitMode = fs.existsSync(APP_JS) && fs.existsSync(APP_CSS);

if (splitMode) {
  check('已拆分：app.css 存在', fs.existsSync(APP_CSS));
  check('已拆分：app.js 存在', fs.existsSync(APP_JS));
  check('index.html 引用了 app.css', /<link[^>]+href=["'][^"']*app\.css["']/.test(indexHtml));
  check('index.html 引用了 app.js', /<script[^>]+src=["'][^"']*app\.js["']/.test(indexHtml));
  check('index.html 里没有内联 <style> 块', !/<style[\s>]/.test(indexHtml));
  check('index.html 里没有内联 <script> 块', !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(indexHtml));
  check('app.js 有实际内容', fs.statSync(APP_JS).size > 1000, fs.statSync(APP_JS).size + ' 字节');
  check('app.css 有实际内容', fs.statSync(APP_CSS).size > 1000, fs.statSync(APP_CSS).size + ' 字节');
} else {
  check('单文件形态：index.html 里有内联 <style>', /<style[\s>]/.test(indexHtml));
  check('单文件形态：index.html 里有内联 <script>', /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(indexHtml));
  check('未拆分时不应存在 app.js', !fs.existsSync(APP_JS));
  check('未拆分时不应存在 app.css', !fs.existsSync(APP_CSS));
}

// 构建戳锚点：CI 靠它注入版本号，锚点一变 CI 会直接失败
check('构建戳锚点还在（id="build-stamp">dev<）', indexHtml.includes('id="build-stamp">dev<'));
check('页面引用了内联 favicon（避免 favicon.ico 404）', indexHtml.includes('data:image/svg+xml'));

// 单文件 / 拆分两种形态下都要求：页面里有 label-card 与 todo-list 这两个关键节点
check('index.html 里有标签面板容器', indexHtml.includes('id="label-card"'));
check('index.html 里有任务列表容器', indexHtml.includes('id="todo-list"'));

/* ------------------------------------------------------------ 2. 取真实源码 */
function readAppSource() {
  if (splitMode) return fs.readFileSync(APP_JS, 'utf8');
  const m = indexHtml.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('index.html 里找不到内联 <script> 块');
  return m[1];
}

let appSource;
try {
  appSource = readAppSource();
} catch (e) {
  console.error('\n取不到应用源码：' + e.message);
  process.exit(1);
}

function extractFunc(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('未找到函数 ' + name);
  const brace = src.indexOf('{', idx);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error('函数 ' + name + ' 括号不配对');
}

function extractConst(src, name) {
  const idx = src.indexOf('const ' + name + ' =');
  if (idx < 0) throw new Error('未找到常量 ' + name);
  const eq = src.indexOf('=', idx);
  let i = eq + 1;
  while (src[i] === ' ' || src[i] === '\t') i++;
  const c0 = src[i];
  if (c0 === "'" || c0 === '"' || c0 === '`') {   // 字符串字面量
    const end = src.indexOf(c0, i + 1);
    if (end < 0) throw new Error('常量 ' + name + ' 的字符串没有闭合');
    return src.slice(idx, end + 1);
  }
  let depth = 0;                                   // 数组 / 对象字面量
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '[' || c === '(' || c === '{') depth++;
    else if (c === ']' || c === ')' || c === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(idx, i + 1);
}

const FN = ['formatDateKey', 'generateId', 'normalizeTodo', 'sameTodo', 'loadTodos', 'saveTodos',
  'isLight', 'loadLabels', 'saveLabels', 'loadLabelUI', 'saveLabelUI', 'labelDef', 'labelName',
  'labelColor', 'labelExists', 'pruneDanglingLabels', 'addLabelToTodo', 'removeLabelFromTodo',
  'requestDelete', 'cancelDelete', 'doDelete', 'setLabelColor', 'commitLabel', 'showLabelError',
  'toggleLabelFilter', 'clearLabelFilter', 'getGroupedTodos', 'sortDateKeysForDisplay',
  'toggleTodo', 'editTodo', 'deleteTodo', 'clearCompleted', 'addTodo', 'attrSel'];
const CONST = ['TODO_FIELDS', 'LABEL_KEY', 'LABEL_UI_KEY', 'LABEL_DEFAULTS', 'LABEL_PALETTE'];

const prelude = `
var STORAGE_KEY = 'todos_v3';
var COLLAPSED_KEY = 'todos_collapsed';
var todos = [];
var labels = [];
var currentFilter = 'all';
var labelFilter = null;
var labelEditingId = null;
var labelEditingColor = '#3ecf8e';
var labelEditingName = '';
var labelPendingDelete = null;
var renderCalls = 0;
var confirmCalls = [];
var confirmAnswer = true;
var R = [];
function render() { renderCalls++; }
function renderCalendar() {}   // 需要真实 DOM，沙箱里打桩
function renderLabelPanel() {}
function renderLabelPalette() {}
function syncLabelRow() {}
function closeLabelEditor() {}
var labelInput = { value: '', focus: function () {}, setSelectionRange: function () {} };
var labelEditor = { classList: { add: function () {}, remove: function () {}, toggle: function () {} } };
var labelError = { textContent: '', classList: { toggle: function () {} } };
function confirm(msg) { confirmCalls.push(msg); return confirmAnswer; }
var store = {};
var localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
function t(name, cond, detail) { R.push({ name: name, pass: !!cond, detail: detail === undefined ? '' : String(detail) }); }
function eq(name, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  t(name, a === e, '期望 ' + e + ' / 实得 ' + a);
}
function seedTodo(extra) {
  var o = { id: 'a', text: '任务A', completed: false, createdAt: 1700000000000, date: formatDateKey(new Date()) };
  if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  return o;
}
function reset() {
  Object.keys(store).forEach(function (k) { delete store[k]; });
  todos = []; labels = [];
  currentFilter = 'all'; labelFilter = null;
  labelEditingId = null; labelEditingName = ''; labelEditingColor = '#3ecf8e';
  labelPendingDelete = null;
  renderCalls = 0; confirmCalls = []; confirmAnswer = true; R.length = 0;
}
`;

let ctx;
try {
  const src = [prelude]
    .concat(CONST.map(c => extractConst(appSource, c)))
    .concat(FN.map(f => extractFunc(appSource, f)))
    .join('\n\n');
  ctx = vm.createContext({});
  vm.runInContext(src, ctx, { filename: 'todo-app-sandbox.js' });
} catch (e) {
  console.error('\n抽取真实源码失败：' + e.message);
  process.exit(1);
}

/* -------------------------------------------------------------- 3. 跑测试组 */
const suites = [
  { name: 'localStorage 兼容层：旧数据补字段，且不触发无谓回写', code: `
    reset();
    store['todos_v3'] = JSON.stringify([seedTodo()]);
    var before = store['todos_v3'];
    todos = []; loadTodos();
    eq('旧数据补出 labels 空数组', todos[0].labels, []);
    eq('旧数据不被无谓回写', store['todos_v3'], before);
  ` },
  { name: 'sameTodo：数组必须逐元素比较（用 !== 比引用会误判）', code: `
    reset();
    store['todos_v3'] = JSON.stringify([seedTodo({ labels: ['work', 'life'] })]);
    var before = store['todos_v3'];
    todos = []; loadTodos();
    eq('labels 原样保留', todos[0].labels, ['work', 'life']);
    eq('内容相同不触发回写', store['todos_v3'], before);
  ` },
  { name: '脏数据清洗', code: `
    reset();
    store['todos_v3'] = JSON.stringify([seedTodo({ labels: 'oops' })]);
    todos = []; loadTodos();
    eq('非数组脏值清洗为空数组', todos[0].labels, []);
    eq('触发回写清洗', JSON.parse(store['todos_v3'])[0].labels, []);

    store['todos_v3'] = JSON.stringify([seedTodo({ labels: ['ok', null, 123, ''] })]);
    todos = []; loadTodos();
    eq('只保留合法字符串 id', todos[0].labels, ['ok']);
  ` },
  { name: '回归：未知字段保留、不被回写抹掉', code: `
    reset();
    store['todos_v3'] = JSON.stringify([seedTodo({ starred: true, note: 'x' })]);
    todos = []; loadTodos();
    t('未知字段保留在内存', todos[0].starred === true && todos[0].note === 'x');
    eq('未知字段不被回写抹掉', JSON.parse(store['todos_v3'])[0].starred, true);
  ` },
  { name: '回归：completedAt 缺失 ≡ null 仍不触发回写', code: `
    reset();
    store['todos_v3'] = JSON.stringify([{ id: 'a', text: 'A', completed: false, createdAt: 1, date: formatDateKey(new Date()), labels: [] }]);
    var before = store['todos_v3'];
    todos = []; loadTodos();
    eq('不触发回写', store['todos_v3'], before);
  ` },
  { name: '属性选择器转义：id 里带引号 / 反斜杠也不会拼出非法选择器', code: `
    reset();
    var q = String.fromCharCode(34);
    var bs = String.fromCharCode(92);
    eq('attrSel 普通值', attrSel('data-id', 'abc'), '[data-id=' + q + 'abc' + q + ']');
    eq('attrSel 值里带引号', attrSel('data-id', 'a' + q + 'b'), '[data-id=' + q + 'a' + bs + q + 'b' + q + ']');
    eq('attrSel 值里带反斜杠', attrSel('data-id', 'a' + bs + 'b'), '[data-id=' + q + 'a' + bs + bs + 'b' + q + ']');
    eq('attrSel 属性名不参与转义', attrSel('data-label-id', 'x'), '[data-label-id=' + q + 'x' + q + ']');
  ` },
  { name: '数据层：新增任务', code: `
    reset();
    store['todos_v3'] = JSON.stringify([]);
    todos = []; loadTodos();
    addTodo('  新任务  ', formatDateKey(new Date()));
    eq('新增后 1 条', todos.length, 1);
    eq('文本去空格', todos[0].text, '新任务');
    eq('默认未完成', todos[0].completed, false);
    eq('默认无标签', todos[0].labels, []);
    t('有 id', typeof todos[0].id === 'string' && todos[0].id.length > 0);
    t('有创建时间', typeof todos[0].createdAt === 'number');
    eq('已落库', JSON.parse(store['todos_v3']).length, 1);
    eq('日期按传入值', todos[0].date, formatDateKey(new Date()));
  ` },
  { name: '数据层：完成 / 改名 / 删除 / 清除已完成', code: `
    reset();
    store['todos_v3'] = JSON.stringify([seedTodo({ id: 'a', text: '原文本' })]);
    todos = []; loadTodos();

    toggleTodo('a');
    eq('完成标记已置', todos[0].completed, true);
    t('完成时间已记录', typeof todos[0].completedAt === 'number' && todos[0].completedAt > 0);
    eq('已落库', JSON.parse(store['todos_v3'])[0].completed, true);

    toggleTodo('a');
    eq('取消完成', todos[0].completed, false);

    editTodo('a', '  新文本  ');
    eq('改名生效且去空格', todos[0].text, '新文本');
    eq('改名已落库', JSON.parse(store['todos_v3'])[0].text, '新文本');

    editTodo('a', '   ');
    eq('空文本不覆盖', todos[0].text, '新文本');

    editTodo('ghost', '不存在的');
    eq('改不存在的任务不报错', todos.length, 1);

    deleteTodo('a');
    eq('删除后剩 0 条', todos.length, 0);
    eq('删除已落库', JSON.parse(store['todos_v3']).length, 0);
  ` },
  { name: '数据层：清除已完成', code: `
    reset();
    store['todos_v3'] = JSON.stringify([
      seedTodo({ id: 'a', completed: true }),
      seedTodo({ id: 'b', completed: false })
    ]);
    todos = []; loadTodos();
    clearCompleted();
    eq('只剩未完成的', todos.length, 1);
    eq('剩下的是 b', todos[0].id, 'b');
  ` },
  { name: '标签表：加载 / 新建 / 重名 / 空名 / 改色', code: `
    reset();
    delete store['labels_v1'];
    labels = []; loadLabels();
    eq('首次使用写入 6 个内置标签', labels.length, 6);
    eq('内置标签已落库', JSON.parse(store['labels_v1']).length, 6);

    store['labels_v1'] = '[]';
    labels = []; loadLabels();
    eq('键存在但为空数组 → 保持空（不回填内置）', labels.length, 0);

    store['labels_v1'] = JSON.stringify([{ id: 'x', name: 'X', color: 'notacolor' }]);
    labels = []; loadLabels();
    eq('非法颜色回落灰', labels[0].color, '#7d879c');

    store['labels_v1'] = JSON.stringify([{ id: 'work', name: '工作', color: '#4d9dff' }]);
    labels = []; loadLabels();
    labelEditingId = null;
    labelInput.value = '测试';
    labelEditingColor = '#ff5c5c';
    commitLabel();
    eq('新建标签成功', labels.length, 2);
    eq('新标签名', labels[1].name, '测试');
    eq('新标签颜色', labels[1].color, '#ff5c5c');

    labelEditingId = null;
    labelInput.value = '工作';
    commitLabel();
    eq('重名不新增', labels.length, 2);
    t('重名有提示', String(labelError.textContent).indexOf('已存在同名标签') >= 0, labelError.textContent);

    labelEditingId = null;
    labelInput.value = '   ';
    commitLabel();
    eq('空名不新增', labels.length, 2);
    t('空名有提示', String(labelError.textContent).indexOf('不能为空') >= 0, labelError.textContent);

    labelEditingId = 'work';
    labelInput.value = '上班';
    commitLabel();
    eq('编辑模式改名', labelDef('work').name, '上班');
  ` },
  { name: '标签体系：改名跟随 / 删除级联 / 事项内删除只影响本条', code: `
    reset();
    store['labels_v1'] = JSON.stringify([
      { id: 'work', name: '工作', color: '#4d9dff' },
      { id: 'life', name: '生活', color: '#3ecf8e' }
    ]);
    store['todos_v3'] = JSON.stringify([
      seedTodo({ id: 'a', labels: ['work'] }),
      seedTodo({ id: 'b', labels: ['work', 'life'] })
    ]);
    todos = []; labels = []; loadLabels(); loadTodos();

    eq('改名前名称', labelName('work'), '工作');
    labels[0].name = '上班';
    eq('改名后按 id 现查自动跟随', labelName('work'), '上班');
    eq('事项存储仍是 id 不是名称', todos[0].labels, ['work']);

    labelEditingId = 'work';
    setLabelColor('#ff5c5c');
    eq('改色生效', labelDef('work').color, '#ff5c5c');
    eq('事项按 id 现查到新颜色', labelColor('work'), '#ff5c5c');

    removeLabelFromTodo('a', 'work');
    eq('事项A 已移除该 id', todos[0].labels, []);
    eq('事项B 不受影响', todos[1].labels, ['work', 'life']);
    eq('全局标签表不受影响', labels.length, 2);

    requestDelete('work');
    eq('点「删」只是标记待确认', JSON.parse(store['label_ui_v1']).pendingDelete, 'work');
    eq('标签表还没删', labels.length, 2);
    doDelete('work');
    eq('确认后标签表已删', labels.length, 1);
    eq('事项B 也被清掉该 id', todos[1].labels, ['life']);
    eq('待确认标记已清', JSON.parse(store['label_ui_v1']).pendingDelete, null);

    cancelDelete();
    eq('取消删除不改变任何东西', labels.length, 1);
  ` },
  { name: '标签体系：拖放添加 / 去重 / 未知 id 忽略', code: `
    reset();
    store['labels_v1'] = JSON.stringify([
      { id: 'work', name: '工作', color: '#4d9dff' },
      { id: 'life', name: '生活', color: '#3ecf8e' }
    ]);
    store['todos_v3'] = JSON.stringify([seedTodo({ id: 'a', labels: [] })]);
    todos = []; labels = []; loadLabels(); loadTodos();
    addLabelToTodo('a', 'life');
    eq('拖放后已添加 id', todos[0].labels, ['life']);
    addLabelToTodo('a', 'life');
    eq('重复添加被忽略', todos[0].labels, ['life']);
    addLabelToTodo('a', 'nope');
    eq('未知标签 id 被忽略', todos[0].labels, ['life']);
    addLabelToTodo('ghost-todo', 'life');
    eq('不存在的事项被忽略', todos.length, 1);
    eq('已落库', JSON.parse(store['todos_v3'])[0].labels, ['life']);
  ` },
  { name: '标签体系：悬空引用清理 / 亮度阈值', code: `
    reset();
    store['labels_v1'] = JSON.stringify([{ id: 'work', name: '工作', color: '#4d9dff' }]);
    store['todos_v3'] = JSON.stringify([seedTodo({ labels: ['work', 'ghost'] })]);
    todos = []; labels = []; loadLabels(); loadTodos(); pruneDanglingLabels();
    eq('事项移除悬空 id', todos[0].labels, ['work']);
    eq('已回写', JSON.parse(store['todos_v3'])[0].labels, ['work']);

    t('浅黄底改深色字', isLight('#f5c451') === true);
    t('蓝底维持白字', isLight('#4d9dff') === false);
    t('绿底维持白字', isLight('#3ecf8e') === false);
  ` },
  { name: '标签筛选：只显示带该标签的事项 / 再点取消', code: `
    reset();
    store['labels_v1'] = JSON.stringify([
      { id: 'work', name: '工作', color: '#4d9dff' },
      { id: 'life', name: '生活', color: '#3ecf8e' }
    ]);
    store['todos_v3'] = JSON.stringify([
      seedTodo({ id: 'a', text: '有工作标签', labels: ['work'] }),
      seedTodo({ id: 'b', text: '有生活标签', labels: ['life'] }),
      seedTodo({ id: 'c', text: '无标签', labels: [] })
    ]);
    todos = []; labels = []; loadLabels(); loadTodos();
    var today = formatDateKey(new Date());
    toggleLabelFilter('work');
    var g = getGroupedTodos();
    eq('只剩带工作标签的一条', g[today].length, 1);
    eq('是哪一条', g[today][0].text, '有工作标签');
    var before = JSON.stringify(todos);
    toggleLabelFilter('work');
    eq('再点一次恢复全部', getGroupedTodos()[today].length, 3);
    eq('筛选不修改底层数据', JSON.stringify(todos), before);
  ` },
  { name: '标签筛选：与状态筛选取交集 / 删标签后筛选失效', code: `
    reset();
    store['labels_v1'] = JSON.stringify([{ id: 'work', name: '工作', color: '#4d9dff' }]);
    store['todos_v3'] = JSON.stringify([
      seedTodo({ id: 'a', text: '工作未完成', completed: false, labels: ['work'] }),
      seedTodo({ id: 'b', text: '工作已完成', completed: true, labels: ['work'] }),
      seedTodo({ id: 'c', text: '别的未完成', completed: false, labels: [] })
    ]);
    todos = []; labels = []; loadLabels(); loadTodos();
    var today = formatDateKey(new Date());

    currentFilter = 'active';
    toggleLabelFilter('work');
    var g = getGroupedTodos();
    eq('进行中 + 标签 → 只剩一条', g[today].length, 1);
    eq('是哪一条', g[today][0].text, '工作未完成');

    currentFilter = 'completed';
    var g2 = getGroupedTodos();
    eq('已完成 + 标签 → 只剩已完成那条', g2[today].length, 1);
    eq('是哪一条', g2[today][0].text, '工作已完成');

    toggleLabelFilter('work');
    doDelete('work');
    eq('删掉正在筛的标签 → 筛选自动失效', labelFilter, null);
  ` },
  { name: '分组显示顺序：今天置顶 + 未来近的在前', code: `
    reset();
    var today = formatDateKey(new Date());
    eq('今天置顶（有未来日期）',
      sortDateKeysForDisplay(['2026-11-15', '2026-10-25', today, '2026-10-19'], today),
      [today, '2026-10-25', '2026-11-15', '2026-10-19']);
    eq('未来近的在前',
      sortDateKeysForDisplay(['2026-12-21', '2026-10-29', today], today),
      [today, '2026-10-29', '2026-12-21']);
    eq('无今天分组时：未来（近→远）在前，过去（近→远）在后',
      sortDateKeysForDisplay(['2026-12-21', '2026-10-29', '2026-10-19', '2026-10-15'], today),
      ['2026-10-29', '2026-12-21', '2026-10-19', '2026-10-15']);
    eq('只有今天', sortDateKeysForDisplay([today], today), [today]);
    eq('空数组', sortDateKeysForDisplay([], today), []);
    var keys = ['2026-11-15', today, '2026-10-19'];
    sortDateKeysForDisplay(keys, today);
    eq('不改动原数组', keys, ['2026-11-15', today, '2026-10-19']);
  ` },
  { name: '顺延：往期未完成并入今天分组', code: `
    reset();
    var today = formatDateKey(new Date());
    store['todos_v3'] = JSON.stringify([
      seedTodo({ id: 'a', text: '今天新建', date: today }),
      seedTodo({ id: 'b', text: '昨天遗留', date: '2026-10-21' }),
      seedTodo({ id: 'c', text: '前天遗留', date: '2026-10-19' })
    ]);
    todos = []; loadTodos();
    var g = getGroupedTodos();
    eq('三条都进今天分组', g[today].length, 3);
    eq('遗留项标为顺延', g[today].filter(function (x) { return x.isContinued; }).length, 2);
    eq('今天新建的不算顺延', g[today].filter(function (x) { return x.id === 'a'; })[0].isContinued, false);
    eq('只有今天一个分组', Object.keys(g).length, 1);
  ` }
];

group('2. 逻辑单元测试（抽真实源码跑）');
suites.forEach(s => {
  let rs = [];
  try {
    vm.runInContext(s.code, ctx, { filename: 'suite.js' });
    rs = vm.runInContext('R.slice()', ctx);
  } catch (e) {
    check(s.name, false, '抛异常：' + e.message);
    return;
  }
  rs.forEach(r => check(s.name + ' › ' + r.name, r.pass, r.detail));
});

/* ------------------------------------------------- 3. 文档对账（README 声明 vs 代码实际） */
group('3. 文档对账：README 的声明 vs 代码实际');

const README_PATH = path.join(ROOT, 'README.md');
if (!fs.existsSync(README_PATH)) {
  check('README.md 存在', false);
} else {
  const readme = fs.readFileSync(README_PATH, 'utf8');
  const cssSrc = fs.existsSync(APP_CSS) ? fs.readFileSync(APP_CSS, 'utf8') : '';
  const allSrc = indexHtml + '\n' + appSource + '\n' + cssSrc;

  // a) README §8 声明的 localStorage 键位，代码里都要真的用到
  ['todos_v3', 'todos_collapsed', 'quick_phrases_v1', 'quick_collapsed',
    'labels_v1', 'label_collapsed', 'label_ui_v1', 'todo_skin'].forEach(k => {
      check('README §8 声明的键位在代码里存在：' + k, allSrc.includes("'" + k + "'"));
  });

  // b) README 里反复提到的函数，代码里都要有
  ['normalizeTodo', 'sameTodo', 'loadTodos', 'saveTodos', 'getGroupedTodos', 'sortDateKeysForDisplay',
    'loadLabels', 'saveLabels', 'pruneDanglingLabels', 'addLabelToTodo', 'removeLabelFromTodo',
    'toggleLabelFilter', 'clearLabelFilter', 'renderLabelPanel', 'renderItemLabels',
    'renderLabelFilterChip', 'doDelete', 'requestDelete', 'cancelDelete', 'isLight',
    'escapeAttr', 'attrSel', 'bindTodoItemEvents', 'syncLabelRow'].forEach(f => {
      check('README 提到的函数在代码里存在：' + f, appSource.includes('function ' + f + '('));
  });

  // c) README §5 锚点表里的锚点必须真的在
  check('锚点：app.js 的 todoDate.value = selectedDate;', appSource.includes('todoDate.value = selectedDate;'));
  check('锚点：index.html 的 <div class="filters">', indexHtml.includes('<div class="filters">'));
  check('锚点：index.html 的 </aside>', indexHtml.includes('</aside>'));
  check('锚点：index.html 的 id="label-list"', indexHtml.includes('id="label-list"'));
  check('锚点：app.css 的皮肤块末尾（body[data-skin="ink"]）', cssSrc.includes('body[data-skin="ink"]'));

  // d) 判据表里声明的三个文件的行数 / 体积，必须与实际一致
  //    —— 改了代码没同步 md，这里就会当场报出来（README §4.9 的"文档与实现要对账"）
  const enc2 = new TextEncoder();
  const real = f => {
    const raw = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
    const lines = raw.split('\n').length - (raw.endsWith('\n') ? 1 : 0);
    const kb = Math.round(enc2.encode(raw).length / 1024 * 10) / 10;
    return { lines: lines, kb: kb };
  };
  [['index.html', 'index.html'], ['app.css', 'app.css'], ['app.js', 'app.js']].forEach(pair => {
    const file = pair[0], label = pair[1];
    const r = real(file);
    const m = new RegExp('`' + label.replace('.', '\\.') + '`\\s*\\*\\*(\\d+) 行 / ([\\d.]+)KB\\*\\*').exec(readme);
    if (!m) {
      check('README 判据表里能找到 ' + file + ' 的行数/体积声明', false, '没匹配到声明');
      return;
    }
    check('README 里 ' + file + ' 的行数与实际一致', Number(m[1]) === r.lines, '声明 ' + m[1] + ' / 实际 ' + r.lines);
    check('README 里 ' + file + ' 的体积与实际一致', Number(m[2]) === r.kb, '声明 ' + m[2] + 'KB / 实际 ' + r.kb + 'KB');
  });

  // e) README 声称"0 处内联 onclick / 0 处引号转义"，代码里也得真的是 0
  const inlineEvt = (allSrc.match(/onclick=|ondblclick=/g) || []).length;
  check('代码里确实没有内联 onclick（README 声称 0 处）', inlineEvt === 0, '实际 ' + inlineEvt + ' 处');
  const esc = (appSource.match(/\\'/g) || []).length;
  check('代码里确实没有单引号转义（README 声称 0 处）', esc === 0, '实际 ' + esc + ' 处');
}

/* ------------------------------------------------------------------ 收尾 */
console.log('\n============================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) {
  console.log('失败项：');
  failures.forEach(f => console.log('  - ' + f));
  console.log('============================================');
  process.exit(1);
}
console.log('全部通过 ✓');
console.log('============================================');
