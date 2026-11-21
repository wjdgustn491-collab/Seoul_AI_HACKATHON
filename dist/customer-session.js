import { browserKey } from "./db.js";

const SESSION_SIGNAL = "bappilot-customer-session-change";

export async function customerRequest(action, fields = {}) {
  const response = await fetch("/api/customer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...fields }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result === null) {
    const error = new Error(result?.error || "주문자 서비스에 연결하지 못했어요.");
    error.code = result?.code;
    throw error;
  }
  return result;
}

export const customerData = (action, account, payload) =>
  customerRequest(action, { account: account.id, browser_key: browserKey(), payload });

export function notifySessionChange() {
  localStorage.setItem(SESSION_SIGNAL, crypto.randomUUID());
}

export function reloadOnSessionChange() {
  addEventListener("storage", event => {
    if (event.key === SESSION_SIGNAL) location.reload();
  });
  // A page restored from browser history can otherwise display the previous account.
  addEventListener("pageshow", event => {
    if (event.persisted) location.reload();
  });
}
