// Onglet « Prédiction » : estimation du prix actuel d'un bien à partir d'une vente passée
// et des ventes comparables du voisinage.
import { Chart, ScatterController, PointElement, LinearScale, Tooltip } from "chart.js";
import { api } from "./api.js";
import { depOf } from "./state.js";
import {
  PROPERTY_TYPES, singlePropertySales, describeMutation, buildPriceIndex, estimate, haversine,
} from "./estimation.js";

Chart.register(ScatterController, PointElement, LinearScale, Tooltip);

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => (v == null || !Number.isFinite(v) ? "–" : Math.round(v).toLocaleString("fr-FR"));
const roundPrice = (v) => Math.round(v / 1000) * 1000;
const fmtDate = (d) => new Date(d).toLocaleDateString("fr-FR", { year: "numeric", month: "short", day: "numeric" });
const fmtMonth = (m) => new Date(`${m}-01`).toLocaleDateString("fr-FR", { year: "numeric", month: "long" });
const shortType = (t) => (t?.startsWith("Local") ? "Local" : t);
const PARCEL_ID = /^\d{8}(\d|[A-Z])[A-Z]\d{4}$/;

// Anneaux de recherche : on élargit tant qu'il n'y a pas assez de comparables.
const RINGS = [
  { radius: 500, maxSections: 8 },
  { radius: 1200, maxSections: 16 },
  { radius: 2500, maxSections: 28 },
];
const MIN_COMPARABLES = 12;

function centroid(feature) {
  let x = 0, y = 0, n = 0;
  const walk = (c) => (typeof c[0] === "number" ? (x += c[0], y += c[1], n++) : c.forEach(walk));
  walk(feature.geometry.coordinates);
  return n ? [x / n, y / n] : null;
}

export function createPrediction(root, { onShowOnMap, onChange }) {
  const $ = (sel) => root.querySelector(sel);
  let ctx = null; // { parcelle, coords, rows, mutationId }
  let runToken = 0;
  let chart = null;

  // ---------------------------------------------------------- recherche du bien
  const searchForm = $("#pred-search");
  const searchInput = searchForm.querySelector("input");
  const searchList = searchForm.querySelector(".results");
  let results = [];
  let timer = null;

  async function search() {
    const q = searchInput.value.trim();
    if (q.length < 3) return (searchList.hidden = true);
    const upper = q.toUpperCase().replace(/\s+/g, "");
    try {
      if (PARCEL_ID.test(upper)) {
        const data = await api.searchParcel(upper);
        results = data.features.map((f) => ({ label: `Parcelle ${f.properties.id}`, coords: f.geometry.coordinates, parcelle: f.properties.id }));
      } else {
        const data = await api.searchAddress(q);
        results = data.features.map((f) => ({ label: f.properties.label, coords: f.geometry.coordinates }));
      }
    } catch {
      results = [];
    }
    searchList.innerHTML = results.length
      ? results.map((r, i) => `<li data-i="${i}">${esc(r.label)}</li>`).join("")
      : `<li class="muted">Aucun résultat</li>`;
    searchList.hidden = false;
  }

  async function chooseResult(r) {
    searchList.hidden = true;
    searchInput.value = r.label;
    let parcelle = r.parcelle;
    if (!parcelle) {
      try {
        const data = await api.reverseParcel(r.coords);
        parcelle = data.features?.[0]?.properties?.id;
      } catch {
        parcelle = null;
      }
    }
    if (!parcelle) {
      $("#pred-parcel").innerHTML = `<p class="notice">Impossible de trouver la parcelle cadastrale de cette adresse.</p>`;
      return;
    }
    open(parcelle, null, r.coords);
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(search, 350);
  });
  searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!results.length) await search();
    if (results[0]) chooseResult(results[0]);
  });
  searchList.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) chooseResult(results[Number(li.dataset.i)]);
  });
  searchInput.addEventListener("blur", () => setTimeout(() => (searchList.hidden = true), 150));

  // ---------------------------------------------------------- parcelle et vente de référence
  async function open(parcelle, mutationId = null, coords = null) {
    const token = ++runToken;
    ctx = { parcelle, coords, rows: [], mutationId };
    $("#pred-results").hidden = true;
    $("#pred-form").hidden = true;
    $("#pred-parcel").innerHTML = `<p class="muted">Chargement des ventes de la parcelle ${esc(parcelle)}…</p>`;
    onChange?.();
    let rows = [];
    try {
      rows = await api.mutations(parcelle);
    } catch {
      if (token === runToken) $("#pred-parcel").innerHTML = `<p class="notice">Impossible de récupérer les ventes de cette parcelle.</p>`;
      return;
    }
    if (token !== runToken) return;
    ctx.rows = rows;
    const ids = [...new Set(rows.filter((r) => r.id_parcelle === parcelle).map((r) => r.id_mutation))];
    const mutations = ids.map((id) => describeMutation(rows, id)).filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!ctx.coords) ctx.coords = mutations.find((m) => m.coords)?.coords ?? null;
    if (!mutationId || !mutations.some((m) => m.id === mutationId)) {
      mutationId = mutations.find((m) => m.type)?.id ?? null;
    }

    $("#pred-parcel").innerHTML = `
      <h3>Parcelle ${esc(parcelle)} <button type="button" class="link-btn" data-show-map>voir sur la carte</button></h3>
      ${mutations.length ? `<p class="muted">Choisissez la vente de référence :</p>` : `<p class="muted">Aucune vente enregistrée sur cette parcelle : décrivez le bien ci-dessous.</p>`}
      <div class="pred-mutations">
        ${mutations.map((m) => `
          <label class="pred-mutation">
            <input type="radio" name="pred-mutation" value="${esc(m.id)}" ${m.id === mutationId ? "checked" : ""} ${m.type ? "" : "disabled"} />
            <span>
              <b>${m.price ? `${num(m.price)} €` : "Prix non renseigné"}</b> · ${esc(fmtDate(m.date))}<br />
              ${m.type ? `${esc(shortType(m.type))}${m.rooms ? ` ${m.rooms} p.` : ""}${m.surface ? ` · ${num(m.surface)} m²` : ""}` : "Pas de logement ni de local"}
              ${m.propertyCount > 1 ? ` · vente de ${m.propertyCount} biens` : ""}
              ${m.address ? `<br /><span class="muted">${esc(m.address)}</span>` : ""}
            </span>
          </label>`).join("")}
        <label class="pred-mutation">
          <input type="radio" name="pred-mutation" value="" ${mutationId ? "" : "checked"} />
          <span>Autre bien sur cette parcelle (saisie libre)</span>
        </label>
      </div>`;
    $("#pred-parcel [data-show-map]").addEventListener("click", () => onShowOnMap(parcelle, ctx.coords));
    $("#pred-parcel").querySelectorAll("input[name=pred-mutation]").forEach((input) =>
      input.addEventListener("change", () => selectMutation(input.value || null)),
    );
    selectMutation(mutationId);
  }

  function selectMutation(mutationId) {
    ctx.mutationId = mutationId;
    const m = mutationId ? describeMutation(ctx.rows, mutationId) : null;
    ctx.reference = m;
    $("#pred-type").value = m?.type && PROPERTY_TYPES[m.type] ? m.type : $("#pred-type").value || "Appartement";
    $("#pred-surface").value = m?.surface ?? "";
    $("#pred-rooms").value = m?.rooms ?? "";
    $("#pred-form").hidden = false;
    onChange?.();
    if (m?.surface) run();
    else $("#pred-results").hidden = true;
  }

  $("#pred-form").addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });

  // ---------------------------------------------------------- calcul
  async function loadIndex(com, priceKey) {
    const attempts = [
      ["commune", com, "la commune"],
      ["departement", depOf(com), "le département"],
      ["fra", "nation", "la France"],
    ];
    for (const [level, code, label] of attempts) {
      try {
        const index = buildPriceIndex(await api.monthly(level, code), priceKey);
        if (index) return { index, label };
      } catch {
        /* niveau suivant */
      }
    }
    return { index: null, label: null };
  }

  async function run() {
    const subject = {
      type: $("#pred-type").value,
      surface: Number($("#pred-surface").value),
      rooms: Number($("#pred-rooms").value) || null,
      coords: ctx.coords,
      excludeMutation: ctx.mutationId,
    };
    if (!(subject.surface > 0)) return;
    const token = ++runToken;
    const status = $("#pred-status");
    status.hidden = false;
    status.textContent = "Recherche des ventes comparables…";
    $("#pred-results").hidden = true;

    const com = ctx.parcelle.substring(0, 5);
    const ownSection = ctx.parcelle.substring(0, 10);

    // Sections cadastrales triées par distance au bien.
    let sections = [{ id: ownSection, distance: 0 }];
    try {
      const geo = await api.sectionsGeometry(com);
      const origin = subject.coords ?? centroid(geo.features.find((f) => f.properties.id === ownSection) ?? geo.features[0]);
      if (!subject.coords) subject.coords = origin;
      sections = geo.features
        .map((f) => ({ id: f.properties.id, distance: f.properties.id === ownSection ? 0 : haversine(origin, centroid(f)) }))
        .sort((a, b) => a.distance - b.distance);
    } catch {
      /* sans géométrie : uniquement la section du bien */
    }

    const priceKey = PROPERTY_TYPES[subject.type].priceKey;
    const indexPromise = loadIndex(com, priceKey);
    const fetched = new Map();
    let result = null;
    let radiusUsed = 0;
    for (const ring of RINGS) {
      const wanted = sections.filter((s) => s.distance <= ring.radius).slice(0, ring.maxSections);
      if (!wanted.length) wanted.push(sections[0]);
      await Promise.all(wanted.filter((s) => !fetched.has(s.id)).map(async (s) => {
        fetched.set(s.id, await api.sectionMutations(s.id).catch(() => []));
      }));
      if (token !== runToken) return;
      status.textContent = `Analyse de ${fetched.size} section${fetched.size > 1 ? "s" : ""} cadastrale${fetched.size > 1 ? "s" : ""}…`;
      const sales = singlePropertySales([...fetched.values()].flat());
      const { index, label } = await indexPromise;
      result = estimate(subject, sales, index);
      result.indexLabel = label;
      result.index = index;
      radiusUsed = ring.radius;
      if (result.comps.length >= MIN_COMPARABLES || wanted.length >= sections.length) break;
    }
    if (token !== runToken) return;
    status.hidden = true;
    render(subject, result, radiusUsed, fetched.size);
  }

  // ---------------------------------------------------------- rendu
  function render(subject, result, radius, sectionCount) {
    const el = $("#pred-results");
    el.hidden = false;
    const ref = ctx.reference;
    const index = result.index;

    // Revalorisation de la vente d'origine avec l'indice du territoire.
    let revalued = "";
    if (ref?.price && ref.type === subject.type && ref.surface === subject.surface && ref.propertyCount === 1 && index) {
      const factor = index.factor(ref.date);
      revalued = `
        <div class="pred-kpi">
          <span class="kpi-title">Vente d'origine actualisée</span>
          <span class="kpi-value">${num(roundPrice(ref.price * factor))} €</span>
          <span class="muted">${num(ref.price)} € en ${esc(fmtMonth(ref.date.slice(0, 7)))}, ${factor >= 1 ? "+" : ""}${((factor - 1) * 100).toFixed(1).replace(".", ",")} % d'évolution des prix dans ${esc(result.indexLabel)}</span>
        </div>`;
    }

    if (!result.ok) {
      el.innerHTML = `<p class="notice">${esc(result.reason)} Essayez une autre surface ou un autre type de bien.</p>${revalued ? `<div class="pred-kpis">${revalued}</div>` : ""}`;
      return;
    }

    el.innerHTML = `
      <div class="pred-kpis">
        <div class="pred-kpi main">
          <span class="kpi-title">Prix estimé ${result.referenceMonth ? `(${esc(fmtMonth(result.referenceMonth))})` : "aujourd'hui"}</span>
          <span class="kpi-value">${num(roundPrice(result.value))} €</span>
          <span class="muted">Fourchette : ${num(roundPrice(result.low))} € – ${num(roundPrice(result.high))} €</span>
        </div>
        <div class="pred-kpi">
          <span class="kpi-title">Prix au m² estimé</span>
          <span class="kpi-value">${num(result.perM2)} €</span>
          <span class="muted">${num(result.lowPerM2)} € – ${num(result.highPerM2)} € · fiabilité ${esc(result.confidence)}</span>
        </div>
        ${revalued}
      </div>
      <p class="muted pred-summary">
        ${shortType(subject.type)} de ${num(subject.surface)} m²${subject.rooms ? `, ${subject.rooms} pièce${subject.rooms > 1 ? "s" : ""}` : ""} ·
        ${result.comps.length} ventes comparables retenues dans ${sectionCount} section${sectionCount > 1 ? "s" : ""} cadastrale${sectionCount > 1 ? "s" : ""} (rayon ≈ ${num(radius)} m),
        surfaces entre ${num(subject.surface * result.windowUsed[0])} et ${num(subject.surface * result.windowUsed[1])} m² ·
        ${index ? `prix actualisés avec l'évolution mensuelle du prix médian au m² dans ${esc(result.indexLabel)}` : "prix non actualisés (pas assez de données d'évolution)"}.
      </p>
      <div class="pred-chart"><canvas></canvas></div>
      <table class="pred-table">
        <thead><tr><th>Date</th><th>Adresse</th><th>Bien</th><th>Surface</th><th>Prix</th><th>€/m² vente</th><th>€/m² actualisé</th><th>Distance</th><th>Poids</th></tr></thead>
        <tbody>
          ${result.comps.slice(0, 40).map((c) => {
            const maxW = result.comps[0].weight || 1;
            return `<tr data-parcelle="${esc(c.parcelle)}" title="Voir la parcelle ${esc(c.parcelle)} sur la carte">
              <td>${esc(fmtDate(c.date))}</td>
              <td>${esc(c.address ?? c.parcelle)}</td>
              <td>${esc(shortType(c.type))}${c.rooms ? ` ${c.rooms} p.` : ""}</td>
              <td>${num(c.surface)} m²</td>
              <td>${num(c.price)} €</td>
              <td>${num(c.pricePerM2)}</td>
              <td><b>${num(c.adjustedPerM2)}</b></td>
              <td>${c.distance == null ? "–" : `${num(c.distance)} m`}</td>
              <td><span class="weight" style="width:${Math.max(4, Math.round((c.weight / maxW) * 48))}px"></span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      ${result.comps.length > 40 ? `<p class="muted">Les 40 ventes les plus proches du bien sont affichées sur ${result.comps.length}.</p>` : ""}`;

    el.querySelectorAll("tr[data-parcelle]").forEach((tr) =>
      tr.addEventListener("click", () => {
        const c = result.comps.find((x) => x.parcelle === tr.dataset.parcelle);
        onShowOnMap(tr.dataset.parcelle, c?.coords);
      }),
    );
    drawChart(el.querySelector("canvas"), result, subject);
  }

  function drawChart(canvas, result, subject) {
    chart?.destroy();
    const toX = (d) => new Date(d).getTime();
    const points = result.comps.map((c) => ({ x: toX(c.date), y: Math.round(c.adjustedPerM2), raw: c }));
    const datasets = [
      { label: "Ventes comparables (€/m² actualisé)", data: points, backgroundColor: "rgba(74,157,247,0.55)", pointRadius: (c) => 3 + 6 * ((c.raw?.raw?.weight ?? 0) / (result.comps[0].weight || 1)) },
      { label: "Estimation", data: [{ x: Date.now(), y: Math.round(result.perM2) }], backgroundColor: "#000091", pointRadius: 8, pointStyle: "rectRot" },
    ];
    const ref = ctx.reference;
    if (ref?.price && ref.surface && ref.type === subject.type && ref.propertyCount === 1) {
      datasets.push({ label: "Vente d'origine (€/m² non actualisé)", data: [{ x: toX(ref.date), y: Math.round(ref.price / ref.surface) }], backgroundColor: "#e1000f", pointRadius: 7, pointStyle: "triangle" });
    }
    chart = new Chart(canvas, {
      type: "scatter",
      data: { datasets },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: (i) => {
              const c = i.raw.raw;
              return c ? `${fmtDate(c.date)} · ${num(c.surface)} m² · ${num(c.price)} € → ${num(c.adjustedPerM2)} €/m² actualisé`
                : `${i.dataset.label} : ${num(i.raw.y)} €/m²`;
            },
          } },
        },
        scales: {
          x: { type: "linear", ticks: { maxTicksLimit: 6, callback: (v) => new Date(v).toLocaleDateString("fr-FR", { year: "numeric", month: "short" }) }, grid: { display: false } },
          y: { ticks: { callback: (v) => `${num(v)} €` }, grid: { color: "#eee" } },
        },
      },
    });
  }

  return {
    open,
    get current() {
      return ctx ? { parcelle: ctx.parcelle, mutation: ctx.mutationId } : null;
    },
  };
}
