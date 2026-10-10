import "./styles.css";
import { createMap } from "./map.js";
import { createSidebar } from "./sidebar.js";
import { createSearch } from "./search.js";
import { createPrediction } from "./prediction.js";
import { createMarche } from "./marche.js";
import { FILTERS, state, setState, subscribe } from "./state.js";
import previewOrtho from "./img/preview-ortho.png";
import previewVector from "./img/preview-vector.png";

const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------ URL
// Paramètres compatibles avec l'original : ?onglet=carte&filtre=tous, plus la vue de la carte.
const params = new URLSearchParams(location.search);
if (FILTERS[params.get("filtre")]) state.filter = params.get("filtre");
const lat = parseFloat(params.get("lat"));
const lng = parseFloat(params.get("lng"));
const zoom = parseFloat(params.get("zoom"));
const initialView = Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(zoom)
  ? { center: [lng, lat], zoom, parcelle: params.get("parcelle") || null }
  : null;

// ------------------------------------------------------------ onglets
function showTab(tab) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
  if (tab === "carte") mapApi.map.resize();
  if (tab === "marche") marche.show();
  syncUrl();
}
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

// ------------------------------------------------------------ info-bulle
const tooltipEl = $("#map-tooltip");
const tooltip = {
  show(point, { label, loading, price, count, noData, error }) {
    let body;
    if (loading) body = "";
    else if (error) body = "Données indisponibles";
    else if (noData) body = "Pas de données disponibles<br><b>Alsace-Moselle : voir la FAQ</b>";
    else if (price == null) body = `${count ? `<b>${count.toLocaleString("fr-FR")}</b> mutation${count > 1 ? "s" : ""}<br>` : ""}Pas assez de données pour faire une visualisation`;
    else body = `<b>${Math.round(price).toLocaleString("fr-FR")} €</b> par m²<br><b>${(count ?? 0).toLocaleString("fr-FR")}</b> mutation${count > 1 ? "s" : ""}`;
    tooltipEl.innerHTML = `<b>${label ? escapeHtml(label) : "En cours de récupération"}</b>${body ? `<div>${body}</div>` : ""}`;
    tooltipEl.style.transform = `translate(${point.x + 12}px, ${point.y + 12}px)`;
    tooltipEl.hidden = false;
  },
  hide() {
    tooltipEl.hidden = true;
  },
};
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ------------------------------------------------------------ légende
function onLegend(legend) {
  const el = $("#legend");
  el.hidden = !legend;
  if (!legend) return;
  $("#leg-min").textContent = `< ${legend.min.toLocaleString("fr-FR")} €`;
  $("#leg-pivot").textContent = `${legend.pivot.toLocaleString("fr-FR")} €`;
  $("#leg-max").textContent = `> ${legend.max.toLocaleString("fr-FR")} €`;
}

// ------------------------------------------------------------ carte
const mapApi = createMap({ container: $("#map"), tooltip, onLegend, initialView });
window.dvfMap = mapApi.map; // pratique pour le débogage et le test de fumée

createSidebar($("#sidebar"), {
  getCenter: () => mapApi.map.getCenter().toArray().map((v) => +v.toFixed(5)),
  getZoom: () => mapApi.map.getZoom(),
  onLinkedParcels: (ids) => state.location.parcelle && mapApi.highlightParcels(state.location.parcelle, ids),
  onPredict: (parcelle, mutation) => {
    prediction.open(parcelle, mutation);
    showTab("prediction");
  },
});

const marche = createMarche($("[data-panel=marche]"));

const prediction = createPrediction($("[data-panel=prediction]"), {
  onShowOnMap: (parcelle, coords) => {
    showTab("carte");
    if (coords) mapApi.flyToParcel(parcelle, coords);
  },
  onChange: () => syncUrl(),
});

createSearch($("#search"), {
  onAddress: (coords) => mapApi.flyToAddress(coords),
  onParcel: (id, coords) => mapApi.flyToParcel(id, coords),
});

// Filtre par type de bien.
const filterBox = $("#filters");
filterBox.querySelector("button.toggle").addEventListener("click", () => filterBox.classList.toggle("open"));
filterBox.querySelectorAll("input[name=filtre]").forEach((input) => {
  input.checked = input.value === state.filter;
  input.addEventListener("change", () => setState({ filter: input.value }));
});
function renderFilterLabel() {
  $("#filter-label").textContent = FILTERS[state.filter].label;
  // Le filtre n'a pas de sens au niveau section / parcelle (comme l'original).
  filterBox.hidden = ["section", "parcelle"].includes(state.location.level);
}

// Bascule plan / photographie aérienne.
const styleBtn = $("#style-toggle");
styleBtn.querySelector("img").src = previewOrtho;
styleBtn.addEventListener("click", () => {
  const ortho = mapApi.toggleOrtho();
  styleBtn.querySelector("img").src = ortho ? previewVector : previewOrtho;
  styleBtn.title = ortho ? "Afficher le plan" : "Afficher la photographie aérienne";
});

// Colonne repliable sur mobile.
$("#sidebar-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("collapsed"));

// ------------------------------------------------------------ synchro de l'URL
function syncUrl() {
  const q = new URLSearchParams();
  q.set("onglet", document.querySelector("[data-tab][aria-selected=true]")?.dataset.tab ?? "carte");
  q.set("filtre", state.filter);
  const c = mapApi.map.getCenter();
  q.set("lat", c.lat.toFixed(5));
  q.set("lng", c.lng.toFixed(5));
  q.set("zoom", mapApi.map.getZoom().toFixed(2));
  if (state.location.parcelle) q.set("parcelle", state.location.parcelle);
  const ref = prediction?.current;
  if (q.get("onglet") === "prediction" && ref) {
    q.set("ref", ref.parcelle);
    if (ref.mutation) q.set("mutation", ref.mutation);
  }
  history.replaceState(null, "", `${location.pathname}?${q}`);
}
mapApi.map.on("moveend", syncUrl);
subscribe(() => {
  renderFilterLabel();
  syncUrl();
});
renderFilterLabel();

if (params.get("onglet") === "sources") showTab("sources");
if (params.get("onglet") === "marche") showTab("marche");
if (params.get("onglet") === "prediction") {
  if (params.get("ref")) prediction.open(params.get("ref"), params.get("mutation"));
  showTab("prediction");
}
