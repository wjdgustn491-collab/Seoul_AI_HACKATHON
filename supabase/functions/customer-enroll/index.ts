const projectUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const publishableKeys = Object.values(JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}"));
const usernamePattern = /^[a-z][a-z0-9_]{3,23}$/;
const agreementVersion = "2026-11-21-demographics";
const seoulYear = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Seoul" });
const response = (status: number, data: object) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return response(405, { code: "method" });
  const publicKey = req.headers.get("apikey");
  if (!publicKey || (publicKey !== anonKey && !publishableKeys.includes(publicKey))) return response(401, { code: "api_key" });
  if (!projectUrl || !serviceKey) return response(503, { code: "unavailable" });

  try {
    const raw = await req.text();
    if (raw.length > 2500) return response(400, { code: "invalid" });
    const input = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)) return response(400, { code: "invalid" });
    const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const password = input.password;
    const { koreanAge, gender } = input;
    if (!usernamePattern.test(username) || !name || name.length > 30 || typeof password !== "string" ||
        password.length < 8 || new TextEncoder().encode(password).length > 72 ||
        !Number.isInteger(koreanAge) || koreanAge < 15 || koreanAge > Number(seoulYear.format()) - 1900 + 1 ||
        (gender !== null && gender !== "male" && gender !== "female") ||
        input.agreements !== agreementVersion) return response(400, { code: "invalid" });

    const headers = {
      apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json",
    };
    const permission = await fetch(projectUrl + "/rest/v1/rpc/bappilot_signup_permit", {
      method: "POST", headers, body: "{}", signal: AbortSignal.timeout(5000),
    });
    if (!permission.ok) return response(503, { code: "unavailable" });
    if (await permission.json() !== true) return response(429, { code: "rate" });

    const result = await fetch(projectUrl + "/auth/v1/admin/users", {
      method: "POST", headers, signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        email: username + "@bappilot.invalid", password, email_confirm: true,
        user_metadata: { name },
        app_metadata: {
          bappilot_agreements: agreementVersion,
          bappilot_agreed_at: new Date().toISOString(),
          bappilot_demographics: { korean_age_at_signup: koreanAge, gender },
        },
      }),
    });
    if (result.ok) return response(201, { created: true });
    const failure = await result.json().catch(() => null);
    if (["email_exists", "user_already_exists"].includes(failure?.error_code)) return response(409, { code: "username_taken" });
    if (failure?.error_code === "weak_password") return response(400, { code: "weak_password" });
    return response(result.status >= 500 ? 503 : 400, { code: "invalid" });
  } catch {
    return response(503, { code: "unavailable" });
  }
});
