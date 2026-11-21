import { supabaseConfig } from "./supabase-config.js";

export const readLocal = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
export const saveLocal = (key, value) => localStorage.setItem(key, JSON.stringify(value));

export function browserKey() {
  const storageKey = "seoul-delivery-demo-key";
  const existing = readLocal(storageKey, null);
  if (existing) return existing;
  const key = crypto.randomUUID();
  saveLocal(storageKey, key);
  return key;
}

export async function demo(action, payload = {}) {
  const response = await fetch(supabaseConfig.url + "/rest/v1/rpc/seoul_delivery_demo", {
    method: "POST",
    headers: { apikey: supabaseConfig.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ action, browser_key: browserKey(), payload })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.code === "P0001" ? data.message : "시연 데이터를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  return data;
}

const numbers = new Intl.NumberFormat("ko-KR");
export const count = value => numbers.format(value);
export const won = value => count(value) + "원";
export const date = value => new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul"
}).format(new Date(value));
export const statusLabels = { pending: "접수 대기", accepted: "조리 중", delivering: "배달 중", completed: "배달 완료", rejected: "주문 거절" };
export const esc = (value = "") => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
