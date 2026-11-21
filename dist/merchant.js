import { count, date, demo, esc, readLocal, saveLocal, statusLabels, won } from "./db.js";

let storeId = readLocal("seoul-demo-store", "G0427");
let catalog = { stores: [] };
let allOrders = [];
const headings = { home: "홈", orders: "주문 내역", menu: "메뉴 관리", sales: "매출", reviews: "리뷰 관리" };
const content = document.querySelector("#dashboard-content");
const message = document.querySelector("#merchant-message");
let tab = "home";
let orders = [];
let menus = [];
let editing;
let page = 0;
let orderFilter = "";
let monthFilter = "";
let busy = false;
let interview;
const interviewSteps = [
  { key: 'portion', label: '양', max: 60 },
  { key: 'composition', label: '구성', max: 240 },
  { key: 'taste', label: '맛', max: 60 },
  { key: 'features', label: '특징', max: 100 },
];
const pageSize = 20;
const dayKey = value => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const empty = text => '<p class="empty">' + esc(text) + '</p>';
const action = (label, mode, value = "", style = "secondary") => '<button type="button" class="' + style + '" data-mode="' + mode + '" data-value="' + esc(value) + '">' + esc(label) + '</button>';

async function selectStore(id) {
  menus = id ? await demo("store_menus", { target: id }) : [];
  storeId = id;
  orders = allOrders.filter(order => order.store_id === storeId);
}

async function load() {
  [catalog, allOrders] = await Promise.all([
    demo("catalog", { stores_only: true, include_order_stores: true, include_menu_details: true }), demo("orders")
  ]);
  await selectStore(catalog.stores.some(store => store.id === storeId) ? storeId : catalog.stores[0]?.id);
  renderStoreSelector();
}

function controls(order) {
  const transitions = {
    pending: [["접수하기", "accepted", "primary"], ["거절", "rejected", "secondary"]],
    accepted: [["배달 시작", "delivering", "primary"]],
    delivering: [["배달 완료", "completed", "primary"]]
  };
  return (transitions[order.status] || []).map(([label, status, style]) => action(label, "status", order.id + "/" + status, style)).join("");
}

function orderTable(rows) {
  if (!rows.length) return empty("해당하는 주문이 없습니다.");
  return '<div class="table-wrap"><table><thead><tr><th>주문 시각</th><th>메뉴·배달 주소</th><th>시연 주문 금액</th><th>상태</th><th>주문 처리</th></tr></thead><tbody>' +
    rows.map(order => '<tr><td>' + date(order.created_at) + '<small>#' + order.id.slice(0, 8) +
    '</small></td><td><strong>' + order.items.map(item => esc(item.name) + " × " + item.quantity).join(" · ") +
    '</strong><small>' + esc(order.address) + '</small></td><td>' + won(order.total) +
    '</td><td><span class="label">' + statusLabels[order.status] + '</span></td><td><div class="row-actions">' + controls(order) + '</div></td></tr>').join("") + '</tbody></table></div>';
}

function salesFor(predicate) {
  const rows = orders.filter(order => order.status === "completed" && order.completed_at && predicate(dayKey(order.completed_at)));
  const sum = rows.reduce((total, order) => total + order.subtotal, 0);
  return { rows, sum };
}

function home() {
  const pending = orders.filter(order => order.status === "pending");
  const delivering = orders.filter(order => ["accepted", "delivering"].includes(order.status));
  const today = salesFor(day => day === dayKey(Date.now()));
  const shop = catalog.stores.find(store => store.id === storeId);
  const info = shop ? '<section class="panel"><h2>가게 정보</h2><p>' + esc(shop.name) + ' · ' + esc(shop.category) +
    ' · ' + esc(shop.district) + ' · 배달비 ' + won(shop.delivery_fee) + '</p><p>' +
    (!shop.is_listed ? '이전 주문 가게' : shop.is_open ? '배달 가능' : '배달 마감') +
    ' · 착한가게 ' + (shop.is_good_price ? '지정' : '미지정') +
    ' · 노출 ' + count(shop.exposure_count) + '회</p></section>' : "";
  return info + '<div class="dash-stats"><article><span>접수 대기</span><strong>' + pending.length +
    '건</strong></article><article><span>조리·배달 중</span><strong>' + delivering.length +
    '건</strong></article><article><span>오늘 메뉴 매출</span><strong>' + won(today.sum) +
    '</strong></article></div><section class="panel"><h2>신규 주문</h2>' + orderTable(pending) +
    '</section><section class="panel"><h2>배달 현황</h2>' + orderTable(delivering) + '</section>';
}

function history() {
  const rows = orderFilter ? orders.filter(order => order.status === orderFilter) : orders;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  page = Math.min(page, pages - 1);
  return '<section class="panel"><div class="spread"><h2>전체 주문 ' + rows.length + '건</h2><label>상태 <select id="order-filter">' +
    '<option value="">전체</option>' + Object.entries(statusLabels).map(([key, label]) => '<option value="' + key + '"' +
      (orderFilter === key ? " selected" : "") + '>' + label + '</option>').join("") + '</select></label></div>' +
    orderTable(rows.slice(page * pageSize, (page + 1) * pageSize)) + '<div class="pager">' +
    (page ? action("이전", "page", page - 1) : '') + '<span>' + (page + 1) + ' / ' + pages + '</span>' +
    (page + 1 < pages ? action("다음", "page", page + 1) : '') + '</div></section>';
}

function menu() {
  const item = menus.find(row => row.id === editing);
  const details = catalog.menu_details?.[item?.id] ?? {};
  return '<section class="panel"><h2>' + (item ? "메뉴 수정" : "메뉴 등록") + '</h2><form id="menu-form" class="menu-form">' +
    '<label>메뉴명<input name="name" required maxlength="80" value="' + esc(item?.name) + '"></label>' +
    '<label>가격 (원)<input name="price" type="number" min="1" max="1000000" required value="' + esc(item?.price) + '"></label>' +
    '<div class="menu-form-wide menu-form-actions">' + action('AI 질문 시작', 'start-interview', '', 'primary') +
    (item ? action('취소', 'cancel-edit') : '') + '</div>' +
    '<section id="menu-interview" class="menu-form-wide menu-interview" aria-label="메뉴 설명 질문" hidden></section>' +
    '<details id="menu-details" class="menu-form-wide menu-details"' + (item ? ' open' : '') + '><summary>메뉴 정보와 설명 직접 수정</summary>' +
    '<div class="menu-form menu-detail-fields">' +
    '<label>맛<input name="taste" maxlength="60" value="' + esc(details.taste) + '"></label>' +
    '<label>몇 인분<input name="servings" type="number" min="1" max="20" value="' + esc(details.servings) + '"></label>' +
    '<label>양<input name="portion" maxlength="60" value="' + esc(details.portion) + '"></label>' +
    '<label>특징<input name="features" maxlength="100" value="' + esc(details.features) + '"></label>' +
    '<label class="menu-form-wide">구성·설명 메모<textarea name="notes" maxlength="240" rows="2">' + esc(details.notes) + '</textarea></label>' +
    '<label class="menu-form-wide">고객에게 표시할 설명<textarea name="description" maxlength="240" rows="3" placeholder="설명을 직접 작성하거나 AI 초안을 만들어 편집하세요">' + esc(item?.description) + '</textarea></label>' +
    '<div class="menu-form-wide menu-form-actions"><label class="check"><input type="checkbox" name="available"' + (item?.available !== false ? " checked" : "") + '>판매 중</label>' +
    '<button type="submit" class="primary">' + (item ? "수정 저장" : "메뉴 등록") + '</button>' +
    '</div></div></details></form></section><section class="panel"><h2>메뉴 목록</h2>' +
    (menus.length ? '<div class="table-wrap"><table><thead><tr><th>메뉴명</th><th>가격</th><th>판매 상태</th><th>관리</th></tr></thead><tbody>' +
      menus.map(row => '<tr><td><strong>' + esc(row.name) + '</strong><small>' + esc(row.description) +
      '</small></td><td>' + won(row.price) + '</td><td>' + (row.available ? "판매 중" : "품절") +
      '</td><td><div class="row-actions">' + action("수정", "edit", row.id) + action("삭제", "delete", row.id) +
      '</div></td></tr>').join("") + '</tbody></table></div>' : empty("등록된 메뉴가 없습니다.")) + '</section>';
}

function sales() {
  const today = dayKey(Date.now());
  const month = monthFilter || today.slice(0, 7);
  const daily = salesFor(day => day === today);
  const monthly = salesFor(day => day.startsWith(month));
  const sold = new Map();
  for (const order of monthly.rows) {
    for (const item of order.items) {
      const key = item.id + ":" + item.name;
      const row = sold.get(key) || { name: item.name, quantity: 0, revenue: 0 };
      row.quantity += item.quantity;
      row.revenue += item.price * item.quantity;
      sold.set(key, row);
    }
  }
  return '<div class="dash-stats"><article><span>오늘 메뉴 매출</span><strong>' + won(daily.sum) + '</strong></article><article><span>' +
    esc(month) + ' 메뉴 매출</span><strong>' + won(monthly.sum) + '</strong></article><article><span>이번 조회 월 완료 주문</span><strong>' +
    monthly.rows.length + '건</strong></article></div><section class="panel"><div class="spread"><h2>월별 판매 메뉴</h2><label>조회 월 <input id="sales-month" type="month" value="' +
    esc(month) + '"></label></div><p class="muted">한국 시간 배달 완료일 기준 · 배달비 제외</p>' +
    (sold.size ? '<div class="table-wrap"><table><thead><tr><th>메뉴</th><th>판매 수량</th><th>매출</th></tr></thead><tbody>' +
      [...sold.values()].sort((a, b) => b.revenue - a.revenue).map(row =>
        '<tr><td>' + esc(row.name) + '</td><td>' + row.quantity + '개</td><td>' + won(row.revenue) + '</td></tr>').join("") +
      '</tbody></table></div>' : empty("해당 월에 배달 완료된 주문이 없습니다.")) + '</section>';
}

function reviews() {
  const rows = orders.filter(order => order.delivery_reviews).map(order => ({ ...order.delivery_reviews, id: order.id, items: order.items }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return '<section class="panel"><h2>리뷰 ' + rows.length + '건</h2>' +
    (rows.length ? rows.map(review => '<article class="merchant-review"><div class="spread"><strong>★ ' + review.rating +
      ' / 5</strong><small>' + date(review.created_at) + '</small></div><small>' + review.items.map(item => esc(item.name)).join(" · ") +
      '</small><p>' + esc(review.body) + '</p><form class="reply-form stack" data-review="' + review.id +
      '"><label>사장님 답변<textarea name="reply" rows="2" required maxlength="800">' + esc(review.reply) +
      '</textarea></label><button class="primary" type="submit">' + (review.reply ? "답변 수정" : "답변 등록") + '</button></form></article>').join("") :
      empty("등록된 리뷰가 없습니다.")) + '</section>';
}

function renderStoreSelector() {
  const orderStores = new Set(allOrders.map(order => order.store_id));
  const sorted = [...catalog.stores].sort((a, b) => Number(orderStores.has(b.id)) - Number(orderStores.has(a.id)));
  document.querySelector("#dashboard-actions").innerHTML =
    '<select aria-label="시연 가게 선택" id="demo-store">' + sorted.map(store =>
      '<option value="' + esc(store.id) + '"' + (store.id === storeId ? ' selected' : '') +
      '>' + esc(store.name + " · " + store.district) + (orderStores.has(store.id) ? " · 주문 있음" : "") + '</option>').join("") +
    '</select>' + action("새로고침", "refresh");
}

function render() {
  interview = undefined;
  document.querySelector("#dashboard-title").textContent = headings[tab];
  document.querySelector(".sidebar-shop strong").textContent = catalog.stores.find(store => store.id === storeId)?.name || "가게를 불러오는 중";
  document.querySelectorAll("[data-tab]").forEach(node => {
    if (node.dataset.tab === tab) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
  content.innerHTML = ({ home, orders: history, menu, sales, reviews })[tab]();
}

async function run(work, button) {
  if (busy) return;
  busy = true;
  message.textContent = "";
  if (button) button.disabled = true;
  try { await work(); }
  catch (error) { message.textContent = error.message; }
  finally {
    busy = false;
    if (button?.isConnected) button.disabled = false;
  }
}

function readMenuForm(raw) {
  const servings = raw.get('servings');
  return {
    name: raw.get('name').trim(), price: Number(raw.get('price')),
    description: raw.get('description').trim(), available: raw.has('available'),
    details: {
      taste: raw.get('taste').trim(), servings: servings ? Number(servings) : null,
      portion: raw.get('portion').trim(), features: raw.get('features').trim(), notes: raw.get('notes').trim(),
    },
  };
}

async function requestMenuText(form, payload, waiting) {
  message.textContent = waiting;
  form.inert = true;
  try {
    const response = await fetch('/api/menu-description', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || '메뉴 설명 서비스에 다시 연결해 주세요.');
    return data;
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' || error instanceof TypeError
      ? '메뉴 설명 서비스에 연결하지 못했습니다. 다시 시도해 주세요.' : error.message);
  } finally {
    form.inert = false;
  }
}

function renderQuestion() {
  const { form, questions, answers, step } = interview;
  const { key, label, max } = interviewSteps[step];
  const panel = form.querySelector('#menu-interview');
  panel.innerHTML = '<p class="menu-question-step">질문 ' + (step + 1) + '/' + interviewSteps.length + ' · ' + label + '</p>' +
    '<label for="menu-answer">' + esc(questions[key]) + '</label>' +
    '<textarea id="menu-answer" rows="2" maxlength="' + max + '" placeholder="답변을 적어 주세요">' + esc(answers[key]) + '</textarea>' +
    '<div class="menu-form-actions">' +
    action(step === interviewSteps.length - 1 ? '설명 초안 만들기' : '다음 질문', 'interview-next', '', 'primary') +
    action('건너뛰기', 'interview-skip') + (step ? action('이전 질문', 'interview-back') : '') +
    action('질문 닫기', 'interview-close', '', 'plain') + '</div>';
  panel.hidden = false;
  panel.querySelector('#menu-answer').focus();
}

async function startInterview(form) {
  if (!form.elements.name.reportValidity() || !form.elements.price.reportValidity()) return;
  const { name, price, details } = readMenuForm(new FormData(form));
  const category = catalog.stores.find(store => store.id === storeId)?.category;
  const { questions } = await requestMenuText(form, { action: 'questions', name, price, category }, '메뉴에 맞는 질문을 준비하고 있습니다.');
  if (!interviewSteps.every(({ key }) => typeof questions?.[key] === 'string' && questions[key])) {
    throw new Error('질문을 준비하지 못했습니다. 다시 시도해 주세요.');
  }
  if (!form.isConnected) return;
  interview = {
    form, name, price, questions, step: 0, servings: details.servings,
    answers: { portion: details.portion, composition: details.notes, taste: details.taste, features: details.features },
  };
  form.elements.name.readOnly = true;
  form.elements.price.readOnly = true;
  form.querySelector('[data-mode="start-interview"]').hidden = true;
  form.querySelector('#menu-details').hidden = true;
  form.querySelector('button[type="submit"]').disabled = true;
  message.textContent = '';
  renderQuestion();
}

function closeInterview(form) {
  form.elements.name.readOnly = false;
  form.elements.price.readOnly = false;
  form.querySelector('#menu-interview').hidden = true;
  form.querySelector('#menu-interview').replaceChildren();
  form.querySelector('#menu-details').hidden = false;
  form.querySelector('[data-mode="start-interview"]').hidden = false;
  form.querySelector('button[type="submit"]').disabled = false;
  interview = undefined;
}

async function advanceInterview(mode, form) {
  if (interview?.form !== form) return;
  if (mode === 'interview-close') {
    closeInterview(form);
    form.querySelector('[data-mode="start-interview"]').focus();
    return;
  }
  const { key } = interviewSteps[interview.step];
  const field = form.querySelector('#menu-answer');
  const answer = mode === 'interview-skip' ? '' : field.value.trim();
  if (mode === 'interview-next' && !answer) throw new Error('답변을 적거나 건너뛰어 주세요.');
  interview.answers[key] = answer;

  if (mode === 'interview-back' || interview.step < interviewSteps.length - 1) {
    interview.step += mode === 'interview-back' ? -1 : 1;
    renderQuestion();
    return;
  }

  const { name, price, answers, servings } = interview;
  const draft = await requestMenuText(form, { name, price, answers, servings }, '답변을 바탕으로 설명 초안을 만드는 중입니다.');
  if (typeof draft.description !== 'string' || !draft.details) throw new Error('설명 초안을 불러오지 못했습니다. 다시 시도해 주세요.');
  for (const field of ['portion', 'taste', 'features', 'notes', 'servings']) {
    form.elements[field].value = draft.details[field] ?? '';
  }
  form.elements.description.value = draft.description;
  closeInterview(form);
  form.querySelector('#menu-details').open = true;
  form.elements.description.focus();
  message.textContent = draft.provider === 'gemini'
    ? 'AI 초안을 만들었습니다. 설명을 확인하고 저장해 주세요.'
    : '답변을 정리했습니다. 설명을 확인하고 저장해 주세요.';
}

document.addEventListener("click", event => {
  const control = event.target.closest("[data-tab], [data-mode]");
  if (!control || busy) return;
  if (control.dataset.tab) { tab = control.dataset.tab; render(); return; }
  const { mode, value } = control.dataset;
  if (mode === 'start-interview') { void run(() => startInterview(control.form), control); return; }
  if (mode.startsWith('interview-')) { void run(() => advanceInterview(mode, control.form), control); return; }
  void run(async () => {
    if (mode === "refresh") await load();
    if (mode === "page") page = Number(value);
    if (mode === "edit") editing = value;
    if (mode === "cancel-edit") editing = undefined;
    if (mode === "status") {
      const [target, next_status] = value.split("/");
      await demo("state", { order_id: target, next_status });
      await load();
      message.textContent = "주문 상태를 변경했습니다.";
    }
    if (mode === "delete") {
      if (!window.confirm("이 메뉴를 삭제할까요? 이전 주문 기록에는 메뉴가 남습니다.")) return;
      await demo("remove_menu", { target: storeId, id: value });
      editing = undefined;
      await load();
      message.textContent = "메뉴를 삭제했습니다.";
    }
    render();
    if (mode === "edit") content.querySelector("#menu-form input")?.focus();
  }, control);
});

document.addEventListener("change", event => {
  if (event.target.id === "demo-store") {
    const selector = event.target;
    const id = selector.value;
    selector.value = storeId || "";
    void run(async () => {
      await selectStore(id);
      selector.value = id;
      saveLocal("seoul-demo-store", storeId);
      editing = undefined;
      page = 0;
      render();
    }, selector);
  }
  if (event.target.id === "order-filter") { orderFilter = event.target.value; page = 0; render(); }
  if (event.target.id === "sales-month" && event.target.value) { monthFilter = event.target.value; render(); }
});

content.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'menu-form' && interview?.form === form) return;
  if (form.id === 'menu-form' && !form.querySelector('#menu-details').open) {
    void run(() => startInterview(form), form.querySelector('[data-mode="start-interview"]'));
    return;
  }
  const raw = new FormData(form);
  void run(async () => {
    if (form.id === "menu-form") {
      const item = readMenuForm(raw);
      if (!item.name) throw new Error("메뉴명을 입력해 주세요.");
      await demo("save_menu", { target: storeId, id: editing, ...item });
      editing = undefined;
      await load();
      message.textContent = catalog.menu_details
        ? "메뉴를 저장했습니다. 이 브라우저의 손님 추천에 반영됩니다."
        : "메뉴를 저장했습니다. 추천 연동에 필요한 DB 업데이트를 확인해 주세요.";
    }
    if (form.classList.contains("reply-form")) {
      const reply = raw.get("reply").trim();
      if (!reply) throw new Error("답변 내용을 입력해 주세요.");
      await demo("reply", { order_id: form.dataset.review, body: reply });
      await load();
      message.textContent = "답변을 저장했습니다.";
    }
    render();
  }, event.submitter);
});

try { await load(); render(); }
catch (error) { renderStoreSelector(); render(); message.textContent = error.message; }
