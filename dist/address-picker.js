import { esc } from "./db.js";

const initialCenter = [37.5665, 126.9780];
const leafletVersion = "https://unpkg.com/leaflet@1.9.4/dist/";
let loadingMap;

function loadMap() {
  if (window.L) return Promise.resolve(window.L);
  loadingMap ??= new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = leafletVersion + "leaflet.css";
    css.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
    css.crossOrigin = "anonymous";
    const script = document.createElement("script");
    script.src = leafletVersion + "leaflet.js";
    script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
    script.crossOrigin = "anonymous";
    script.onload = () => resolve(window.L);
    script.onerror = css.onerror = () => {
      script.remove();
      css.remove();
      loadingMap = undefined;
      reject(new Error("지도를 불러오지 못했어요. 직접 주소를 등록할 수 있어요."));
    };
    document.head.append(css, script);
  });
  return loadingMap;
}

function currentCoordinates() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) {
      reject(new Error("이 환경에서는 위치를 확인할 수 없어요. 주소를 검색해 주세요."));
      return;
    }
    navigator.geolocation.getCurrentPosition(({ coords }) => resolve([coords.latitude, coords.longitude]), error => {
      const text = error.code === 1 ? "브라우저의 위치 권한을 허용하거나 주소를 검색해 주세요." :
        "현재 위치를 가져오지 못했어요. 다시 시도하거나 주소를 검색해 주세요.";
      reject(new Error(text));
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 30000 });
  });
}

async function geocode(payload, signal) {
  const result = await fetch("/api/address", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal,
  });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || "주소를 불러오지 못했어요.");
  return data;
}

export function mountAddressPicker(root, options, onSave) {
  const road = root.querySelector("#map-road");
  const search = root.querySelector("#map-address-search");
  const matches = root.querySelector("#map-address-matches");
  const save = root.querySelector("#map-address-save");
  const submit = save.querySelector('button[type="submit"]');
  const status = root.querySelector("#map-address-status");
  const locateControls = root.querySelectorAll(".map-locate");
  let map, selected, pending, timer, results = [], active = true, moving = false, revision = 0;

  function cancel() {
    clearTimeout(timer);
    pending?.abort();
    revision += 1;
    return revision;
  }

  function setAddress(address) {
    selected = address;
    road.value = address.road;
    status.textContent = address.context ?
      (address.exact ? "" : "근처 위치 · ") + address.context :
      (address.exact ? "표시된 주소를 확인해 주세요." : "근처 주소입니다. 검색이나 지도 이동으로 조정할 수 있어요.");
    submit.disabled = false;
    matches.replaceChildren();
  }

  function invalidate(clearAddress = false) {
    const version = cancel();
    selected = null;
    if (clearAddress) road.value = "";
    submit.disabled = true;
    matches.replaceChildren();
    return version;
  }

  async function reverse([lat, lng], version) {
    pending = new AbortController();
    status.textContent = "선택한 위치의 주소를 찾는 중…";
    try {
      const data = await geocode({ action: "reverse", lat, lng }, pending.signal);
      if (!active || version !== revision) return;
      if (data.address) setAddress(data.address);
      else status.textContent = "이 위치의 주소를 찾지 못했어요. 지도를 옮기거나 주소를 검색해 주세요.";
    } catch (error) {
      if (active && version === revision && error.name !== "AbortError") status.textContent = error.message;
    }
  }

  const mapReady = loadMap().then(L => {
    if (!active) return;
    map = L.map(root.querySelector(".address-map"), { zoomControl: true }).setView(initialCenter, 16);
    map.zoomControl.setPosition("topright");
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    map.on("dragstart", () => { invalidate(); status.textContent = "지도를 움직이는 중…"; });
    map.on("moveend", () => {
      if (moving) return;
      const center = map.getCenter();
      const version = invalidate();
      timer = setTimeout(() => void reverse([center.lat, center.lng], version), 550);
    });
  }).catch(error => { if (active) status.textContent = error.message; });

  function centerMap(coords) {
    moving = true;
    map?.setView(coords, 17, { animate: false });
    moving = false;
  }

  async function locateUser() {
    const version = invalidate();
    locateControls.forEach(control => { control.disabled = true; });
    status.textContent = "현재 위치를 확인하는 중…";
    try {
      const coords = await currentCoordinates();
      await mapReady;
      if (!active || version !== revision) return;
      centerMap(coords);
      await reverse(coords, version);
    } catch (error) {
      if (active && version === revision) status.textContent = error.message;
    } finally {
      if (active) locateControls.forEach(control => { control.disabled = false; });
    }
  }

  locateControls.forEach(control => control.addEventListener("click", locateUser));
  road.addEventListener("input", () => {
    invalidate();
    status.textContent = "검색을 눌러 입력한 주소의 위치를 확인해 주세요.";
  });
  search.addEventListener("submit", async event => {
    event.preventDefault();
    const query = road.value.trim();
    const version = invalidate();
    pending = new AbortController();
    status.textContent = "입력한 주소를 검색하는 중…";
    try {
      const data = await geocode({ action: "search", query }, pending.signal);
      if (!active || version !== revision) return;
      results = data.addresses;
      if (!results.length) {
        status.textContent = "검색 결과가 없어요. 도로명과 건물 번호를 확인해 주세요.";
      } else if (results.length === 1) {
        await mapReady;
        if (!active || version !== revision) return;
        centerMap([results[0].lat, results[0].lng]);
        setAddress(results[0]);
      } else {
        status.textContent = "지도에 표시할 주소를 선택해 주세요.";
        matches.innerHTML = results.map((item, i) => '<button type="button" class="map-match" data-match="' + i + '">' +
          esc(item.road) + (item.context ? '<small>' + esc(item.context) + '</small>' : "") + '</button>').join("");
      }
    } catch (error) {
      if (active && version === revision && error.name !== "AbortError") status.textContent = error.message;
    }
  });
  matches.addEventListener("click", async event => {
    const item = results[event.target.closest("[data-match]")?.dataset.match];
    if (!item) return;
    const version = cancel();
    await mapReady;
    if (!active || version !== revision) return;
    centerMap([item.lat, item.lng]);
    setAddress(item);
  });
  save.addEventListener("submit", event => {
    event.preventDefault();
    if (!selected) return;
    onSave({ label: "", road: selected.road, detail: save.elements.detail.value.trim(), note: "",
      lat: selected.lat, lng: selected.lng });
  });
  if (options?.locate) void locateUser();
  return () => { active = false; cancel(); map?.remove(); };
}
