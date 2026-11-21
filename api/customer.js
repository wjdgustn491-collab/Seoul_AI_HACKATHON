import { supabaseConfig } from "../dist/supabase-config.js";
import { AGREEMENT_VERSION, validSignupDemographics } from "../dist/signup.js";

const ACCESS = "__Host-bappilot-access";
const REFRESH = "__Host-bappilot-refresh";
const REFRESH_AGE = 30 * 24 * 60 * 60;
const ACCOUNT_DOMAIN = "@bappilot.invalid";
const USERNAME = /^[a-z][a-z0-9_]{3,23}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RPC_ACTIONS = new Set(["customer_orders", "customer_favorites", "customer_favorite", "place", "review"]);

function cookie(name, value, age) {
  return name + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + age;
}

function clearSession(res) {
  res.setHeader("Set-Cookie", [cookie(ACCESS, "", 0), cookie(REFRESH, "", 0)]);
}

function setSession(res, data) {
  if (!data?.access_token || !data.refresh_token) throw new Error("Missing session");
  res.setHeader("Set-Cookie", [
    cookie(ACCESS, data.access_token, Number(data.expires_in) || 3600),
    cookie(REFRESH, data.refresh_token, REFRESH_AGE),
  ]);
}

function readSession(req) {
  const cookies = new Map(String(req.headers.cookie || "").split(";").map(part => {
    const item = part.trim();
    const eq = item.indexOf("=");
    return [item.slice(0, eq), item.slice(eq + 1)];
  }));
  return { access: cookies.get(ACCESS), refresh: cookies.get(REFRESH) };
}

function originAllowed(req) {
  const host = req.headers.host;
  if (!host) return false;
  return req.headers.origin === "https://" + host ||
    (/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host) && req.headers.origin === "http://" + host);
}

async function supabase(path, method, body, token) {
  const headers = { apikey: supabaseConfig.publishableKey, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(supabaseConfig.url + path, {
    method, headers, body: body == null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
}

const auth = (path, method, body, token) => supabase("/auth/v1/" + path, method, body, token);
const isExpired = reply => reply.status === 401 || reply.status === 403;
const error = (res, status, message, code) => res.status(status).json({ error: message, code });

function profile(user) {
  if (!user?.id || !user.email) throw new Error("Missing account profile");
  const identifier = user.email.endsWith(ACCOUNT_DOMAIN) ? user.email.slice(0, -ACCOUNT_DOMAIN.length) : user.email;
  const name = user.user_metadata?.name;
  return { id: user.id, identifier, name: typeof name === "string" && name.trim() ? name.trim().slice(0, 30) : identifier.split("@")[0] };
}

async function callWithSession(req, res, operation) {
  const session = readSession(req);
  if (session.access) {
    const first = await operation(session.access);
    if (!isExpired(first) || first.data?.code === "42501") return first;
  }
  if (!session.refresh) return { ok: false, status: 401 };
  const renewed = await auth("token?grant_type=refresh_token", "POST", { refresh_token: session.refresh });
  if (!renewed.ok) {
    if (renewed.status >= 500 || renewed.status === 429) throw new Error("Auth refresh temporarily unavailable");
    clearSession(res);
    return { ok: false, status: 401 };
  }
  setSession(res, renewed.data);
  return operation(renewed.data.access_token);
}

function authError(res, reply) {
  const code = reply.data?.error_code;
  if (reply.status === 429) return error(res, 429, "요청이 많아요. 잠시 후 다시 시도해 주세요.");
  if (reply.status >= 500) return error(res, 503, "로그인 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (code === "email_not_confirmed") return error(res, 400, "가입 확인 이메일의 링크를 연 뒤 로그인해 주세요.");
  return error(res, 400, "아이디 또는 비밀번호를 확인해 주세요.");
}

async function signIn(res, credentials, registering) {
  const value = credentials.identifier ?? credentials.email;
  const identifier = typeof value === "string" ? value.trim().toLowerCase() : "";
  const password = credentials.password;
  const username = USERNAME.test(identifier);
  if ((!username && (registering || identifier.length > 254 || !EMAIL.test(identifier))) ||
      typeof password !== "string" || !password || Buffer.byteLength(password) > 72) {
    return error(res, 400, "아이디와 비밀번호를 확인해 주세요.");
  }
  if (registering) {
    const name = typeof credentials.name === "string" ? credentials.name.trim() : "";
    const { koreanAge, gender } = credentials;
    if (!name || name.length > 30 || password.length < 8 || credentials.agreements !== AGREEMENT_VERSION ||
        !validSignupDemographics(koreanAge, gender)) {
      return error(res, 400, "가입 정보와 필수 동의를 확인해 주세요.");
    }
    const enrollment = await supabase("/functions/v1/customer-enroll", "POST", {
      username: identifier, name, password, agreements: AGREEMENT_VERSION, koreanAge, gender,
    });
    if (!enrollment.ok) {
      if (enrollment.status === 409) return error(res, 409, "이미 사용 중인 아이디입니다.", "username_taken");
      if (enrollment.status === 429) return error(res, 429, "가입 요청이 많아요. 잠시 후 다시 시도해 주세요.");
      if (enrollment.status >= 500 || enrollment.status === 401) return error(res, 503, "가입 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return error(res, 400, "가입 정보를 확인해 주세요. 비밀번호는 8자 이상이어야 합니다.");
    }
  }
  const email = username ? identifier + ACCOUNT_DOMAIN : identifier;
  const result = await auth("token?grant_type=password", "POST", { email, password });
  if (!result.ok) return authError(res, result);
  const account = profile(result.data?.user);
  setSession(res, result.data);
  return res.status(200).json({ account });
}

export default async function customer(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return error(res, 405, "지원하지 않는 요청입니다.");
  }
  if (!originAllowed(req) || !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
    return error(res, 403, "주문자 화면에서 다시 시도해 주세요.");
  }
  let request;
  try {
    if (typeof req.body === "string" && req.body.length > 12000) throw new Error("Request too large");
    request = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!request || typeof request !== "object" || JSON.stringify(request).length > 12000) throw new Error("Invalid request");
  } catch {
    return error(res, 400, "요청 정보를 확인해 주세요.");
  }
  const { action, account, browser_key, payload = {} } = request;
  try {
    if (action === "login" || action === "register") return await signIn(res, request, action === "register");
    if (action === "logout") {
      try {
        await callWithSession(req, res, token => auth("logout?scope=local", "POST", null, token));
      } catch { /* The browser can still end its local session if Auth is unavailable. */ }
      clearSession(res);
      return res.status(200).json({ account: null });
    }
    if (action === "session") {
      const result = await callWithSession(req, res, token => auth("user", "GET", null, token));
      if (isExpired(result)) return res.status(200).json({ account: null });
      if (!result.ok) throw new Error("Could not load account");
      return res.status(200).json({ account: profile(result.data) });
    }
    if (!RPC_ACTIONS.has(action) || typeof account !== "string" || !UUID.test(account) ||
        typeof browser_key !== "string" || !UUID.test(browser_key) ||
        !payload || typeof payload !== "object" || Array.isArray(payload)) {
      return error(res, 400, "주문자 요청 정보를 확인해 주세요.");
    }
    const result = await callWithSession(req, res, token => supabase("/rest/v1/rpc/seoul_delivery_demo", "POST", {
      action, browser_key, payload: { ...payload, expected_customer: account },
    }, token));
    if (isExpired(result)) return error(res, 401, "다시 로그인한 뒤 시도해 주세요.", "login_required");
    if (!result.ok) {
      const message = result.data?.code === "P0001" ? result.data.message : "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
      return error(res, result.status >= 500 ? 503 : 400, message);
    }
    return res.status(200).json(result.data);
  } catch {
    return error(res, 503, "주문자 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
}
