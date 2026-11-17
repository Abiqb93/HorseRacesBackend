#!/usr/bin/env node
/**
 * Fill every mare's missing picture and empty description from the team's
 * Matings App, through the backend's own routes, for the users named.
 *
 *   MATINGS_APP_USER=… MATINGS_APP_PASSWORD=… node scripts/matingsAppImport.mjs richardbrown1 TomWilson
 *
 * API_BASE picks the backend (production by default). A description or a
 * picture a mare already has is never replaced. One page read every 1.5 s.
 */
import { createMatingsAppClient, importFromApp } from "../breeding/matingsApp.mjs";

const API = process.env.API_BASE || "https://horseracesbackend-production.up.railway.app";
const users = process.argv.slice(2);
if (!users.length) {
  console.error("name the users: node scripts/matingsAppImport.mjs richardbrown1 TomWilson");
  process.exit(2);
}
const call = async (url, init) => {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status} for ${url}`);
  return body;
};
const client = createMatingsAppClient({ user: process.env.MATINGS_APP_USER, password: process.env.MATINGS_APP_PASSWORD });

for (const user of users) {
  const u = encodeURIComponent(user);
  const { mares = [] } = await call(`${API}/api/mares/${u}`);
  const photos = (await call(`${API}/api/mares/${u}/photos`)).photos ?? {};
  const report = await importFromApp({
    mares,
    photoAt: new Map(Object.entries(photos).map(([k, v]) => [Number(k), v])),
    client,
    savePhysical: (m, text) =>
      call(`${API}/api/mares/${u}/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ physical: text }) }),
    savePhoto: (m, img) =>
      call(`${API}/api/mares/${u}/${m.id}/photo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: `data:${String(img.type).split(";")[0]};base64,${img.body.toString("base64")}` }),
      }),
  });
  const n = (k, v) => report.filter((r) => r[k] === v).length;
  console.log(`${user}: ${mares.length} mares, ${report.filter((r) => r.found).length} in the Matings App; descriptions filled ${n("description", "filled")}, pictures filled ${n("photo", "filled")}`);
  for (const r of report.filter((x) => x.error)) console.log(`  ${r.name}: ${r.error}`);
  const missing = report.filter((r) => !r.found).map((r) => r.name);
  if (missing.length) console.log(`  not in the app: ${missing.join(", ")}`);
}
