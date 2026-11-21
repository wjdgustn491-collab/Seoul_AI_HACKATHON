const photon = "https://photon.komoot.io";
const appAgent = "Bappilot/1.0 (https://seoul-ai-hackathon.vercel.app/)";

const joinParts = (...parts) => [...new Set(parts.filter(Boolean))].join(" ");
const point = (lat, lng) => typeof lat === "number" && typeof lng === "number" &&
  lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180;

function address(feature) {
  const [lng, lat] = feature?.geometry?.coordinates || [];
  const p = feature?.properties;
  if (!p || !point(lat, lng) || p.countrycode !== "KR" || p.osm_value === "postcode") return null;
  const street = p.street || (p.type === "street" ? p.name : "");
  const area = (p.city === p.state ? p.district : p.city) || p.district;
  const road = joinParts(p.state || p.city, area, street || p.locality || p.name, p.housenumber);
  if (!road) return null;
  const context = joinParts(p.locality, p.name === street ? "" : p.name, p.postcode);
  return { lat, lng, road, context, exact: !!street && !!p.housenumber };
}

async function lookup(path, query) {
  const url = new URL(path, photon);
  url.search = new URLSearchParams(query);
  const result = await fetch(url, { headers: { "User-Agent": appAgent }, signal: AbortSignal.timeout(4500) });
  if (!result.ok) throw new Error("Geocoder unavailable");
  const data = await result.json();
  return (data.features || []).map(address).filter(Boolean);
}

export default async function addressSearch(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "지원하지 않는 요청입니다." });
  }
  const host = req.headers.host;
  const local = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host);
  if (!host || req.headers.origin !== (local ? "http://" : "https://") + host ||
      !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
    return res.status(403).json({ error: "주소 화면에서 다시 시도해 주세요." });
  }
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "검색 정보를 확인해 주세요." }); }
  try {
    if (body?.action === "search") {
      const q = typeof body.query === "string" ? body.query.trim() : "";
      if (q.length < 3 || q.length > 110) return res.status(400).json({ error: "검색할 주소를 입력해 주세요." });
      const found = await lookup("/api", { q, countrycode: "KR", limit: "6" });
      return res.status(200).json({ addresses: found });
    }
    if (body?.action === "reverse" && point(body.lat, body.lng)) {
      const query = { lat: body.lat.toFixed(5), lon: body.lng.toFixed(5), limit: "5", radius: "0.18" };
      const houses = await lookup("/reverse", { ...query, layer: "house" });
      let match = houses.find(a => a.exact) || houses[0];
      if (!match) match = (await lookup("/reverse", query))[0];
      return res.status(200).json({ address: match ? { ...match, lat: body.lat, lng: body.lng } : null });
    }
    return res.status(400).json({ error: "검색 정보를 확인해 주세요." });
  } catch {
    return res.status(503).json({ error: "주소를 조회하지 못했어요. 잠시 후 다시 시도해 주세요." });
  }
}
