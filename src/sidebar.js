// Colonne de gauche : statistiques, graphiques, mutations d'une parcelle (LeftCol.vue).
import { api } from "./api.js";
import { createLineChart, createBarChart } from "./charts.js";
import { FILTERS, state, subscribe, depName, isNoDataArea } from "./state.js";
import icons from "./icons.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => (v == null ? "–" : Math.round(v).toLocaleString("fr-FR"));
const euros = (v) => (v == null ? "indisponible" : `${num(v)} €`);
const stripZeros = (s) => (s || "").replace(/^0+/, "");

export function createSidebar(root, { getCenter, getZoom, onLinkedParcels }) {
  const $ = (sel) => root.querySelector(sel);
  const lineChart = createLineChart($("#line-chart"));
  const barChart = createBarChart($("#bar-chart"));
  let token = 0;

  // ---------------------------------------------------------- en-tête
  function renderHeader(loc) {
    const intro = $("#intro");
    const crumbs = $("#breadcrumb");
    intro.hidden = loc.level !== "fra";
    crumbs.hidden = loc.level === "fra";
    if (loc.level === "fra") return;

    const parts = ["France"];
    if (loc.dep) parts.push(`${depName(loc.dep)} (${loc.dep})`);
    if (loc.com) parts.push(`${loc.comName ?? loc.com} (${loc.com})`);
    if (loc.section) parts.push(`Section ${stripZeros(loc.section.substring(5))}`);
    if (loc.parcelle) parts.push(`Parcelle ${stripZeros(loc.parcelle.substring(10))}`);
    $("#ariane").innerHTML = parts.map((p) => `<span>${esc(p)}</span>`).join("");

    const titles = {
      departement: ["Département", `${depName(loc.dep)} (${loc.dep})`],
      commune: ["Commune", `${loc.comName ?? loc.com} (${loc.com})`],
      section: ["Section cadastrale", loc.section ?? "–"],
      parcelle: ["Parcelle cadastrale", loc.parcelle],
    };
    const [kind, label] = titles[loc.level];
    $("#location-kind").textContent = kind;
    $("#location-label").textContent = label;
  }

  // ---------------------------------------------------------- statistiques
  async function statsRow(loc) {
    if (loc.level === "fra") return (await api.nation())[0];
    if (loc.level === "departement") return (await api.departements()).find((r) => r.c === loc.dep);
    if (loc.level === "commune") return (await api.communesOfDep(loc.dep)).find((r) => r.c === loc.com);
    return null;
  }

  async function renderStats(loc, t) {
    const statsEl = $("#stats");
    const noData = loc.level !== "fra" && isNoDataArea(loc.dep);
    const showStats = ["fra", "departement", "commune"].includes(loc.level);
    statsEl.hidden = !showStats;
    $("#nodata").hidden = !(noData && showStats);
    if (!showStats) return;
    if (noData) {
      statsEl.hidden = true;
      return;
    }
    statsEl.classList.add("loading");

    const f = FILTERS[state.filter];
    const code = loc.level === "fra" ? "nation" : loc.level === "departement" ? loc.dep : loc.com;
    const [row, monthly, distrib] = await Promise.all([
      statsRow(loc).catch(() => null),
      api.monthly(loc.level, code).catch(() => []),
      api.distribution(code).catch(() => null),
    ]);
    if (t !== token) return;
    statsEl.classList.remove("loading");

    $("#total-sales").textContent = num(row?.[f.count]);
    $("#median-price").textContent = euros(row?.[f.price]);
    $("#sales-a").textContent = num(row?.a);
    $("#sales-m").textContent = num(row?.m);
    $("#sales-l").textContent = num(row?.l);
    $("#price-a").textContent = euros(row?.m_a);
    $("#price-m").textContent = euros(row?.m_m);
    $("#price-l").textContent = euros(row?.m_l);
    root.dataset.filter = state.filter;

    const geo = loc.level === "departement" ? `(${depName(loc.dep)})` : loc.level === "commune" ? `(${loc.comName ?? loc.com})` : "";
    root.querySelectorAll(".chart-geo").forEach((el) => (el.textContent = geo));
    $("#line-block").classList.toggle("empty", !lineChart.update(monthly, f.price));
    $("#bar-block").classList.toggle("empty", !barChart.update(distrib?.[f.distrib]));
  }

  // ---------------------------------------------------------- liens utiles
  function renderLinks(loc) {
    const el = $("#links");
    el.hidden = loc.level === "fra";
    if (el.hidden) return;
    const [lng, lat] = getCenter();
    const zoom = Math.round(getZoom());
    const links = [
      ["Voir la couverture réseaux sur maconnexioninternet.arcep.fr",
        `https://maconnexioninternet.arcep.fr/?lat=${lat}&lng=${lng}&zoom=${zoom}&mode=normal`],
      ["Voir l’urbanisme sur geoportail-urbanisme.gouv.fr",
        `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&zoom=${zoom}&lon=${lng}&lat=${lat}`],
    ];
    if (loc.com) {
      links.push(["Voir les risques sur georisques.gouv.fr",
        `https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2?form-adresse=true&isCadastre=false&city=${encodeURIComponent(loc.comName ?? "")}&type=housenumber&typeForm=commune&codeInsee=${loc.com}&lon=${lng}&lat=${lat}&go_back=%2F`]);
      links.push(["Voir l’accessibilité sur acceslibre.beta.gouv.fr",
        `https://acceslibre.beta.gouv.fr/recherche/?what=&where=${encodeURIComponent(`${loc.comName ?? ""} (${loc.dep})`)}&lat=${lat}&lon=${lng}&code=${loc.com}&search_type=municipality`]);
    }
    if (loc.level === "commune" || loc.level === "departement") {
      const perimetre = loc.level === "commune" ? `comm&codeinsee=${loc.com}` : `dep&codeinsee=${loc.dep}`;
      links.push(["Voir les indicateurs de prix du Cerema (Dynmark)", `https://dataviz.cerema.fr/dynmark/?perimetre=${perimetre}`]);
    }
    $("#links-list").innerHTML = links
      .map(([label, href]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${icons.external} ${esc(label)}</a>`)
      .join("");
  }

  // ---------------------------------------------------------- parcelle
  function groupMutations(rows, parcelle) {
    const byId = new Map();
    rows.filter((r) => r.id_parcelle === parcelle).forEach((r) => {
      if (!byId.has(r.id_mutation)) {
        byId.set(r.id_mutation, {
          id: r.id_mutation,
          nature: r.nature_mutation,
          address: r.adresse_nom_voie ? `${r.adresse_numero ?? ""} ${r.adresse_nom_voie.toLowerCase()}`.trim() : null,
          date: r.date_mutation,
          price: r.valeur_fonciere,
          assets: [],
        });
      }
      const m = byId.get(r.id_mutation);
      if (r.type_local) {
        const rooms = r.nombre_pieces_principales ? ` / ${r.nombre_pieces_principales}p` : "";
        m.assets.push({ type: r.type_local + rooms, surface: r.surface_reelle_bati });
      }
      if (r.nature_culture) m.assets.push({ type: r.nature_culture, surface: r.surface_terrain });
    });
    // Autres parcelles vendues dans la même mutation.
    const linked = {};
    rows.forEach((r) => {
      if (byId.has(r.id_mutation) && r.id_parcelle !== parcelle) {
        (linked[r.id_mutation] ??= new Set()).add(r.id_parcelle);
      }
    });
    const order = (t) => (t.startsWith("Maison") ? 0 : t.startsWith("Appartement") ? 1 : 2);
    const mutations = [...byId.values()].map((m) => {
      const seen = new Set();
      m.assets = m.assets
        .filter((a) => { const k = `${a.type}|${a.surface}`; return !seen.has(k) && seen.add(k); })
        .sort((a, b) => order(a.type) - order(b.type));
      m.linked = [...(linked[m.id] ?? [])];
      return m;
    });
    return mutations.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  const assetIcon = (type) => {
    const p = type.substring(0, 4);
    return p === "Mais" ? icons.maison : p === "Appa" ? icons.appartement : p === "Loca" ? icons.local : p === "Dépe" ? icons.dependance : icons.terrain;
  };

  async function renderParcel(loc, t) {
    const el = $("#mutations");
    el.hidden = loc.level !== "parcelle";
    $("#section-cta").hidden = loc.level !== "section";
    $("#dpe").hidden = true;
    $("#copro").hidden = true;
    if (loc.level !== "parcelle") return;

    $("#mutations-list").innerHTML = `<p class="muted">Chargement des mutations…</p>`;
    $("#mutations-total").textContent = "";
    let rows = [];
    try {
      rows = await api.mutations(loc.parcelle);
    } catch {
      if (t === token) $("#mutations-list").innerHTML = `<p class="muted">Impossible de récupérer les mutations.</p>`;
      return;
    }
    if (t !== token) return;

    const mutations = groupMutations(rows, loc.parcelle);
    onLinkedParcels(mutations.flatMap((m) => m.linked));
    $("#mutations-total").textContent = mutations.length ? `${mutations.length} mutation${mutations.length > 1 ? "s" : ""}` : "";
    $("#mutations-list").innerHTML = mutations.length
      ? mutations.map((m) => `
        <article class="mutation">
          <div class="nature">${esc(m.nature)}</div>
          <div class="price">${m.price ? `${num(m.price)} €` : "Non renseigné"}</div>
          ${m.address ? `<div class="meta">${icons.pin} ${esc(m.address)}</div>` : ""}
          <div class="meta">${icons.id} ${esc(m.id)}</div>
          <div class="meta">${icons.date} ${esc(new Date(m.date).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" }))}</div>
          ${m.assets.map((a) => `
            <div class="asset"><span>${assetIcon(a.type)} ${esc(a.type)}</span>${a.surface ? `<span class="surface">${num(a.surface)} m²</span>` : ""}</div>`).join("")}
          ${m.linked.length ? `<p class="linked">Cette vente s'est effectuée sur plusieurs parcelles.<br>Parcelles complémentaires : ${m.linked.map(esc).join(", ")}</p>` : ""}
        </article>`).join("")
      : `<p class="muted">Aucune transaction enregistrée sur cette parcelle depuis 5 ans.</p>`;

    renderDpeCopro(loc, t);
  }

  async function renderDpeCopro(loc, t) {
    let data;
    try {
      data = await api.dpeCopro(loc.parcelle);
    } catch {
      return;
    }
    if (t !== token || !data) return;
    const dpe = (data.dpe ?? []).filter((d) => d.classe_bilan_dpe);
    const copro = data.copro ?? [];
    const tag = (c) => `<span class="dpe-tag dpe-${esc(c).toLowerCase()}">${esc(c)}</span>`;

    if (dpe.length) {
      $("#dpe").hidden = false;
      $("#dpe-body").innerHTML =
        (dpe.length > 1 ? `<p class="muted">Plusieurs bâtiments semblent présents sur cette parcelle.</p>` : "") +
        dpe.map((d) => `
          <div class="dpe-item">
            <div>${tag(d.classe_bilan_dpe)} Consommation d'énergie</div>
            ${d.classe_emission_ges ? `<div>${tag(d.classe_emission_ges)} Émissions de gaz à effet de serre</div>` : ""}
            ${d.periode_construction_dpe ? `<div>Période de construction : <b>${esc(d.periode_construction_dpe)}</b></div>` : ""}
            ${d.nombre_niveau_immeuble ? `<div>Immeuble sur <b>${esc(d.nombre_niveau_immeuble)}</b> niveaux</div>` : ""}
            ${d.surface_habitable_immeuble ? `<div>Surface habitable de l'immeuble : <b>${esc(d.surface_habitable_immeuble)} m²</b></div>` : ""}
          </div>`).join("") +
        `<p class="muted">Source : Base de données nationale des bâtiments (BDNB).</p>`;
    }
    if (copro.length) {
      const fields = [
        ["nom_usage_copropriete", "Nom d'usage"],
        ["numero_immatriculation", "Numéro d'immatriculation"],
        ["identification_representant_legal", "Représentant légal"],
        ["syndicat_cooperatif", "Syndicat coopératif"],
        ["nombre_total_lots", "Nombre total de lots"],
        ["nombre_lots_usage_habitation", "Lots à usage d'habitation"],
        ["nombre_lots_stationnement", "Lots de stationnement"],
        ["mandat_en_cours_copropriete", "Mandat en cours"],
      ];
      $("#copro").hidden = false;
      $("#copro-body").innerHTML =
        copro.map((c) => `<div class="dpe-item">${fields
          .filter(([k]) => c[k] != null)
          .map(([k, label]) => `<div>${label} : <b>${esc(c[k])}</b></div>`).join("")}</div>`).join("") +
        `<p class="muted">Source : Registre national d'immatriculation des copropriétés.</p>`;
    }
  }

  // ---------------------------------------------------------- rendu
  let lastKey = "";
  function render(s) {
    const loc = s.location;
    const key = `${s.filter}|${JSON.stringify(loc)}`;
    if (key === lastKey) return;
    lastKey = key;
    const t = ++token;
    renderHeader(loc);
    renderStats(loc, t);
    renderLinks(loc);
    renderParcel(loc, t);
  }

  root.querySelectorAll(".collapsible > button").forEach((btn) =>
    btn.addEventListener("click", () => btn.parentElement.classList.toggle("open")),
  );

  subscribe(render);
  render(state);
}
