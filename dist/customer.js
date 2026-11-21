import { count, date, demo, esc, readLocal, saveLocal, statusLabels, won } from "./db.js";
import { addCartMenu, readCart as cart, setCartAccount, writeCart } from "./cart.js";
import { customerData, customerRequest, notifySessionChange, reloadOnSessionChange } from "./customer-session.js";
import { AGREEMENT_VERSION, entryTerms, finalTerms, koreanAgeAtSignup, signupDetailsError } from "./signup.js";
import { mountAddressPicker } from "./address-picker.js";

const screen = document.querySelector("#screen");
const bar = document.querySelector("#checkout-bar");
const message = document.querySelector("#customer-message");
const icons = { chicken: 3, dessert: 4, pizza: 5, korean: 6, burger: 7, chinese: 8, more: 9 };
const glyphs = { japanese: "🍣", western: "🍝", nearby: "📍" };
const state = { categories: [], stores: [], menuGroups: new Map(), menuMatches: new Set(), query: "", addressQuery: "", listLimit: 30 };
let route = { name: "home" };
let previous = [];
let busy = false;
let messageTimer;
let searchTimer;
let searchRequest = 0;
let signup = freshSignup();
let unmountAddressPicker;
const entryParams = new URLSearchParams(location.search);
const linkedStore = entryParams.get("store");
const linkedCart = entryParams.get("view") === "cart";
let fromRecommendation = entryParams.get("from") === "recommend" && !!(linkedStore || linkedCart);

const storageKey = name => "seoul-demo-" + (state.account?.id || "guest") + ":" + name;
const stored = (name, fallback) => readLocal(storageKey(name), fallback);
const write = (name, value) => saveLocal(storageKey(name), value);
const favorites = () => state.favorites || [];
const addresses = () => stored("addresses", []);
const activeAddress = () => addresses().find(item => item.id === stored("address", null)) || { road: "서울 서초구 시연 주소" };
const getStore = id => state.stores.find(store => store.id === id);
const menusFor = id => state.menuGroups.get(id) || [];
const itemCount = rows => rows.reduce((total, item) => total + item.quantity, 0);
const cost = rows => rows.reduce((total, item) => total + item.price * item.quantity, 0);
const empty = text => '<p class="empty">' + esc(text) + '</p>';
const icon = (label, symbol, action) => '<button class="icon-button" aria-label="' + label + '" data-act="' + action + '">' + symbol + '</button>';
const button = (label, action, value = "", className = "secondary") =>
  '<button type="button" class="' + className + '" data-act="' + action + '" data-value="' + esc(value) + '">' + esc(label) + '</button>';
const top = (title, tools = "") => '<header class="screen-header">' + icon("뒤로 가기", "←", "back") + '<h1>' + esc(title) + '</h1>' + tools + '</header>';
const addressText = address => [address.road, address.detail].filter(Boolean).join(" ");

function notify(text) {
  clearTimeout(messageTimer);
  message.textContent = text;
  message.classList.add("visible");
  messageTimer = setTimeout(() => message.classList.remove("visible"), 4000);
}

function setAccount(account, moveGuest = false) {
  state.account = account;
  state.favorites = undefined;
  state.orders = undefined;
  state.activityError = "";
  state.authNote = "";
  setCartAccount(account?.id, moveGuest);
}

function freshSignup() {
  return { entry: {}, final: {}, details: {} };
}

function inSignup(name) {
  return ["signup", "signup-details", "signup-consent"].includes(name);
}

function loginGate(text) {
  return '<section class="pane stack auth-panel"><h2>로그인이 필요해요</h2>' +
    '<p class="muted">' + esc(text) + '</p>' + button("로그인", "signin", "", "primary") + '</section>';
}

function requireLogin() {
  if (state.account) return true;
  open("signin");
  return false;
}

async function loadFavorites() {
  const account = state.account;
  if (!account) return;
  const rows = await customerData("customer_favorites", account);
  if (state.account === account) state.favorites = rows;
}

function open(name, value, tab = false) {
  if (tab && inSignup(route.name)) signup = freshSignup();
  if (name === "signup" && !inSignup(route.name)) signup = freshSignup();
  if (tab) { previous = []; fromRecommendation = false; }
  else previous.push(route);
  route = { name, value };
  state.listLimit = 30;
  if (name === "search") {
    state.query = "";
    state.menuMatches.clear();
    searchRequest += 1;
    clearTimeout(searchTimer);
  }
  if (name === "addresses") state.addressQuery = "";
  render(true);
  if (name === "search") screen.querySelector("#search-query")?.focus();
  if (["orders", "notifications", "my-reviews"].includes(name) && state.account) void fetchActivity();
  if (name === "favorites" && state.account) void run(async () => { await loadFavorites(); render(); });
}

function back() {
  if (!previous.length && fromRecommendation) {
    const referrer = document.referrer && new URL(document.referrer);
    const recommendation = new URL("recommend.html", location.href);
    if (referrer && referrer.origin === recommendation.origin && referrer.pathname === recommendation.pathname && history.length > 1) history.back();
    else location.replace(recommendation.href);
    return;
  }
  const next = previous.pop() ?? { name: "home" };
  if (inSignup(route.name) && !inSignup(next.name)) signup = freshSignup();
  route = next;
  state.listLimit = 30;
  render(true);
}

async function catalog() {
  const { stores } = await demo("catalog", { stores_only: true });
  const preferred = [["chicken","치킨"],["dessert","카페/디저트"],["pizza","피자"],["korean","한식"],
    ["burger","버거"],["chinese","중식"],["japanese","일식"],["western","양식"]];
  const known = new Map(preferred);
  const additional = new Map(stores.filter(store => !known.has(store.category_id))
    .map(store => [store.category_id, store.category]));
  state.categories = [...preferred, ...[...additional].sort((a, b) => a[1].localeCompare(b[1], "ko"))]
    .map(([id, name]) => ({ id, name }));
  state.stores = stores;
}

async function loadMenus(id) {
  const menus = await demo("store_menus", { target: id });
  state.menuGroups.set(id, menus.filter(item => item.available));
}

function storeBadges(store) {
  return '<span class="catalog-badges"><span class="catalog-badge ' + (store.is_open ? "is-open" : "") + '">' +
    (store.is_open ? "배달 가능" : "배달 마감") + '</span>' +
    (store.is_good_price ? '<span class="catalog-badge good-price">착한가게</span>' : '') + '</span>';
}

function categoryImage(id) {
  return icons[id] === undefined
    ? '<span class="cat-glyph" aria-hidden="true">' + (glyphs[id] || "▦") + '</span>'
    : '<img src="assets/cat-' + icons[id] + '.webp" alt="">';
}

function home() {
  const cats = [...state.categories.slice(0, 8), { id: "nearby", name: "주변 가게" }, { id: "more", name: "더보기" }];
  const address = activeAddress();
  return '<section class="home-screen"><h1 class="home-brand">당겨요</h1><header class="home-head">' +
    '<button class="address-button" data-act="addresses"><span class="pin" aria-hidden="true"></span><strong>' +
    esc(address ? address.road : "배달 주소를 등록해 주세요") + '</strong><span aria-hidden="true">⌄</span></button>' +
    '<button class="icon-button image-icon" aria-label="알림 목록" data-act="notifications"><img src="assets/bell.webp" alt=""></button>' +
    '<button class="icon-button image-icon cart-icon" aria-label="장바구니" data-act="cart"><img src="assets/cart.webp" alt="">' +
    (cart().length ? '<span class="count">' + itemCount(cart()) + '</span>' : '') + '</button></header>' +
    '<button class="home-search" data-act="search"><span class="glass" aria-hidden="true"></span>음식이나 가게를 검색해 보세요</button>' +
    '<section class="category-grid" aria-label="음식 카테고리">' +
    cats.map(cat => '<button data-act="category" data-value="' + esc(cat.id) + '">' + categoryImage(cat.id) + '<span>' + esc(cat.name) + '</span></button>').join("") +
    '</section></section>';
}

function addressList() {
  return top("주소 설정", icon("주소 추가", "✎", "address-new")) +
    '<div class="pane stack"><label class="search-field"><span class="glass" aria-hidden="true"></span>' +
    '<input type="search" id="address-query" aria-label="저장한 주소 검색" placeholder="도로명, 건물명, 지번으로 검색" value="' + esc(state.addressQuery) + '"></label>' +
    button("⌖ 현재 위치로 찾기", "location") + button("⌂ 우리집 추가", "address-new", "우리집", "plain left") +
    '</div><div id="address-results" class="address-results">' + addressResults() + '</div>';
}

function addressResults() {
  const list = addresses();
  if (!list.length) return empty("등록된 주소가 없습니다. 오른쪽 위 연필 버튼으로 배달 주소를 등록해 주세요.");
  const matches = list.filter(item => (addressText(item) + " " + item.label).includes(state.addressQuery.trim()));
  const selectedId = stored("address", null);
  return matches.map(item => {
    const selected = item.id === selectedId;
    const label = item.label || item.road;
    return '<div class="saved-address"><button type="button" class="address-row" data-act="address-select" data-value="' + esc(item.id) + '"><span class="pin" aria-hidden="true"></span><span><strong>' +
      esc(label) + '</strong>' + (selected ? ' <small class="selected-address">현재 설정된 주소</small>' : '') +
      '<span>' + esc(addressText(item)) + '</span>' + (item.note ? '<small>' + esc(item.note) + '</small>' : '') +
      '</span><span aria-hidden="true">' + (selected ? "✓" : "") + '</span></button>' +
      '<button type="button" class="address-delete" data-act="address-delete" data-value="' + esc(item.id) +
      '" aria-label="' + esc(label + " 주소 삭제") + '">삭제</button></div>';
  }).join("") || empty("일치하는 주소가 없습니다.");
}

function addressForm() {
  return top("주소 등록") + '<form id="address-form" class="pane stack">' +
    '<label>별칭<input name="label" maxlength="30" placeholder="우리집" value="' + esc(route.value || "") + '"></label>' +
    '<label>도로명 또는 지번 주소<input name="road" required minlength="3" maxlength="110" placeholder="서울 서초구 …"></label>' +
    '<label>상세 주소<input name="detail" maxlength="55" placeholder="동, 호수"></label>' +
    '<label>배달 요청사항<input name="note" maxlength="80" placeholder="문 앞에 놓아 주세요"></label>' +
    '<button type="submit" class="primary">주소 저장</button></form>';
}

function addressPickerView() {
  return top("지도에서 위치 확인") + '<div class="address-picker">' +
    '<div class="address-map-area"><div class="address-map" aria-label="배달 위치 지도"></div>' +
    '<span class="address-map-pin" aria-hidden="true"></span>' +
    '<button type="button" class="map-locate map-locate-top">⌖ 현재 위치로 돌아가기</button>' +
    '<button type="button" class="map-locate" aria-label="현재 위치 다시 찾기">⌖</button></div>' +
    '<div class="pane stack map-address-panel"><strong class="map-address-heading">선택한 배달 주소</strong>' +
    '<p class="muted" id="map-address-status" role="status">지도에서 배달할 위치를 선택해 주세요.</p>' +
    '<form id="map-address-search" class="map-address-search"><label>도로명 또는 지번 주소' +
    '<input id="map-road" name="road" maxlength="110" required minlength="3" placeholder="주소를 입력해 위치 변경"></label>' +
    '<button type="submit" class="secondary">검색</button></form><div id="map-address-matches" class="stack"></div>' +
    '<form id="map-address-save" class="stack"><label>상세 주소<input name="detail" maxlength="55" placeholder="건물, 동, 호수"></label>' +
    '<button type="submit" class="primary" disabled>이 위치로 주소 등록</button></form>' +
    button("직접 주소 등록", "address-new", "", "plain left") + '</div></div>';
}

function heart(id) {
  const liked = favorites().includes(id);
  return '<button data-act="heart" data-value="' + esc(id) + '" class="heart ' + (liked ? "liked" : "") +
    '" aria-label="' + (liked ? "찜 취소" : "찜하기") + '" aria-pressed="' + liked + '">' + (liked ? "♥" : "♡") + '</button>';
}

function storeList(list) {
  if (!list.length) return empty("표시할 가게가 없습니다.");
  return '<div class="store-list">' + list.slice(0, state.listLimit).map(store =>
    '<article class="store-card"><button class="store-open" data-act="store" data-value="' + esc(store.id) + '">' +
    '<div class="media-placeholder" aria-hidden="true"></div><span class="store-card-text"><strong>' + esc(store.name) +
    '</strong><span>' + esc(store.district) + ' · ' + esc(store.category) + '</span><small>배달비 ' + won(store.delivery_fee) +
    '</small>' + storeBadges(store) + '</span></button>' + heart(store.id) + '</article>').join("") +
    (list.length > state.listLimit ? button("가게 더 보기", "load-more") : '') + '</div>';
}

function category() {
  const id = route.value;
  const title = state.categories.find(item => item.id === id)?.name || (id === "nearby" ? "주변 가게" : "더보기");
  const area = activeAddress()?.road;
  let list = state.stores;
  if (id === "nearby" && area) {
    const district = area.match(/(?:^|\s)([가-힣]+구)(?:\s|$)/)?.[1];
    list = district ? list.filter(store => store.district.includes(district)) : [];
  } else if (id !== "nearby" && id !== "more") list = list.filter(store => store.category_id === id);
  return top(title, icon("장바구니", "🛒", "cart")) +
    (id === "more" ? '<div class="pills">' + state.categories.map(cat => button(cat.name, "category", cat.id)).join("") + '</div>' : "") + storeList(list);
}

function searchResults() {
  const q = state.query.trim().toLocaleLowerCase("ko");
  const found = state.stores.filter(store => !q || state.menuMatches.has(store.id) ||
    [store.name, store.district, store.category, state.categories.find(cat => cat.id === store.category_id)?.name]
      .some(text => text?.toLocaleLowerCase("ko").includes(q)));
  return found.length ? storeList(found) : empty("검색 조건과 일치하는 가게나 메뉴가 없습니다.");
}

function search() {
  return top("검색") + '<div class="pane"><label class="search-field"><span class="glass" aria-hidden="true"></span><input id="search-query" type="search" maxlength="80" aria-label="가게 또는 메뉴 검색" placeholder="가게 또는 메뉴 이름" value="' +
    esc(state.query) + '"></label></div><div id="search-results">' + searchResults() + '</div>';
}

function detail() {
  const store = getStore(route.value);
  if (!store) return top("가게") + empty("현재 표시할 수 없는 가게입니다.");
  const items = menusFor(store.id);
  return top(store.name, icon("장바구니", "🛒", "cart")) +
    '<div class="media-placeholder store-hero" aria-hidden="true"></div><section class="pane store-detail">' +
    '<div class="spread"><h2>' + esc(store.name) + '</h2>' + heart(store.id) + '</div><p class="muted">' + esc(store.category) + ' · 합성 가게 데이터' +
    '</p>' + storeBadges(store) + '<dl class="delivery-details"><div><dt>가게 평점</dt><dd>' +
    (store.rating == null ? "평점 정보 없음" : esc(store.rating)) +
    (store.review_count == null ? "" : " · 리뷰 " + count(store.review_count) + "개") +
    '</dd></div><div><dt>배달비</dt><dd>' + won(store.delivery_fee) +
    '</dd></div><div><dt>가게 위치</dt><dd>' + esc(store.district) + '</dd></div><div><dt>노출 횟수</dt><dd>' +
    count(store.exposure_count) + '회</dd></div></dl></section>' +
    '<section class="menu-section"><div class="pane"><span class="active-pill">전체 메뉴</span><h2>메뉴</h2></div>' +
    (items.length ? items.map(item => {
      const quantity = cart().find(row => row.id === item.id)?.quantity;
      return '<article class="menu-row" data-menu-id="' + esc(item.id) + '"><div><h3>' + esc(item.name) + '</h3><p class="muted">' + esc(item.description) +
        '</p><strong>' + won(item.price) + '</strong>' + (quantity ? '<small class="in-cart">담은 수량 ' + quantity + '</small>' : '') +
        '</div><div class="menu-image media-placeholder"><button class="menu-add" aria-label="' + esc(item.name + " 담기") +
        '" data-act="add" data-value="' + esc(item.id) + '"' + (store.is_open ? "" : " disabled") + '>+</button></div></article>';
    }).join("") : empty("등록된 메뉴가 없습니다.")) + '</section>';
}

async function syncCart() {
  const rows = cart();
  const ids = [...new Set(rows.map(row => row.store_id))].filter(id => getStore(id)?.is_open);
  await Promise.all(ids.map(loadMenus));
  writeCart(rows.flatMap(row => {
    const store = getStore(row.store_id);
    const item = menusFor(row.store_id).find(menu => menu.id === row.id);
    return store?.is_open && item ? [{ ...row, ...item, store_name: store.name }] : [];
  }));
}

function basket() {
  const rows = cart();
  if (!rows.length) return top("장바구니") + empty("장바구니에 담긴 메뉴가 없습니다.");
  const groups = [...new Set(rows.map(row => row.store_id))];
  const selected = rows.filter(row => row.selected);
  return top("장바구니") + '<section class="pane stack">' + groups.map(id => {
    const store = getStore(id);
    return '<article class="basket-group"><h2>' + esc(store?.name || rows.find(row => row.store_id === id).store_name) + '</h2>' +
      rows.filter(row => row.store_id === id).map(item => '<div class="basket-item"><label><input type="checkbox" data-select="' + esc(item.id) + '"' +
        (item.selected ? " checked" : "") + '><span><strong>' + esc(item.name) + '</strong><small>' + won(item.price * item.quantity) +
        '</small></span></label><div class="quantity">' + button("−", "minus", item.id, "mini") + item.quantity +
        button("+", "plus", item.id, "mini") + '</div>' + button("삭제", "remove", item.id, "plain muted") + '</div>').join("") +
      '<p class="muted">배달비 ' + (store ? won(store.delivery_fee) : "확인 필요") + '</p></article>';
  }).join("") + '<div class="spread"><strong>선택한 메뉴 금액</strong><strong>' + won(cost(selected)) + '</strong></div>' +
  '<div class="spread"><span>배달 주소</span>' + button(activeAddress()?.road || "주소 등록", "addresses") + '</div></section>';
}

function account() {
  const user = state.account;
  return '<header class="screen-header"><h1>마이</h1></header><section class="pane stack">' +
    (user ? '<h2>' + esc(user.name) + ' 님</h2><p class="muted">' + esc(user.identifier || user.email) + '</p>' :
      '<h2>밥파일럿에 로그인하세요</h2><p class="muted">내 주문, 찜한 가게와 리뷰를 계정에서 확인할 수 있어요.</p>' +
      button("로그인", "signin", "", "primary") + button("회원가입", "signup")) +
    '<div class="account-links">' + button("주소 관리 ›", "addresses", "", "plain left") +
    button("주문 관리 ›", "orders", "", "plain left") + button("리뷰 관리 ›", "my-reviews", "", "plain left") +
    '<a class="plain left" href="merchant.html">사장님 화면 ↗</a></div>' +
    (user ? button("로그아웃", "signout") : "") + '</section>';
}

function authForm() {
  return top("로그인") + '<form id="auth-form" class="pane stack auth-panel">' +
    '<h2>주문자 로그인</h2>' +
    (state.authNote ? '<p class="auth-notice" role="status">' + esc(state.authNote) + '</p>' : "") +
    '<label>아이디 또는 이메일<input name="identifier" autocomplete="username" autocapitalize="none" required maxlength="254"></label>' +
    '<label>비밀번호<input name="password" type="password" autocomplete="current-password" required maxlength="72"></label>' +
    '<button class="primary" type="submit">로그인</button>' +
    button("처음이신가요? 회원가입", "signup") +
    '</form>';
}

function signupTerms(stage) {
  const final = stage === "final";
  const terms = final ? finalTerms : entryTerms;
  const checked = signup[stage];
  const heading = final ? "가입에 필요한 약관에 동의해 주세요" : "회원가입 전에 확인해 주세요";
  return top("회원가입") + '<section class="pane stack signup-card">' +
    '<p class="signup-step">' + (final ? "3" : "1") + ' / 3</p><h2>' + heading + '</h2>' +
    '<form class="signup-consent stack" id="signup-' + stage + '">' +
    '<label class="consent-all"><input type="checkbox" data-agree-all' +
    (terms.every(([key]) => checked[key]) ? " checked" : "") + '>필수 항목 전체 동의</label>' +
    terms.map(([key, title, content]) => '<div class="consent-item"><label><input type="checkbox" name="' + key + '"' +
      (checked[key] ? " checked" : "") + '><span><small>필수</small> ' + esc(title) + '</span></label>' +
      (content ? '<details><summary aria-label="' + esc(title) + ' 보기">내용</summary><p>' + esc(content) + '</p></details>' : "") +
      '</div>').join("") +
    '<button type="submit" class="primary"' + (terms.every(([key]) => checked[key]) ? "" : " disabled") + '>' +
    (final ? "완료" : "다음") + '</button></form></section>';
}

function signupForm() {
  const data = signup.details;
  return top("회원가입") + '<section class="pane stack signup-card"><p class="signup-step">2 / 3</p>' +
    '<h2>가입 정보를 입력해 주세요</h2><form id="signup-details" class="stack">' +
    '<label>휴대전화 번호<input name="phone" type="tel" autocomplete="tel" required maxlength="13" value="' + esc(data.phone) + '"></label>' +
    '<label>생년월일 8자리<input name="birth" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="off" required placeholder="YYYYMMDD" value="' + esc(data.birth) + '"></label>' +
    '<label>성별<select name="gender"><option value="">선택 안 함</option>' +
    '<option value="male"' + (data.gender === "male" ? " selected" : "") + '>남성</option>' +
    '<option value="female"' + (data.gender === "female" ? " selected" : "") + '>여성</option></select></label>' +
    '<label>이름<input name="name" autocomplete="name" required maxlength="30" value="' + esc(data.name) + '"></label>' +
    '<label>아이디<input name="identifier" autocomplete="username" autocapitalize="none" required maxlength="24" value="' + esc(data.identifier) + '"></label>' +
    '<label>비밀번호<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="72"></label>' +
    '<label>비밀번호 확인<input name="passwordConfirm" type="password" autocomplete="new-password" required minlength="8" maxlength="72"></label>' +
    '<p class="muted signup-hint">가입 시 계산한 세는나이와 선택한 성별이 계정에 기록됩니다. 휴대전화 번호와 생년월일은 이 화면에서만 확인합니다.</p>' +
    '<p id="signup-validation" class="signup-validation" role="status"></p>' +
    '<button type="submit" class="primary" disabled>다음</button></form></section>';
}

function refreshSignupForm(form) {
  const values = Object.fromEntries(new FormData(form));
  const message = signupDetailsError(values);
  const complete = Object.entries(values).every(([key, value]) => key === "gender" || !!value);
  form.querySelector("#signup-validation").textContent = complete ? message : "";
  form.querySelector('button[type="submit"]').disabled = !form.checkValidity() || !!message;
}

function activity(name) {
  const titles = { orders: "주문 내역", notifications: "알림", "my-reviews": "내 리뷰" };
  const header = name === "orders" ? '<header class="screen-header"><h1>주문 내역</h1>' + icon("새로고침", "↻", "refresh") + '</header>' :
    top(titles[name], icon("새로고침", "↻", "refresh"));
  if (!state.account) return header + loginGate("로그인하면 내 주문과 리뷰를 확인할 수 있어요.");
  if (state.activityError) return header + empty(state.activityError);
  if (!state.orders) return header + empty("불러오는 중…");
  const rows = name === "my-reviews" ? state.orders.filter(order => order.delivery_reviews) : state.orders;
  if (!rows.length) return header + empty(name === "notifications" ? "새 알림이 없습니다." : "아직 내역이 없습니다.");
  return header + '<section class="pane stack">' + rows.map(order => {
    const review = order.delivery_reviews;
    if (name === "notifications") return '<article class="order-card"><strong>' + esc(order.store_name) + ' · ' + statusLabels[order.status] +
      '</strong><small>' + date(order.completed_at || order.created_at) + '</small></article>';
    const list = order.items.map(item => esc(item.name) + " × " + item.quantity).join(" · ");
    return '<article class="order-card"><div class="spread"><small>' + date(order.created_at) + '</small><span class="label">' +
      statusLabels[order.status] + '</span></div><h2>' + esc(order.store_name) + '</h2><p>' + list + ' · ' + won(order.total) + '</p>' +
      (review ? '<p class="review-text">★ ' + review.rating + ' · ' + esc(review.body) +
        (review.reply ? '<small>사장님 답변 · ' + esc(review.reply) + '</small>' : '') + '</p>' :
        order.status === "completed" ? button("리뷰 쓰기", "review", order.id) : '') + '</article>';
  }).join("") + '</section>';
}

async function fetchActivity() {
  const account = state.account;
  if (!account) return;
  state.activityError = "";
  try {
    const orders = await customerData("customer_orders", account);
    if (state.account !== account) return;
    state.orders = orders;
  } catch (error) {
    if (state.account !== account) return;
    if (error.code === "login_required") setAccount(null);
    else state.activityError = error.message;
  }
  if (["orders", "notifications", "my-reviews"].includes(route.name)) render();
}

function reviewForm() {
  return top("리뷰 작성") + '<form id="review-form" class="pane stack"><label>별점<select name="rating">' +
    [5, 4, 3, 2, 1].map(n => '<option value="' + n + '">' + n + '점</option>').join("") +
    '</select></label><label>리뷰<textarea name="body" required maxlength="800" rows="5"></textarea></label>' +
    '<button class="primary" type="submit">리뷰 등록</button></form>';
}

const views = {
  home, addresses: addressList, "address-new": addressForm, "address-map": addressPickerView, category, search,
  store: detail, cart: basket, my: account,
  signin: authForm, signup: () => signupTerms("entry"), "signup-details": signupForm, "signup-consent": () => signupTerms("final"),
  review: () => state.account ? reviewForm() : top("리뷰 작성") + loginGate("로그인하고 배달을 완료한 주문에 리뷰를 쓸 수 있어요."),
  favorites: () => '<header class="screen-header"><h1>찜</h1></header>' +
    (state.account ? storeList(state.stores.filter(store => favorites().includes(store.id))) : loginGate("찜한 가게를 계정에 저장하려면 로그인하세요.")),
  orders: () => activity("orders"), notifications: () => activity("notifications"), "my-reviews": () => activity("my-reviews"),
};

function render(reset = false) {
  const scroll = reset ? 0 : screen.scrollTop;
  screen.classList.toggle("on-home", route.name === "home");
  unmountAddressPicker?.();
  unmountAddressPicker = undefined;
  screen.innerHTML = views[route.name]();
  screen.scrollTop = scroll;
  if (route.name === "address-map") unmountAddressPicker = mountAddressPicker(screen.querySelector(".address-picker"), route.value, saveAddress);
  if (route.name === "signup-details") {
    const form = screen.querySelector("#signup-details");
    form.elements.password.value = signup.details.password || "";
    form.elements.passwordConfirm.value = signup.details.passwordConfirm || "";
    refreshSignupForm(form);
  }
  const tab = ["home", "favorites", "orders", "my"].includes(route.name) ? route.name : previous.find(item => ["home", "favorites", "orders", "my"].includes(item.name))?.name;
  document.querySelectorAll("[data-go]").forEach(node => {
    if (node.dataset.go === tab) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
  const rows = route.name === "store" ? cart().filter(item => item.store_id === route.value && getStore(route.value)?.is_open) :
    route.name === "cart" ? cart().filter(item => item.selected) : [];
  const fee = route.name === "cart" ? [...new Set(rows.map(item => item.store_id))].reduce((sum, id) => sum + (getStore(id)?.delivery_fee || 0), 0) : 0;
  bar.innerHTML = rows.length ? '<button class="primary checkout-button" data-act="' + (route.name === "store" ? "cart" : "checkout") +
    '"><span class="checkout-count">' + itemCount(rows) + '</span><strong>' + won(cost(rows) + fee) +
    (route.name === "cart" && !state.account ? ' · 로그인 후 주문' : ' 주문하기') + '</strong></button>' : "";
}

function updateCart(id, change) {
  const rows = cart();
  const row = rows.find(item => item.id === id);
  if (change === "add") {
    const store = getStore(route.value);
    if (!store?.is_open) return notify("현재 배달 주문을 받지 않는 가게입니다.");
    const item = menusFor(store.id).find(menu => menu.id === id);
    if (!item) return;
    addCartMenu(item, store);
  } else if (change === "remove" || (change === "minus" && row?.quantity === 1)) writeCart(rows.filter(item => item.id !== id));
  else if (row) {
    if (change !== "minus" && row.quantity >= 20) return notify("메뉴당 최대 20개까지 담을 수 있습니다.");
    row.quantity += change === "minus" ? -1 : 1;
    writeCart(rows);
  }
  render();
  if (change === "add") {
    screen.querySelector('[data-act="add"][data-value="' + id + '"]')?.focus({ preventScroll: true });
    notify("장바구니에 담았습니다.");
  }
}

async function checkout() {
  if (!requireLogin()) return;
  const address = activeAddress();
  const before = JSON.stringify(cart());
  await catalog();
  await syncCart();
  if (JSON.stringify(cart()) !== before) {
    render();
    throw new Error("메뉴 구성이나 가격이 변경됐습니다. 확인 후 다시 주문해 주세요.");
  }
  const rows = cart().filter(row => row.selected);
  if (!rows.length) return;
  const idList = [...new Set(rows.map(row => row.store_id))];
  if (idList.length !== 1) throw new Error("한 번에 한 가게의 메뉴만 선택해 주세요.");
  const selected = rows.map(({ id, quantity }) => ({ id, quantity }));
  const payload = { target: idList[0], selections: selected, delivery_address: [addressText(address), address.note].filter(Boolean).join(" / ") };
  const signature = JSON.stringify(payload);
  const attempt = stored("checkout-attempt", {});
  const key = attempt.signature === signature ? attempt.key : crypto.randomUUID();
  write("checkout-attempt", { signature, key });
  await customerData("place", state.account, { ...payload, retry_key: key });
  saveLocal("seoul-demo-store", idList[0]);
  writeCart(cart().filter(item => !rows.some(row => row.id === item.id)));
  write("checkout-attempt", {});
  state.orders = undefined;
  open("orders", undefined, true);
  notify("시연 주문을 접수했습니다.");
}

const actions = {
  back, checkout, refresh: fetchActivity,
  async signout() {
    await customerRequest("logout");
    setAccount(null);
    notifySessionChange();
    open("my", undefined, true);
    notify("로그아웃했습니다.");
  },
  async store(id) {
    await loadMenus(id);
    open("store", id);
  },
  "load-more"() { state.listLimit += 30; render(); },
  async heart(id) {
    if (!requireLogin()) return;
    if (!state.favorites) await loadFavorites();
    const liked = !favorites().includes(id);
    await customerData("customer_favorite", state.account, { target: id, liked });
    state.favorites = liked ? [...favorites(), id] : favorites().filter(value => value !== id);
    render();
    screen.querySelector('[data-act="heart"][data-value="' + CSS.escape(id) + '"]')?.focus({ preventScroll: true });
  },
  "address-select"(id) {
    write("address", id);
    back();
    notify("배달 주소를 변경했습니다.");
  },
  "address-delete"(id) {
    const list = addresses();
    if (!list.some(item => item.id === id) || !window.confirm("등록한 주소를 삭제할까요?")) return;
    const remaining = list.filter(item => item.id !== id);
    write("addresses", remaining);
    if (stored("address", null) === id) write("address", remaining[0]?.id ?? null);
    screen.querySelector("#address-results").innerHTML = addressResults();
    (screen.querySelector(".address-delete") || screen.querySelector("#address-query")).focus({ preventScroll: true });
    notify("주소를 삭제했습니다.");
  },
  location() {
    open("address-map", { locate: true });
  },

};
for (const name of ["add", "plus", "minus", "remove"]) actions[name] = id => updateCart(id, name);

async function run(task, control) {
  if (busy) return;
  busy = true;
  if (control) control.disabled = true;
  try { await task(); }
  catch (error) {
    if (error.code === "login_required") {
      setAccount(null);
      open("signin");
    }
    notify(error.message);
  }
  finally {
    busy = false;
    if (control?.isConnected) control.disabled = false;
  }
}

document.addEventListener("click", event => {
  const control = event.target.closest("[data-act], [data-go]");
  if (!control || busy) return;
  if (control.dataset.go) open(control.dataset.go, undefined, true);
  else {
    const { act, value } = control.dataset;
    if (act in actions) void run(() => actions[act](value), control);
    else if (act in views) open(act, value);
  }
});

screen.addEventListener("input", event => {
  if (event.target.form?.id === "signup-details") {
    const form = event.target.form;
    signup.details = Object.fromEntries(new FormData(form));
    refreshSignupForm(form);
  }
  if (event.target.id === "search-query") {
    state.query = event.target.value;
    state.listLimit = 30;
    state.menuMatches.clear();
    screen.querySelector("#search-results").innerHTML = searchResults();
    clearTimeout(searchTimer);
    const query = state.query.trim();
    const request = ++searchRequest;
    if (query) searchTimer = setTimeout(async () => {
      try {
        const ids = await demo("menu_search", { query });
        if (request !== searchRequest || route.name !== "search") return;
        state.menuMatches = new Set(ids);
        screen.querySelector("#search-results").innerHTML = searchResults();
      } catch (error) {
        if (request === searchRequest && route.name === "search") notify(error.message);
      }
    }, 200);
  }
  if (event.target.id === "address-query") {
    state.addressQuery = event.target.value;
    screen.querySelector("#address-results").innerHTML = addressResults();
  }
});

screen.addEventListener("change", event => {
  const form = event.target.form;
  if (form?.matches(".signup-consent")) {
    const stage = form.id === "signup-final" ? "final" : "entry";
    const all = form.querySelector("[data-agree-all]");
    const items = [...form.querySelectorAll("input[name]")];
    if (event.target === all) items.forEach(item => { item.checked = all.checked; });
    signup[stage] = Object.fromEntries(items.map(item => [item.name, item.checked]));
    all.checked = items.every(item => item.checked);
    all.indeterminate = !all.checked && items.some(item => item.checked);
    form.querySelector('button[type="submit"]').disabled = !all.checked;
    return;
  }
  if (!event.target.matches("[data-select]")) return;
  const id = event.target.dataset.select;
  writeCart(cart().map(item => item.id === id ? { ...item, selected: event.target.checked } : item));
  render();
  screen.querySelector('[data-select="' + id + '"]')?.focus({ preventScroll: true });
});

function saveAddress(fields) {
  const id = crypto.randomUUID();
  write("addresses", [...addresses(), { id, ...fields }]);
  write("address", id);
  back();
  notify("주소를 저장했습니다.");
}

async function signedIn(account, registered = false) {
  setAccount(account, true);
  notifySessionChange();
  if (registered) {
    signup = freshSignup();
    open("my", undefined, true);
  } else back();
  const results = await Promise.allSettled([loadFavorites(), fetchActivity()]);
  render();
  if (results[0].status === "rejected") throw results[0].reason;
  notify(registered ? "가입이 완료되었습니다." : "로그인했습니다.");
}

screen.addEventListener("submit", event => {
  if (["map-address-search", "map-address-save"].includes(event.target.id)) return;
  event.preventDefault();
  void run(async () => {
    const form = event.target;
    const values = Object.fromEntries(new FormData(form));
    if (form.id === "auth-form") {
      await signedIn((await customerRequest("login", values)).account);
      return;
    }
    if (form.id === "signup-entry" && entryTerms.every(([key]) => signup.entry[key])) {
      open("signup-details");
      return;
    }
    if (form.id === "signup-details") {
      const error = signupDetailsError(values);
      if (error) throw new Error(error);
      signup.details = values;
      open("signup-consent");
      return;
    }
    if (form.id === "signup-final" && entryTerms.every(([key]) => signup.entry[key]) && finalTerms.every(([key]) => signup.final[key])) {
      const { name, identifier, password, birth, gender } = signup.details;
      const result = await customerRequest("register", {
        name, identifier, password, agreements: AGREEMENT_VERSION,
        koreanAge: koreanAgeAtSignup(birth), gender: gender || null,
      });
      await signedIn(result.account, true);
      return;
    }
    if (form.id === "address-form") {
      const item = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
      if (item.road.length < 3) throw new Error("도로명 또는 지번 주소를 입력해 주세요.");
      saveAddress(item);
    }
    if (form.id === "review-form") {
      if (!requireLogin()) return;
      await customerData("review", state.account, { order_id: route.value, rating: Number(values.rating), body: values.body.trim() });
      back();
      await fetchActivity();
      notify("리뷰를 등록했습니다.");
    }
  }, event.submitter);
});

reloadOnSessionChange();
const restoredAccount = customerRequest("session").then(({ account }) => {
  setAccount(account);
  return loadFavorites();
}).catch(error => notify(error.message));
try {
  await Promise.all([catalog(), restoredAccount]);
  await syncCart();
  if (entryParams.has("code") || entryParams.has("error_code")) {
    const url = new URL(location.href);
    for (const key of ["code", "error", "error_code", "error_description"]) url.searchParams.delete(key);
    history.replaceState(null, "", url);
    if (state.account) open("my", undefined, true);
    else {
      state.authNote = entryParams.has("error_code") ? "가입 확인 링크를 처리하지 못했어요. 이메일을 다시 확인해 주세요." :
        "가입한 이메일과 비밀번호로 로그인해 주세요.";
      open("signin");
    }
  } else if (fromRecommendation) {
    if (getStore(linkedStore)) await loadMenus(linkedStore);
    route = linkedStore ? { name: "store", value: linkedStore } : { name: "cart" };
    render(true);
    const linkedMenu = entryParams.get("menu");
    if (linkedStore && linkedMenu) screen.querySelector('[data-menu-id="' + CSS.escape(linkedMenu) + '"]')?.scrollIntoView({ block: "center" });
  } else if (getStore(linkedStore)) await actions.store(linkedStore);
  else if (entryParams.get("category") === "chicken") open("category", "chicken");
  else render(true);
} catch (error) {
  render(true);
  notify(error.message);
}
