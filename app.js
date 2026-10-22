const STORAGE_KEY = 'todos_v3';
const COLLAPSED_KEY = 'todos_collapsed';

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function getYesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDateKey(d);
}

function isPastDate(dateStr) {
  return dateStr < formatDateKey(new Date());
}

function formatDisplayDate(dateStr) {
  const date = new Date(dateStr);
  const today = formatDateKey(new Date());
  const yesterday = getYesterdayKey();
  if (dateStr === today) return '今天';
  if (dateStr === yesterday) return '昨天';
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + ['周日','周一','周二','周三','周四','周五','周六'][date.getDay()];
}

function getDateTag(dateStr) {
  const today = formatDateKey(new Date());
  const yesterday = getYesterdayKey();
  if (dateStr === today) return '<span class="tag">今天</span>';
  if (dateStr === yesterday) return '<span class="tag yesterday">昨天</span>';
  return '';
}

function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2); }

function formatTime(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function formatFullTime(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + formatTime(ts);
}

function escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }
/* 属性值专用：escapeHtml 只转义 & < >，引号要另外处理（值写进双引号属性里） */
function escapeAttr(text) { return escapeHtml(text).replace(/"/g, '&quot;'); }
/* 拼属性选择器用：引号和反斜杠必须转义，否则 id 里带引号就会拼出**非法选择器**，
   querySelector 直接抛 SyntaxError（编辑按钮 / 双击改名会整条挂掉）。
   注意不能拿 CSS.escape() 代替 —— 它转义的是「标识符」，放进引号里反而会多出反斜杠。 */
function attrSel(name, value) {
  return '[' + name + '="' + String(value).replace(/["\\]/g, '\\$&') + '"]';
}
function loadCollapsed() {
  // 存储值损坏时不能让整个脚本挂掉：解析失败一律回落到空集合
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : []);
  } catch (e) {
    return new Set();
  }
}

let todos = [];
let currentFilter = 'all';
let currentMonth = new Date();
let selectedDate = formatDateKey(new Date());
let collapsedDates = loadCollapsed();

const todoInput = document.getElementById('todo-input');
const todoDate = document.getElementById('todo-date');
const addBtn = document.getElementById('add-btn');
const todoList = document.getElementById('todo-list');
const filterBtns = document.querySelectorAll('.filter-btn');
const clearBtn = document.getElementById('clear-btn');
const clearContainer = document.getElementById('clear-container');
const totalCount = document.getElementById('total-count');
const completedCount = document.getElementById('completed-count');
const remainingCount = document.getElementById('remaining-count');
const calTitle = document.getElementById('cal-title');
const calendarGrid = document.getElementById('calendar-grid');
const prevMonthBtn = document.getElementById('prev-month');
const nextMonthBtn = document.getElementById('next-month');
const todayBtn = document.getElementById('today-btn');

// 旧数据兼容层：读入时补齐缺失字段，避免旧记录缺 date 时归组键变成 "undefined"。
// 规则：id/text/date/createdAt 缺失或类型不对时补默认值；无法修复的条目直接丢弃，
// 但保留 text 与 date 齐全的记录，确保用户已有任务不丢。
const TODO_FIELDS = ['id', 'text', 'completed', 'createdAt', 'completedAt', 'date', 'labels'];

function normalizeTodo(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const text = typeof raw.text === 'string' ? raw.text : (raw.text == null ? '' : String(raw.text));
  if (!text.trim()) return null;

  // date 必须是 YYYY-MM-DD；缺失或格式非法时回落到今天
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : formatDateKey(new Date());

  const id = (typeof raw.id === 'string' && raw.id) ? raw.id : generateId();
  const createdAt = (typeof raw.createdAt === 'number' && isFinite(raw.createdAt)) ? raw.createdAt : Date.now();
  const completed = raw.completed === true;
  // completedAt 仅在已完成时有意义；缺失则不补（render 依赖它可选）
  const completedAt = (completed && typeof raw.completedAt === 'number' && isFinite(raw.completedAt)) ? raw.completedAt : null;

  // 标签：存的是**标签 id**数组（不是名称）。
  // 旧数据没有该字段 → 补空数组；非数组 / 含非字符串 → 清洗成空数组或只留合法 id。
  // 名称与颜色在渲染时按 id 去标签表现查，所以改名/改色不必回写每条事项。
  const labels = Array.isArray(raw.labels)
    ? raw.labels.filter(v => typeof v === 'string' && v)
    : [];

  const todo = { id: id, text: text, completed: completed, createdAt: createdAt, completedAt: completedAt, date: date, labels: labels };
  // 保留未知字段（未来版本新增的、或用户自带的），回写时不能把它们抹掉
  Object.keys(raw).forEach(function (k) {
    if (TODO_FIELDS.indexOf(k) < 0) todo[k] = raw[k];
  });
  return todo;
}

// 判断一条记录是否与规范化结果等价。逐字段比较而非整串 JSON.stringify：
// 键顺序不同不算"有差异"，且 completedAt 的「缺失」与「null」视为等价
// —— addTodo 写入的记录本就没有 completedAt 键，若按键数比较会导致每次打开都回写。
// labels 是数组，必须逐元素比较：数组用 !== 比较的是引用，
// 两个内容相同的数组也会判为"有差异" → 每次打开页面都触发一次无谓回写。
function sameTodo(a, b) {
  if (!a || !b) return a === b;
  const keys = Object.keys(a).concat(Object.keys(b));
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const va = a[k], vb = b[k];
    if (k === 'completedAt' && (va === null || va === undefined) && (vb === null || vb === undefined)) continue;
    if (k === 'labels') {
      // 「键缺失」等价于「空数组」；但「非数组的脏值」与「数组」必须判为有差异，才会触发回写清洗
      const la = va === undefined ? [] : va;
      const lb = vb === undefined ? [] : vb;
      const aIsArr = Array.isArray(la), bIsArr = Array.isArray(lb);
      if (aIsArr !== bIsArr) return false;
      if (!aIsArr) { if (la !== lb) return false; continue; }
      if (la.length !== lb.length) return false;
      for (let j = 0; j < la.length; j++) if (la[j] !== lb[j]) return false;
      continue;
    }
    if (va !== vb) return false;
  }
  return true;
}

function loadTodos() {
  const s = localStorage.getItem(STORAGE_KEY);
  if (!s) { todos = []; return; }
  let parsed;
  try { parsed = JSON.parse(s); } catch (e) { todos = []; return; }
  if (!Array.isArray(parsed)) { todos = []; return; }
  const normalized = parsed.map(normalizeTodo).filter(Boolean);
  todos = normalized;
  // 仅当确实发生过修正时才回写，避免每次打开都无谓写库
  // 注意：必须先赋值再回写，否则 saveTodos() 写的是旧值
  const changed = normalized.length !== parsed.length ||
    normalized.some(function (t, i) { return !sameTodo(t, parsed[i]); });
  if (changed) saveTodos();
}

function saveTodos() { localStorage.setItem(STORAGE_KEY, JSON.stringify(todos)); }
function saveCollapsed() { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedDates])); }

function addTodo(text, date) {
  todos.unshift({ id: generateId(), text: text.trim(), completed: false, createdAt: Date.now(), date: date, labels: [] });
  saveTodos();
  renderCalendar();
  render();
}

function toggleTodo(id) {
  const t = todos.find(x => x.id === id);
  if (t) {
    t.completed = !t.completed;
    t.completedAt = t.completed ? Date.now() : null;
    saveTodos();
    renderCalendar();
    render();
  }
}

function editTodo(id, text) {
  const t = todos.find(x => x.id === id);
  if (t && text.trim()) { t.text = text.trim(); saveTodos(); render(); }
}

function changeDate(id, currentDate) {
  const input = document.createElement('input');
  input.type = 'date';
  input.value = currentDate;
  input.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1000;padding:10px;border:1px solid var(--accent);border-radius:8px;background:var(--bg-card);color:var(--text-primary);';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999;';
  overlay.onclick = () => { document.body.removeChild(overlay); document.body.removeChild(input); };
  input.onchange = () => {
    if (input.value !== currentDate) {
      const t = todos.find(x => x.id === id);
      if (t) { t.date = input.value; saveTodos(); renderCalendar(); render(); }
    }
    document.body.removeChild(overlay);
    document.body.removeChild(input);
  };
  document.body.appendChild(overlay);
  document.body.appendChild(input);
  input.showPicker ? input.showPicker() : input.focus();
}

function deleteTodo(id) {
  todos = todos.filter(x => x.id !== id);
  saveTodos();
  renderCalendar();
  render();
}

function clearCompleted() {
  todos = todos.filter(x => !x.completed);
  saveTodos();
  renderCalendar();
  render();
}

function updateStats() {
  totalCount.textContent = todos.length;
  completedCount.textContent = todos.filter(x => x.completed).length;
  remainingCount.textContent = todos.length - todos.filter(x => x.completed).length;
}

function toggleCollapse(dateKey) {
  if (collapsedDates.has(dateKey)) collapsedDates.delete(dateKey);
  else collapsedDates.add(dateKey);
  saveCollapsed();
  const section = document.querySelector('.date-section' + attrSel('data-date', dateKey));
  if (section) section.classList.toggle('collapsed', collapsedDates.has(dateKey));
}

/* ---------- 标签筛选：点标签行 = 只看带该标签的事项 ---------- */
/* 与「全部 / 进行中 / 已完成」取交集：两个条件同时满足才显示。
   再点一次同一个标签 = 取消筛选。 */
function toggleLabelFilter(id) {
  if (!labelDef(id)) return;
  labelFilter = (labelFilter === id) ? null : id;
  saveLabelUI();
  renderLabelPanel();
  render();
}

function clearLabelFilter() {
  if (!labelFilter) return;
  labelFilter = null;
  saveLabelUI();
  renderLabelPanel();
  render();
}

/* 主栏筛选条上的「标签：xxx ×」标记 */
function renderLabelFilterChip() {
  const chip = document.getElementById('label-filter-chip');
  if (!chip) return;
  chip.innerHTML = '';
  if (!labelFilter) { chip.classList.remove('show'); return; }
  if (!labelDef(labelFilter)) { labelFilter = null; chip.classList.remove('show'); return; }
  const name = document.createElement('span');
  name.textContent = '标签：' + labelName(labelFilter);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'label-filter-x';
  x.textContent = '×';
  x.title = '取消标签筛选';
  x.addEventListener('click', ev => { ev.stopPropagation(); clearLabelFilter(); });
  chip.appendChild(name);
  chip.appendChild(x);
  chip.classList.add('show');
}

function getGroupedTodos() {
  let filtered = currentFilter === 'active' ? todos.filter(x => !x.completed) :
                 currentFilter === 'completed' ? todos.filter(x => x.completed) : todos;
  // 标签筛选：只保留带该标签的事项（与状态筛选取交集）
  if (labelFilter) filtered = filtered.filter(t => t.labels && t.labels.indexOf(labelFilter) >= 0);
  const today = formatDateKey(new Date());
  const grouped = {};
  // 顺延口径：今天之前（任意日期，不只昨天）所有未完成任务，移入今天分组。
  // currentFilter === 'completed' 时不参与；'active' 下未完成项本就全部保留，无需额外顺延。
  if (currentFilter === 'completed') {
    filtered.forEach(t => { if (!grouped[t.date]) grouped[t.date] = []; grouped[t.date].push({...t, isContinued: false}); });
    return grouped;
  }
  const carried = [];
  filtered.forEach(t => {
    if (t.date < today && !t.completed) { carried.push({...t, isContinued: true, originDate: t.date}); return; }
    if (!grouped[t.date]) grouped[t.date] = [];
    grouped[t.date].push({...t, isContinued: false});
  });
  if (carried.length > 0) {
    if (!grouped[today]) grouped[today] = [];
    carried.sort((a, b) => a.date.localeCompare(b.date));
    carried.forEach(x => grouped[today].push(x));
  }
  return grouped;
}

function startEdit(id, text) {
  const item = document.querySelector('.todo-item' + attrSel('data-id', id));
  const content = item.querySelector('.todo-content');
  const textEl = content.querySelector('.todo-text');
  textEl.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = text;
  input.style.cssText = 'width:100%;padding:6px 10px;border:1px solid var(--accent);border-radius:6px;font-size:13px;font-family:inherit;background:var(--bg-primary);color:var(--text-primary);outline:none;';
  input.onblur = () => editTodo(id, input.value);
  input.onkeydown = e => { if (e.key === 'Enter') editTodo(id, input.value); if (e.key === 'Escape') render(); };
  content.insertBefore(input, textEl);
  input.focus();
  input.select();
}

function renderCalendar() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  calTitle.textContent = year + '年 ' + (month + 1) + '月';
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const today = formatDateKey(new Date());
  let html = '';
  const prevMonth = new Date(year, month, 0);
  const prevDays = prevMonth.getDate();
  for (let i = startDow - 1; i >= 0; i--) html += '<div class="cal-day other-month">' + (prevDays - i) + '</div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = formatDateKey(new Date(year, month, d));
    const classes = 'cal-day' + (dateKey === today ? ' today' : '') + (dateKey === selectedDate ? ' selected' : '') + (todos.some(t => t.date === dateKey) ? ' has-todos' : '');
    html += '<div class="' + classes + '" data-date="' + dateKey + '">' + d + '</div>';
  }
  const remaining = (startDow + daysInMonth) % 7;
  for (let d = 1; d < (remaining === 0 ? 0 : 7 - remaining); d++) html += '<div class="cal-day other-month">' + d + '</div>';
  calendarGrid.innerHTML = html;
  calendarGrid.querySelectorAll('.cal-day:not(.other-month)').forEach(el => {
    el.onclick = () => { selectedDate = el.dataset.date; todoDate.value = selectedDate; renderCalendar(); render(); };
  });
}

/* 分组的显示顺序：
     1) **今天永远置顶**
     2) 未来日期：**近的在前**（越近到期越靠上）
     3) 过去日期：近的在前
   为什么要有这套规则：原来只按日期倒序排，只要存在**未来日期**的分组
   （比如"下个月交报告"），它们就会排到今天前面 —— 今天和近期的分组反被压到最下面看不见。
   只把今天置顶还不够：未来分组内部若是"越远越靠前"，近期的任务同样会被远期的挡住。 */
function sortDateKeysForDisplay(keys, today) {
  return keys.slice().sort((a, b) => {
    if (a === today) return -1;
    if (b === today) return 1;
    const aFuture = a > today, bFuture = b > today;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;   // 未来的排在过去的之前
    if (aFuture) return a.localeCompare(b);             // 未来：近的在前
    return b.localeCompare(a);                          // 过去：近的在前
  });
}

function render() {
  const grouped = getGroupedTodos();
  const today = formatDateKey(new Date());
  const dateKeys = sortDateKeysForDisplay(Object.keys(grouped), today);

  if (dateKeys.length === 0) {
    todoList.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg><p>暂无任务</p></div>';
  } else {
    todoList.innerHTML = dateKeys.map(dateKey => {
      const dayTodos = grouped[dateKey];
      const continued = dayTodos.filter(t => t.isContinued).length;
      const tag = getDateTag(dateKey);
      const subLabel = dateKey === today && continued > 0 ? ` <span style="color:#fb923c;font-size:10px">(含往期未完成 ${continued} 项)</span>` : '';
      const isPast = isPastDate(dateKey);
      const isCollapsed = collapsedDates.has(dateKey);
      const hint = isPast && isCollapsed ? `<span class="collapsed-hint">(${dayTodos.length} 项)</span>` : '';

      const items = dayTodos.map(t => {
        const cls = 'todo-item' + (t.completed ? ' completed' : '') + (t.isContinued ? ' continued' : '');
        let timeHtml = `<div class="todo-time"><span>创建 ${formatTime(t.createdAt)}</span>`;
        if (t.completed && t.completedAt) timeHtml += `<span class="completed-time">完成 ${formatFullTime(t.completedAt)}</span>`;
        timeHtml += '</div>';
        if (t.isContinued) timeHtml = `<div class="todo-time"><span class="todo-source">来自 ${formatDisplayDate(t.originDate)}</span><span>创建 ${formatTime(t.createdAt)}</span></div>`;
        return `
          <div class="${cls}" data-id="${escapeAttr(t.id)}">
            <div class="checkbox${t.completed ? ' checked' : ''}"></div>
            <div class="todo-content">
              <div class="todo-date" data-date="${escapeAttr(t.date)}">${formatDisplayDate(t.date)}</div>
              <div class="todo-text">${escapeHtml(t.text)}</div>
              <div class="todo-labels"></div>
              ${timeHtml}
            </div>
            <div class="todo-actions">
              <button class="btn-edit" title="编辑"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="btn-delete" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
            </div>
          </div>`;
      }).join('');

      return `
        <div class="date-section${isCollapsed ? ' collapsed' : ''}" data-date="${escapeAttr(dateKey)}">
          <div class="date-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 9l-7 7-7-7"/></svg>${formatDisplayDate(dateKey)} ${tag} <span class="count">(${dayTodos.length})${subLabel}${hint}</span><span class="chevron">▼</span></div>
          <div class="todo-list">${items}</div>
        </div>`;
    }).join('');
  }
  // 事件一律用 addEventListener 绑定（不写内联 onclick），文本从 DOM 取，无需拼进 HTML 属性
  bindTodoItemEvents();
  // 标签用 DOM API 单独渲染：名称来自标签表，用 textContent 写入，不做字符串拼接
  renderItemLabels();
  renderLabelFilterChip();
  clearContainer.style.display = todos.some(t => t.completed) ? 'block' : 'none';
  updateStats();
  syncInputClear();
}

/* 绑定列表里的交互。
   原来这些是写在 HTML 里的内联 onclick（toggleCollapse / toggleTodo / changeDate /
   startEdit / deleteTodo），文字 escapeHtml 之后还得把单引号转义塞进属性里 ——
   引号一多就整块渲染失败。现在改成渲染后统一绑定：
     · 回调参数从 dataset / textContent 取，**不再需要引号转义**
     · 用户文本只经过 escapeHtml 一次，浏览器解码回来就是原文
   每次 render() 都会重建列表并重新绑定，不会重复绑定。 */
function bindTodoItemEvents() {
  todoList.querySelectorAll('.date-section').forEach(sectionEl => {
    const dateKey = sectionEl.dataset.date;
    const labelEl = sectionEl.querySelector('.date-label');
    if (labelEl) labelEl.addEventListener('click', () => toggleCollapse(dateKey));

    sectionEl.querySelectorAll('.todo-item').forEach(itemEl => {
      const id = itemEl.dataset.id;
      const textEl = itemEl.querySelector('.todo-text');
      const text = textEl ? textEl.textContent : '';

      const checkbox = itemEl.querySelector('.checkbox');
      if (checkbox) checkbox.addEventListener('click', () => toggleTodo(id));

      const dateEl = itemEl.querySelector('.todo-date');
      if (dateEl) dateEl.addEventListener('click', () => changeDate(id, dateEl.dataset.date));

      if (textEl) textEl.addEventListener('dblclick', () => startEdit(id, text));

      const editBtn = itemEl.querySelector('.btn-edit');
      if (editBtn) editBtn.addEventListener('click', () => startEdit(id, text));

      const delBtn = itemEl.querySelector('.btn-delete');
      if (delBtn) delBtn.addEventListener('click', () => deleteTodo(id));
    });
  });
}

addBtn.onclick = () => { if (todoInput.value.trim()) { addTodo(todoInput.value, todoDate.value || formatDateKey(new Date())); todoInput.value = ''; syncInputClear(); } };
todoInput.onkeydown = e => { if (e.key === 'Enter' && todoInput.value.trim()) { addTodo(todoInput.value, todoDate.value || formatDateKey(new Date())); todoInput.value = ''; syncInputClear(); } };
filterBtns.forEach(btn => { btn.onclick = () => { filterBtns.forEach(b => b.classList.remove('active')); btn.classList.add('active'); currentFilter = btn.dataset.filter; render(); }; });
clearBtn.onclick = clearCompleted;
prevMonthBtn.onclick = () => { currentMonth.setMonth(currentMonth.getMonth() - 1); renderCalendar(); };
nextMonthBtn.onclick = () => { currentMonth.setMonth(currentMonth.getMonth() + 1); renderCalendar(); };
todayBtn.onclick = () => { selectedDate = formatDateKey(new Date()); currentMonth = new Date(); todoDate.value = selectedDate; renderCalendar(); render(); };

/* ---------- 快捷语面板 ---------- */
const QUICK_KEY = 'quick_phrases_v1';
const QUICK_COLLAPSED_KEY = 'quick_collapsed';
const QUICK_DEFAULTS = ['开会', '写报告', '打电话', '发邮件', '做方案'];

let quickPhrases = [];
let quickEditingIndex = -1;
let quickCollapsed = false;

const quickCard = document.getElementById('quick-card');
const quickHead = document.getElementById('quick-head');
const quickChips = document.getElementById('quick-chips');
const quickCount = document.getElementById('quick-count');
const quickEditor = document.getElementById('quick-editor');
const quickInput = document.getElementById('quick-input');
const quickSaveBtn = document.getElementById('quick-save');
const quickCancelBtn = document.getElementById('quick-cancel');

function loadQuickPhrases() {
  const raw = localStorage.getItem(QUICK_KEY);
  if (raw === null) { quickPhrases = QUICK_DEFAULTS.slice(); return; }
  try {
    const parsed = JSON.parse(raw);
    quickPhrases = Array.isArray(parsed)
      ? parsed.filter(p => typeof p === 'string' && p.trim())
      : QUICK_DEFAULTS.slice();
  } catch (e) {
    quickPhrases = QUICK_DEFAULTS.slice();
  }
}

function saveQuickPhrases() {
  try { localStorage.setItem(QUICK_KEY, JSON.stringify(quickPhrases)); } catch (e) {}
}

// 全部用 DOM API + textContent 构建，不做字符串拼接，避免引号/HTML 转义类 bug
function renderQuickPhrases() {
  quickChips.innerHTML = '';
  quickPhrases.forEach((phrase, index) => {
    const chip = document.createElement('div');
    chip.className = 'quick-chip';
    chip.title = '点击填入输入框';

    const label = document.createElement('span');
    label.textContent = phrase;
    chip.appendChild(label);

    const actions = document.createElement('span');
    actions.className = 'quick-chip-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'quick-chip-btn edit';
    editBtn.textContent = '改';
    editBtn.title = '编辑';
    editBtn.addEventListener('click', ev => { ev.stopPropagation(); openQuickEditor(index); });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'quick-chip-btn del';
    delBtn.textContent = '删';
    delBtn.title = '删除';
    delBtn.addEventListener('click', ev => { ev.stopPropagation(); deleteQuickPhrase(index); });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    chip.appendChild(actions);
    chip.addEventListener('click', () => useQuickPhrase(index));
    quickChips.appendChild(chip);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'quick-add';
  addBtn.textContent = '+ 添加';
  addBtn.addEventListener('click', () => openQuickEditor(-1));
  quickChips.appendChild(addBtn);

  quickCount.textContent = quickPhrases.length ? '(' + quickPhrases.length + ')' : '';
}

function useQuickPhrase(index) {
  const phrase = quickPhrases[index];
  if (typeof phrase !== 'string') return;
  todoInput.value = phrase;
  todoInput.focus();
  syncInputClear();
  const len = phrase.length;
  try { todoInput.setSelectionRange(len, len); } catch (e) {}
}

function openQuickEditor(index) {
  quickEditingIndex = typeof index === 'number' ? index : -1;
  quickInput.value = quickEditingIndex >= 0 ? (quickPhrases[quickEditingIndex] || '') : '';
  quickEditor.classList.add('show');
  quickInput.focus();
  try { quickInput.setSelectionRange(quickInput.value.length, quickInput.value.length); } catch (e) {}
}

function closeQuickEditor() {
  quickEditingIndex = -1;
  quickInput.value = '';
  quickEditor.classList.remove('show');
}

function commitQuickPhrase() {
  const text = quickInput.value.trim();
  if (!text) { quickInput.focus(); return; }
  if (quickEditingIndex >= 0 && quickEditingIndex < quickPhrases.length) {
    quickPhrases[quickEditingIndex] = text;
  } else {
    quickPhrases.push(text);
  }
  saveQuickPhrases();
  closeQuickEditor();
  renderQuickPhrases();
}

function deleteQuickPhrase(index) {
  if (index < 0 || index >= quickPhrases.length) return;
  quickPhrases.splice(index, 1);
  saveQuickPhrases();
  if (quickEditingIndex === index) closeQuickEditor();
  else if (quickEditingIndex > index) quickEditingIndex -= 1;
  renderQuickPhrases();
}

function toggleQuickPanel() {
  quickCollapsed = !quickCollapsed;
  quickCard.classList.toggle('collapsed', quickCollapsed);
  try { localStorage.setItem(QUICK_COLLAPSED_KEY, quickCollapsed ? '1' : '0'); } catch (e) {}
}

quickHead.addEventListener('click', toggleQuickPanel);
quickSaveBtn.addEventListener('click', commitQuickPhrase);
quickCancelBtn.addEventListener('click', closeQuickEditor);
quickInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); commitQuickPhrase(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeQuickEditor(); }
});

loadQuickPhrases();
quickCollapsed = localStorage.getItem(QUICK_COLLAPSED_KEY) === '1';
quickCard.classList.toggle('collapsed', quickCollapsed);
renderQuickPhrases();

/* ---------- 任务输入框：一键清空 ---------- */
const inputClearBtn = document.getElementById('input-clear');

function syncInputClear() {
  inputClearBtn.classList.toggle('show', todoInput.value.length > 0);
}

inputClearBtn.addEventListener('click', () => {
  todoInput.value = '';
  syncInputClear();
  todoInput.focus();
});
todoInput.addEventListener('input', syncInputClear);
todoInput.addEventListener('compositionend', syncInputClear);
syncInputClear();

/* ---------- 风格皮肤：切换器常驻，默认紫，选择持久化 ---------- */
(function () {
  const SKIN_KEY = 'todo_skin';
  const SKINS = ['violet', 'cartoon', 'cyber', 'robot', 'anime', 'ink'];
  const bar = document.querySelector('.skin-bar');
  if (!bar) return;
  const btns = Array.prototype.slice.call(bar.querySelectorAll('.skin-btn'));

  function normalize(name) {
    if (name === 'lab') return 'violet';
    return SKINS.indexOf(name) >= 0 ? name : 'violet';
  }

  // 唯一的状态出口：改 body 属性 + 同步按钮高亮。定时切换时直接调用它即可。
  function apply(name) {
    const skin = normalize(name);
    if (skin === 'violet') document.body.removeAttribute('data-skin');
    else document.body.setAttribute('data-skin', skin);
    btns.forEach(b => b.classList.toggle('active', b.dataset.skin === skin));
    return skin;
  }

  function remember(skin) {
    try { localStorage.setItem(SKIN_KEY, skin); } catch (e) {}
  }

  let initial = 'violet';
  try {
    const param = new URLSearchParams(location.search).get('skin');
    const stored = localStorage.getItem(SKIN_KEY);
    initial = normalize(param || stored || 'violet');
  } catch (e) {}

  apply(initial);

  bar.addEventListener('click', e => {
    const b = e.target.closest('.skin-btn');
    if (!b) return;
    remember(apply(b.dataset.skin));
  });
})();

/* ---------- 标签系统 ----------
   全局标签表（labels_v1）：[{id, name, color}]，**独立于 todos_v3 存储**。
   待办事项只存标签 id 数组（todo.labels），渲染时按 id 现查名称与颜色：
     · 改全局标签名/颜色 → 只改标签表一处，事项里的 chip 自动跟着变
     · 删全局标签 → 从所有事项里清掉这个 id
     · 事项里 chip 右侧的 × 只移除**本事项**的这一个引用，不动全局标签表
   （数据模型照抄 Aurora Board 的标签体系，见 trello看板/index.html） */
const LABEL_KEY = 'labels_v1';
const LABEL_COLLAPSED_KEY = 'label_collapsed';
const LABEL_UI_KEY = 'label_ui_v1';
const LABEL_PALETTE = [
  '#ff5c5c','#ff8a3d','#ffb020','#f5c451','#3ecf8e','#2fd6c4','#4d9dff','#a77bff',
  '#ff6fae','#ec4899','#8b5cf6','#6366f1','#0ea5e9','#14b8a6','#22c55e','#eab308',
  '#64748b','#7d879c','#e11d48','#0891b2'
];
/* 首次使用时的内置标签，都可以在面板里改名 / 改色 / 删除 */
const LABEL_DEFAULTS = [
  { id: 'important', name: '重要', color: '#ff5c5c' },
  { id: 'urgent',    name: '紧急', color: '#ff8a3d' },
  { id: 'work',      name: '工作', color: '#4d9dff' },
  { id: 'life',      name: '生活', color: '#3ecf8e' },
  { id: 'study',     name: '学习', color: '#a77bff' },
  { id: 'misc',      name: '其他', color: '#7d879c' }
];

let labels = [];
let labelEditingId = null;          // null = 新增；字符串 = 正在编辑的标签 id
let labelEditingColor = LABEL_PALETTE[4];
let labelEditingName = '';          // 打开编辑器时的原名（点「取消」时回滚用）
let labelPendingDelete = null;      // 已点「删」、等待二次确认的标签 id
let labelFilter = null;             // 当前标签筛选（标签 id），null = 不筛
let labelCollapsed = false;

const labelCard = document.getElementById('label-card');
const labelHead = document.getElementById('label-head');
const labelList = document.getElementById('label-list');
const labelCount = document.getElementById('label-count');
const labelEditor = document.getElementById('label-editor');
const labelInput = document.getElementById('label-input');
const labelPalette = document.getElementById('label-palette');
const labelError = document.getElementById('label-error');
const labelSaveBtn = document.getElementById('label-save');
const labelCancelBtn = document.getElementById('label-cancel');

function loadLabels() {
  try {
    const raw = localStorage.getItem(LABEL_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      // 键存在且是数组就用它——哪怕是空数组：用户可能把标签删光了，不该又冒出内置的
      if (Array.isArray(parsed)) {
        labels = parsed.filter(x => x && x.id).map(x => ({
          id: String(x.id),
          name: String(x.name == null ? x.id : x.name),
          color: /^#[0-9a-fA-F]{6}$/.test(x.color) ? x.color : '#7d879c'
        }));
        return;
      }
    }
  } catch (e) {}
  labels = LABEL_DEFAULTS.map(x => ({ id: x.id, name: x.name, color: x.color }));
  saveLabels();
}

function saveLabels() {
  try { localStorage.setItem(LABEL_KEY, JSON.stringify(labels)); } catch (e) {}
}

/* 面板的临时状态（正在编辑哪个标签、待确认删除哪个标签）也落库：
   刷新页面后编辑框与确认条还在，不会让用户"填了一半就没了"。 */
function loadLabelUI() {
  try {
    const raw = localStorage.getItem(LABEL_UI_KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      labelEditingId = typeof d.editingId === 'string' ? d.editingId : null;
      labelEditingColor = /^#[0-9a-fA-F]{6}$/.test(d.editingColor) ? d.editingColor : LABEL_PALETTE[4];
      labelEditingName = typeof d.editingName === 'string' ? d.editingName : '';
      labelPendingDelete = typeof d.pendingDelete === 'string' ? d.pendingDelete : null;
      labelFilter = typeof d.filter === 'string' ? d.filter : null;
      // 标签可能已被删（换了浏览器 / 清了标签表），筛选自动失效
      if (labelFilter && !labels.some(l => l.id === labelFilter)) labelFilter = null;
    }
  } catch (e) {}
}

function saveLabelUI() {
  try {
    localStorage.setItem(LABEL_UI_KEY, JSON.stringify({
      editingId: labelEditingId,
      editingColor: labelEditingColor,
      editingName: labelEditingName,
      pendingDelete: labelPendingDelete,
      filter: labelFilter
    }));
  } catch (e) {}
}

function labelDef(id) { return labels.find(l => l.id === id) || null; }
function labelName(id) { const d = labelDef(id); return d ? d.name : id; }
function labelColor(id, fb) { const d = labelDef(id); return d ? d.color : (fb || '#7d879c'); }
function labelExists(id) { return !!labelDef(id); }

/* 亮度判断：只有确实很浅的底色才改用深色字（阈值取 185，
   正好覆盖内置的黄色 #f5c451，其余内置色维持白字） */
function isLight(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 185;
}

/* 清掉指向已删除标签的悬空引用（标签被删后事项不应再挂着无效 id） */
function pruneDanglingLabels() {
  let changed = false;
  todos.forEach(t => {
    if (t.labels && t.labels.length) {
      const keep = t.labels.filter(id => labelExists(id));
      if (keep.length !== t.labels.length) { t.labels = keep; changed = true; }
    }
  });
  if (changed) saveTodos();
}

/* ---------- 标签管理面板 ---------- */
function renderLabelPanel() {
  labelList.innerHTML = '';
  labels.forEach(l => {
    const row = document.createElement('div');
    row.className = 'label-row' + (labelFilter === l.id ? ' filtering' : '');
    row.draggable = true;
    row.dataset.labelId = l.id;
    row.title = '点一下只看该标签的事项；按住可拖到任务上';

    const dot = document.createElement('span');
    dot.className = 'label-dot';
    dot.style.background = l.color;

    const name = document.createElement('span');
    name.className = 'label-name';
    name.textContent = l.name;

    // 该标签下有多少个事项（顺带告诉用户哪些标签值得筛）
    const used = todos.filter(t => (t.labels || []).indexOf(l.id) >= 0).length;
    const count = document.createElement('span');
    count.className = 'label-row-count' + (used ? '' : ' zero');
    count.textContent = '(' + used + ')';

    const actions = document.createElement('span');
    actions.className = 'label-row-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'label-row-btn edit';
    editBtn.textContent = '改';
    editBtn.title = '改名 / 改色';
    editBtn.addEventListener('click', ev => { ev.stopPropagation(); openLabelEditor(l.id); });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'label-row-btn del';
    delBtn.textContent = '删';
    delBtn.title = '删除标签（会从所有任务上移除）';
    delBtn.addEventListener('click', ev => { ev.stopPropagation(); requestDelete(l.id); });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(count);
    row.appendChild(actions);

    // 点标签行 = 切换筛选。按下与抬起位置差得多说明是在拖动，不能当成点击。
    let downX = 0, downY = 0;
    row.addEventListener('mousedown', e => { downX = e.clientX; downY = e.clientY; });
    row.addEventListener('click', e => {
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
      toggleLabelFilter(l.id);
    });

    row.addEventListener('dragstart', onLabelDragStart);
    row.addEventListener('dragend', onLabelDragEnd);
    labelList.appendChild(row);

    // 已点「删」但还没确认：在这行下面展开一条二次确认条
    if (labelPendingDelete === l.id) {
      const used = todos.filter(t => (t.labels || []).indexOf(l.id) >= 0).length;
      const strip = document.createElement('div');
      strip.className = 'label-confirm';
      const txt = document.createElement('span');
      txt.className = 'label-confirm-text';
      txt.textContent = '确定删除「' + l.name + '」？' +
        (used ? ('该标签正被 ' + used + ' 个任务使用，删除后这些任务会移除该标签。')
              : '该标签暂未被任何任务使用。');
      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'label-confirm-ok';
      okBtn.textContent = '删除';
      okBtn.addEventListener('click', ev => { ev.stopPropagation(); doDelete(l.id); });
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'label-confirm-cancel';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', ev => { ev.stopPropagation(); cancelDelete(); });
      strip.appendChild(txt);
      strip.appendChild(okBtn);
      strip.appendChild(cancelBtn);
      labelList.appendChild(strip);
    }
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'label-add';
  addBtn.textContent = '+ 添加标签';
  addBtn.addEventListener('click', () => openLabelEditor(null));
  labelList.appendChild(addBtn);

  labelCount.textContent = labels.length ? '(' + labels.length + ')' : '';
}

function renderLabelPalette() {
  labelPalette.innerHTML = '';
  LABEL_PALETTE.forEach(c => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'label-sw' + (String(labelEditingColor).toLowerCase() === c.toLowerCase() ? ' on' : '');
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => { setLabelColor(c); });
    labelPalette.appendChild(sw);
  });
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'label-custom';
  custom.value = labelEditingColor;
  custom.title = '自定义颜色';
  custom.addEventListener('input', () => { setLabelColor(custom.value); });
  labelPalette.appendChild(custom);
}

function showLabelError(msg) {
  labelError.textContent = msg;
  labelError.classList.toggle('show', !!msg);
}

/* 刷新后把上次没关掉的编辑框 / 确认条恢复出来（状态存在 label_ui_v1 里） */
function restoreLabelEditor() {
  if (labelEditingId && !labelDef(labelEditingId)) { labelEditingId = null; labelEditingName = ''; }
  if (labelPendingDelete && !labelDef(labelPendingDelete)) labelPendingDelete = null;
  if (labelEditingId) {
    const d = labelDef(labelEditingId);
    labelInput.value = d.name;
    labelEditingColor = d.color;
    renderLabelPalette();
    labelEditor.classList.add('show');
  }
}

/* 实时改名/改色后，就地更新面板那一行的文字与色块。
   注意不能调 renderLabelPanel()——那会把编辑器整个重建掉，正在输入的焦点就没了。 */
function syncLabelRow(id) {
  const row = labelList.querySelector('.label-row' + attrSel('data-label-id', id));
  if (!row) return;
  const d = labelDef(id);
  if (!d) return;
  const nm = row.querySelector('.label-name');
  if (nm) nm.textContent = d.name;
  const dot = row.querySelector('.label-dot');
  if (dot) dot.style.background = d.color;
}

function openLabelEditor(id) {
  labelEditingId = (typeof id === 'string') ? id : null;
  const d = labelEditingId ? labelDef(labelEditingId) : null;
  labelEditingName = d ? d.name : '';          // 记下原名，点「取消」时回滚
  labelInput.value = labelEditingName;
  labelEditingColor = d ? d.color : LABEL_PALETTE[4];
  showLabelError('');
  renderLabelPalette();
  labelEditor.classList.add('show');
  saveLabelUI();
  labelInput.focus();
  try { labelInput.setSelectionRange(labelInput.value.length, labelInput.value.length); } catch (e) {}
}

function closeLabelEditor(revert) {
  if (revert && labelEditingId) {
    // 取消：把名称与颜色回滚到打开编辑器时的样子
    const d = labelDef(labelEditingId);
    if (d) { d.name = labelEditingName; d.color = labelEditingColor; saveLabels(); }
  }
  labelEditingId = null;
  labelInput.value = '';
  labelEditor.classList.remove('show');
  showLabelError('');
  saveLabelUI();
  renderLabelPanel();
  render();
}

function commitLabel() {
  const name = labelInput.value.trim();
  if (!name) { showLabelError('标签名不能为空'); labelInput.focus(); return; }
  if (labelEditingId) {
    const d = labelDef(labelEditingId);
    if (!d) { closeLabelEditor(false); return; }
    if (labels.some(l => l.id !== labelEditingId && l.name === name)) {
      showLabelError('已存在同名标签「' + name + '」');
      return;
    }
    d.name = name;
    d.color = labelEditingColor;
    saveLabels();
    saveLabelUI();
    closeLabelEditor(false);
    return;
  }
  if (labels.some(l => l.name === name)) { showLabelError('已存在同名标签「' + name + '」'); return; }
  labels.push({ id: 'lbl_' + generateId(), name: name, color: labelEditingColor });
  saveLabels();
  closeLabelEditor(false);
}

/* 选色即生效：改的是标签表里的一处，事项里的 chip 按 id 现查，自动跟着变 */
function setLabelColor(c) {
  if (!c) return;
  labelEditingColor = c;
  saveLabelUI();
  renderLabelPalette();
  if (labelEditingId) {
    const d = labelDef(labelEditingId);
    if (d && d.color !== c) { d.color = c; saveLabels(); syncLabelRow(labelEditingId); render(); }
  }
}

/* 删除走**两步**，不用原生 confirm()：
   原生弹窗在嵌入式浏览器里可能被自动 dismiss（点了没反应），样式也和整套皮肤不搭。
   第一步点「删」→ 在面板里展开二次确认条（状态落库，刷新不丢）；第二步才真删。 */
function requestDelete(id) {
  if (!labelDef(id)) return;
  labelPendingDelete = id;
  saveLabelUI();
  renderLabelPanel();
}

function cancelDelete() {
  labelPendingDelete = null;
  saveLabelUI();
  renderLabelPanel();
}

/* 真删：标签表里移除，并从**所有**任务上清掉这个引用 */
function doDelete(id) {
  const d = labelDef(id);
  if (!d) return;
  labels = labels.filter(l => l.id !== id);
  saveLabels();
  if (labelPendingDelete === id) labelPendingDelete = null;   // 待确认条关掉
  if (labelFilter === id) labelFilter = null;                 // 正在筛的标签被删了，筛选自动失效
  saveLabelUI();
  let changed = false;
  todos.forEach(t => {
    if (t.labels && t.labels.indexOf(id) >= 0) {
      t.labels = t.labels.filter(x => x !== id);
      changed = true;
    }
  });
  if (changed) saveTodos();
  if (labelEditingId === id) closeLabelEditor(false);
  renderLabelPanel();
  render();
}

function toggleLabelPanel() {
  labelCollapsed = !labelCollapsed;
  labelCard.classList.toggle('collapsed', labelCollapsed);
  try { localStorage.setItem(LABEL_COLLAPSED_KEY, labelCollapsed ? '1' : '0'); } catch (e) {}
}

labelHead.addEventListener('click', toggleLabelPanel);
labelSaveBtn.addEventListener('click', commitLabel);
labelCancelBtn.addEventListener('click', () => closeLabelEditor(true));

/* 输入即改：改名实时生效，事项里的 chip 按 id 现查，名字立刻跟着变。
   （同时被校验拦下：空名 / 与别的标签重名都不写入）
   input 与 change 都监听：前者覆盖逐字输入，后者覆盖粘贴 / 中文输入法上屏。 */
function applyLiveName() {
  if (!labelEditingId) return;
  const d = labelDef(labelEditingId);
  if (!d) return;
  const name = labelInput.value.trim();
  if (!name) { showLabelError('标签名不能为空'); return; }
  if (labels.some(l => l.id !== labelEditingId && l.name === name)) {
    showLabelError('已存在同名标签「' + name + '」');
    return;
  }
  showLabelError('');
  if (d.name !== name) { d.name = name; saveLabels(); syncLabelRow(labelEditingId); render(); }
}
labelInput.addEventListener('input', applyLiveName);
labelInput.addEventListener('change', applyLiveName);

/* 中文输入法组词过程中的 Enter 不能当成提交 */
let labelComposing = false;
labelInput.addEventListener('compositionstart', () => { labelComposing = true; });
labelInput.addEventListener('compositionend', () => { labelComposing = false; });
labelInput.addEventListener('keydown', e => {
  if (labelComposing) return;
  if (e.key === 'Enter') { e.preventDefault(); commitLabel(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeLabelEditor(true); }
});

/* ---------- 事项内的标签 ---------- */
function renderItemLabels() {
  const byId = {};
  todos.forEach(t => { byId[t.id] = t; });
  todoList.querySelectorAll('.todo-item').forEach(itemEl => {
    const box = itemEl.querySelector('.todo-labels');
    if (!box) return;
    box.innerHTML = '';
    const t = byId[itemEl.dataset.id];
    if (!t || !t.labels) return;
    t.labels.forEach(lid => {
      const def = labelDef(lid);
      if (!def) return;                    // 悬空引用不渲染
      const chip = document.createElement('span');
      chip.className = 'todo-lbl' + (isLight(def.color) ? ' dark' : '');
      chip.style.background = def.color;
      const name = document.createElement('span');
      name.textContent = def.name;
      chip.appendChild(name);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'todo-lbl-x';
      x.textContent = '×';
      x.title = '从该任务移除此标签';
      x.addEventListener('click', ev => { ev.stopPropagation(); removeLabelFromTodo(t.id, lid); });
      chip.appendChild(x);
      box.appendChild(chip);
    });
  });
}

function addLabelToTodo(todoId, labelId) {
  const t = todos.find(x => x.id === todoId);
  if (!t || !labelExists(labelId)) return;
  if (!Array.isArray(t.labels)) t.labels = [];
  if (t.labels.indexOf(labelId) >= 0) return;
  t.labels.push(labelId);
  saveTodos();
  render();
  renderLabelPanel();   // 面板上的「该标签有多少事项」计数要跟着变
}

function removeLabelFromTodo(todoId, labelId) {
  const t = todos.find(x => x.id === todoId);
  if (!t || !Array.isArray(t.labels)) return;
  const i = t.labels.indexOf(labelId);
  if (i < 0) return;
  t.labels.splice(i, 1);
  saveTodos();
  render();
  renderLabelPanel();
}

/* ---------- 拖放：把全局标签拖到某个任务上 ---------- */
let dropTargetEl = null;

function clearDropHighlight() {
  if (dropTargetEl) { dropTargetEl.classList.remove('drop-target'); dropTargetEl = null; }
}

function onLabelDragStart(e) {
  e.dataTransfer.setData('text/plain', this.dataset.labelId);
  e.dataTransfer.effectAllowed = 'copy';
  this.classList.add('dragging');
}

function onLabelDragEnd(e) {
  this.classList.remove('dragging');
  clearDropHighlight();
}

todoList.addEventListener('dragover', e => {
  const item = e.target.closest ? e.target.closest('.todo-item') : null;
  if (!item) return;                       // 不在任务上：不 preventDefault，浏览器不会触发 drop
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  if (dropTargetEl !== item) {
    clearDropHighlight();
    item.classList.add('drop-target');
    dropTargetEl = item;
  }
});

todoList.addEventListener('dragleave', e => {
  const item = e.target.closest ? e.target.closest('.todo-item') : null;
  if (!item) return;
  // 在任务内部的子元素之间移动也会冒泡 dragleave，用 relatedTarget 判断是否真的离开了这个任务
  if (e.relatedTarget && item.contains(e.relatedTarget)) return;
  if (item === dropTargetEl) clearDropHighlight();
});

todoList.addEventListener('drop', e => {
  e.preventDefault();
  const item = e.target.closest ? e.target.closest('.todo-item') : null;
  clearDropHighlight();
  if (!item) return;
  const id = e.dataTransfer.getData('text/plain');
  if (!id) return;
  addLabelToTodo(item.dataset.id, id);
});

todoDate.value = selectedDate;
loadLabels();
loadTodos();
pruneDanglingLabels();
labelCollapsed = localStorage.getItem(LABEL_COLLAPSED_KEY) === '1';
labelCard.classList.toggle('collapsed', labelCollapsed);
loadLabelUI();
restoreLabelEditor();
renderLabelPanel();
renderCalendar();
render();
  