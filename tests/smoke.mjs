// Test de fumée sur les vraies données : ouvre le site et descend France -> département -> commune -> parcelle.
// Usage : node tests/smoke.mjs http://localhost:4173/dataviz-immo/
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:4173/";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` -> ${detail}` : ""}`);
};
const text = (sel) => page.$eval(sel, (el) => (el.hidden ? null : el.textContent.trim())).catch(() => null);
const visible = (sel) => page.$eval(sel, (el) => !el.hidden && !el.closest("[hidden]")).catch(() => false);

async function open(query) {
  await page.goto(`${base}?${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.dvfMap?.loaded() && window.dvfMap.areTilesLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(3000);
}

// CORS de l'API DVF depuis ce site.
await page.goto(base, { waitUntil: "load" });
const cors = await page.evaluate(async () => {
  try {
    const r = await fetch("https://dvf-api.data.gouv.fr/nation");
    return `${r.status} ${JSON.stringify((await r.json()).data?.[0]).slice(0, 120)}`;
  } catch (e) {
    return `ERREUR ${e.message}`;
  }
});
check("API DVF accessible en CORS", !cors.startsWith("ERREUR"), cors);

// 1. France entière.
await open("onglet=carte&filtre=tous");
check("France : nombre de ventes", (await text("#total-sales")) !== "–", await text("#total-sales"));
check("France : prix médian", /€/.test((await text("#median-price")) ?? ""), await text("#median-price"));
check("France : légende EPCI", await visible("#legend"), (await text("#legend"))?.replace(/\s+/g, " "));
check("France : courbe", !(await page.$eval("#line-block", (el) => el.classList.contains("empty"))));
check("France : distribution", !(await page.$eval("#bar-block", (el) => el.classList.contains("empty"))));

// 2. Département (Gironde) puis filtre maisons.
await open("filtre=tous&lat=44.84&lng=-0.58&zoom=9");
check("Département : libellé", /Gironde \(33\)/.test((await text("#location-label")) ?? ""), await text("#location-label"));
check("Département : légende communes", await visible("#legend"), (await text("#legend"))?.replace(/\s+/g, " "));
await page.click("#filters .toggle");
await page.check("input[value=maison]");
await page.waitForTimeout(2000);
check("Filtre maisons : prix médian", /€/.test((await text("#median-price")) ?? ""), await text("#median-price"));

// 3. Commune (Bordeaux).
await open("filtre=tous&lat=44.8378&lng=-0.5792&zoom=12.5");
check("Commune : libellé", /Bordeaux \(33063\)/.test((await text("#location-label")) ?? ""), await text("#location-label"));
check("Commune : légende sections", await visible("#legend"), (await text("#legend"))?.replace(/\s+/g, " "));

// 4. Paris : arrondissement.
await open("filtre=tous&lat=48.8566&lng=2.3522&zoom=12.5");
check("Paris : arrondissement", /\(751\d\d\)/.test((await text("#location-label")) ?? ""), await text("#location-label"));

// 5. Zoom parcellaire puis clic sur une parcelle vendue.
await open("filtre=tous&lat=44.8378&lng=-0.5792&zoom=17");
check("Section : invitation à cliquer", await visible("#section-cta"));
const point = await page.evaluate(() => {
  const map = window.dvfMap;
  const { width, height } = map.getCanvas().getBoundingClientRect();
  for (let y = height * 0.3; y < height * 0.9; y += 15) {
    for (let x = width * 0.2; x < width * 0.9; x += 15) {
      if (map.queryRenderedFeatures([x, y], { layers: ["parcelles_fill"] }).length) return { x, y };
    }
  }
  return null;
});
check("Parcelle vendue visible", !!point, JSON.stringify(point));
if (point) {
  const box = await page.$eval("#map canvas", (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.waitForFunction(() => !document.querySelector("#mutations").hidden && !/Chargement/.test(document.querySelector("#mutations-list").textContent), null, { timeout: 30000 }).catch(() => {});
  check("Parcelle : libellé", /\d{5}\w{5}\d{4}/.test((await text("#location-label")) ?? ""), await text("#location-label"));
  check("Parcelle : mutations", ((await text("#mutations-list")) ?? "").length > 0, (await text("#mutations-list"))?.replace(/\s+/g, " ").slice(0, 200));

  // 5 bis. Raccourci vers l'onglet Prédiction depuis une vente de la parcelle.
  const btn = await page.$(".predict-btn");
  check("Parcelle : bouton Estimer", !!btn);
  if (btn) {
    await btn.click();
    await page.waitForFunction(() => !document.querySelector("#pred-results").hidden, null, { timeout: 60000 }).catch(() => {});
    check("Prédiction : onglet ouvert", await visible("[data-panel=prediction]"), await page.evaluate(() => location.search));
    const kpis = (await text(".pred-kpis"))?.replace(/\s+/g, " ");
    check("Prédiction : estimation", /Prix estimé.*\d €/.test(kpis ?? ""), kpis?.slice(0, 250));
    check("Prédiction : comparables", ((await text(".pred-summary")) ?? "").includes("ventes comparables"), (await text(".pred-summary"))?.replace(/\s+/g, " ").slice(0, 250));
    await page.screenshot({ path: "smoke-prediction.png" });
  }
}

// 5 ter. Onglet Prix et taux.
await page.goto(`${base}?onglet=marche`, { waitUntil: "load" });
await page.waitForFunction(() => document.querySelector("#mk-table tbody tr"), null, { timeout: 30000 }).catch(() => {});
const mk = (await text("#mk-table"))?.replace(/\s+/g, " ");
check("Prix et taux : tableau", /Mensualité/.test(mk ?? ""), mk?.slice(0, 300));
check("Prix et taux : lecture", ((await text("#mk-reading")) ?? "").length > 50, (await text("#mk-reading"))?.replace(/\s+/g, " ").slice(0, 300));
await page.screenshot({ path: "smoke-marche.png" });

// 6. Recherche d'adresse.
await open("filtre=tous");
await page.fill("#search input", "20 avenue de Ségur Paris");
await page.waitForSelector("#search .results li[data-i]", { timeout: 15000 }).catch(() => {});
check("Recherche : suggestions", await visible("#search .results"), (await text("#search .results"))?.slice(0, 80));

await page.screenshot({ path: "smoke.png" });
await browser.close();

const relevant = errors.filter((e) => !/favicon/.test(e));
if (relevant.length) console.log(`\nErreurs navigateur (${relevant.length}) :\n${relevant.slice(0, 30).join("\n")}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications OK`);
process.exit(failed.length ? 1 : 0);
