import assert from "node:assert/strict";
import { test } from "node:test";
import { koreanAgeAtSignup, signupDetailsError, validSignupDemographics } from "../dist/signup.js";
import addressSearch from "../api/address.js";

test("signup validates the Korean age boundary and matching passwords", () => {
  const now = new Date("2026-11-20T18:00:00Z");
  const valid = { name: "Tester", phone: "010-0000-0000", birth: "20121121",
    identifier: "tester_1", password: "password123", passwordConfirm: "password123" };
  assert.equal(signupDetailsError(valid, now), "");
  assert.match(signupDetailsError({ ...valid, birth: "20121122" }, now), /14세/);
  assert.match(signupDetailsError({ ...valid, passwordConfirm: "different" }, now), /일치/);
});

test("typed birth dates produce Korean counting age without accepting invalid dates", () => {
  const now = new Date("2026-11-20T18:00:00Z");
  assert.equal(koreanAgeAtSignup("20000101", now), 27);
  assert.equal(koreanAgeAtSignup("19990229", now), null);
  assert.equal(koreanAgeAtSignup("20000229", now), 27);
  assert.equal(validSignupDemographics(27, "female", now), true);
  assert.equal(validSignupDemographics(27, null, now), true);
  assert.equal(validSignupDemographics(27, "3", now), false);
});

test("reverse geocoding returns the chosen map coordinates, not the provider's building center", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    features: [{ geometry: { coordinates: [126.9778, 37.5664] }, properties: {
      countrycode: "KR", city: "서울특별시", street: "세종대로", housenumber: "110",
    } }],
  }));
  const result = {};
  const res = { setHeader() {}, status(code) { result.code = code; return this; },
    json(body) { result.body = body; } };
  await addressSearch({ method: "POST", headers: {
    host: "example.test", origin: "https://example.test", "content-type": "application/json",
  }, body: { action: "reverse", lat: 37.5663, lng: 126.9784 } }, res);
  assert.equal(result.code, 200);
  assert.deepEqual(result.body.address, {
    lat: 37.5663, lng: 126.9784, road: "서울특별시 세종대로 110", context: "", exact: true,
  });
});
