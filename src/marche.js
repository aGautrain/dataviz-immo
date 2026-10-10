// Onglet « Prix et taux » : évolution des prix DVF mise en regard des taux de crédit.
import {
  Chart, LineController, LineElement, PointElement, BarController, BarElement,
  CategoryScale, LinearScale, Tooltip, Legend, Filler,
} from "chart.js";
import { api } from "./api.js";
import { parseRates, buildMarketSeries } from "./rates.js";
import centers from "./data/centers_deps.json";

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

const RATES = parseRates();
const PRICE_KEYS = { tous: ["m_am", "am", "appartements et maisons"], appartement: ["m_a", "a", "appartements"], maison: ["m_m", "m", "maisons"] };
const COLORS = { price: "#000091", rate: "#e1000f", payment: "#18753c", total: "#6a6af4", volume: "#b7a73f", interest: "#e1000f", capital: "#000091", down: "#9a9aff" };

const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (a, b) => (a == null || b == null ? null : ((b - a) / a) * 100);
const signed = (v, d = 1) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${fmt(v, d)} %`);
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export function createMarche(root) {
  const $ = (sel) => root.querySelector(sel);
  const charts = {};
  let token = 0;
  let loaded = false;

  // Liste des territoires.
  const select = $("#mk-territory");
  select.innerHTML = `<option value="fra:nation">France entière</option>` +
    Object.entries(centers)
      .filter(([code]) => !["57", "67", "68"].includes(code))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, d]) => `<option value="departement:${code}">${code} – ${d.nom}</option>`)
      .join("");

  root.querySelectorAll("select, input").forEach((el) => el.addEventListener("change", render));

  async function render() {
    const t = ++token;
    const [level, code] = select.value.split(":");
    const type = $("#mk-type").value;
    const years = Number($("#mk-years").value);
    const surface = Math.max(9, Number($("#mk-surface").value) || 60);
    const downPaymentPct = Math.min(90, Math.max(0, Number($("#mk-down").value) || 0));
    const [priceKey, countKey, typeLabel] = PRICE_KEYS[type];

    $("#mk-status").hidden = false;
    let monthly = [];
    try {
      monthly = await api.monthly(level, code);
    } catch {
      if (t === token) $("#mk-status").textContent = "Impossible de charger les prix DVF de ce territoire.";
      return;
    }
    if (t !== token) return;
    $("#mk-status").hidden = true;

    const prices = monthly
      .filter((r) => r.d && r[priceKey] != null)
      .map((r) => ({ d: r.d, price: Number(r[priceKey]), volume: r[countKey] != null ? Number(r[countKey]) : null }));
    const series = buildMarketSeries(prices, RATES, { years, surface, downPaymentPct });
    const both = series.filter((s) => s.payment != null);
    if (both.length < 2) {
      $("#mk-status").hidden = false;
      $("#mk-status").textContent = "Pas assez de données communes entre les prix et les taux pour ce territoire.";
      return;
    }
    const first = both[0];
    const last = both[both.length - 1];
    const peak = both.reduce((a, b) => (b.payment > a.payment ? b : a));
    const territory = select.options[select.selectedIndex].text;

    currentSeries = series;
    renderKpis({ first, last, peak, years, surface, downPaymentPct, typeLabel, territory });
    renderCharts(series, both, first);
    loaded = true;
  }

  let currentSeries = [];
  // Ventes cumulées sur les 12 mois se terminant au mois donné (les volumes sont très saisonniers).
  function volumeAverage(month) {
    const i = currentSeries.findIndex((s) => s.month === month);
    const w = currentSeries.slice(Math.max(0, i - 11), i + 1).map((s) => s.volume).filter((v) => v != null);
    return i >= 11 && w.length === 12 ? w.reduce((a, b) => a + b, 0) / 12 : null;
  }

  function renderKpis({ first, last, peak, years, surface, downPaymentPct, typeLabel, territory }) {
    const rows = [
      ["Prix médian au m²", `${fmt(first.price)} €`, `${fmt(last.price)} €`, pct(first.price, last.price)],
      [`Taux moyen ${years} ans`, `${fmt(first.rate, 2)} %`, `${fmt(last.rate, 2)} %`, null, `${last.rate - first.rate >= 0 ? "+" : ""}${fmt(last.rate - first.rate, 2)} pt`],
      [`Prix d'un bien de ${surface} m²`, `${fmt(first.propertyPrice)} €`, `${fmt(last.propertyPrice)} €`, pct(first.propertyPrice, last.propertyPrice)],
      ["Mensualité", `${fmt(first.payment)} €`, `${fmt(last.payment)} €`, pct(first.payment, last.payment)],
      ["Intérêts payés à la banque", `${fmt(first.interest)} €`, `${fmt(last.interest)} €`, pct(first.interest, last.interest)],
      ["Coût total pour l'acheteur", `${fmt(first.totalCost)} €`, `${fmt(last.totalCost)} €`, pct(first.totalCost, last.totalCost)],
      ["Part des intérêts dans le coût total", `${fmt((first.interest / first.totalCost) * 100, 1)} %`, `${fmt((last.interest / last.totalCost) * 100, 1)} %`, null,
        `${last.interest / last.totalCost >= first.interest / first.totalCost ? "+" : ""}${fmt(((last.interest / last.totalCost) - (first.interest / first.totalCost)) * 100, 1)} pt`],
      ["Surface achetable avec 1 000 €/mois", `${fmt(first.surfaceFor1000)} m²`, `${fmt(last.surfaceFor1000)} m²`, pct(first.surfaceFor1000, last.surfaceFor1000)],
    ];
    $("#mk-table").innerHTML = `
      <thead><tr><th></th><th>${monthLabel(first.month)}</th><th>${monthLabel(last.month)}</th><th>Évolution</th></tr></thead>
      <tbody>${rows.map(([label, a, b, p, abs]) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td><td class="${(p ?? 0) > 0.5 ? "up" : (p ?? 0) < -0.5 ? "down" : ""}">${abs ?? signed(p)}</td></tr>`).join("")}</tbody>`;
    $("#mk-hypothesis").textContent = `${territory}, ${typeLabel} : achat d'un bien de ${surface} m² au prix médian, apport de ${downPaymentPct} %, prêt sur ${years} ans au taux moyen du mois (hors assurance et frais).`;

    const priceVar = pct(first.price, last.price);
    const paymentVar = pct(first.payment, last.payment);
    const sellerShare = last.propertyPrice - first.propertyPrice;
    const bankShare = last.interest - first.interest;
    const costVar = pct(first.totalCost, last.totalCost);
    const volFirst = volumeAverage(first.month);
    const volLast = volumeAverage(last.month);
    const volVar = pct(volFirst, volLast);
    let verdict = Math.abs(costVar) < 5
      ? "Le coût total d'achat pour un emprunteur est resté à peu près stable sur la période."
      : `Le coût total d'achat pour un emprunteur n'est pas resté stable : il a varié de <b>${signed(costVar)}</b>, ${Math.abs(bankShare) > Math.abs(sellerShare) ? "porté surtout par la charge d'intérêts" : "porté surtout par le prix"}.`;
    if (volVar != null && volVar < -10) {
      verdict += ` Le marché s'est surtout ajusté par le <b>nombre de ventes</b> (${signed(volVar, 0)} sur 12 mois glissants) plutôt que par les prix.`;
    }
    $("#mk-reading").innerHTML = `
      <p>Entre ${monthLabel(first.month)} et ${monthLabel(last.month)}, le prix médian au m² a varié de <b>${signed(priceVar)}</b>, mais la mensualité pour acheter le même bien a varié de <b>${signed(paymentVar)}</b>, car le taux sur ${$("#mk-years").value} ans est passé de ${fmt(first.rate, 2)} % à ${fmt(last.rate, 2)} %.</p>
      <p>Sur le coût total du bien (${fmt(first.totalCost)} € → ${fmt(last.totalCost)} €), <b>${fmt(sellerShare)} €</b> de l'écart vont au vendeur (prix) et <b>${fmt(bankShare)} €</b> au prêteur (intérêts). Au plus haut (${monthLabel(peak.month)}), la mensualité atteignait ${fmt(peak.payment)} €.</p>
      <p>${verdict}</p>`;
  }

  function renderCharts(series, both, first) {
    const labels = series.map((s) => monthLabel(s.month));
    const base = (key) => series.map((s) => (s[key] != null && first[key] ? (s[key] / first[key]) * 100 : null));
    const volumeBase = (() => {
      // Volumes très saisonniers : moyenne glissante sur 12 mois, base au premier mois commun.
      const vols = series.map((s) => s.volume);
      const avg = vols.map((_, i) => {
        const w = vols.slice(Math.max(0, i - 11), i + 1).filter((v) => v != null);
        return w.length >= 12 ? w.reduce((a, b) => a + b, 0) / w.length : null;
      });
      const ref = avg[series.indexOf(first)] ?? avg.find((v) => v != null);
      return avg.map((v) => (v != null && ref ? (v / ref) * 100 : null));
    })();

    const common = {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: 0, hoverRadius: 4 }, line: { borderWidth: 2, tension: 0.25 } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0 } } },
    };
    const make = (id, config) => {
      charts[id]?.destroy();
      charts[id] = new Chart($(`#${id}`), config);
    };

    make("mk-chart-price-rate", {
      type: "line",
      data: { labels, datasets: [
        { label: "Prix médian au m² (moyenne 3 mois)", data: series.map((s) => s.price), borderColor: COLORS.price, backgroundColor: COLORS.price, yAxisID: "y", spanGaps: true },
        { label: "Prix médian au m² (brut)", data: series.map((s) => s.rawPrice), borderColor: "rgba(0,0,145,0.25)", borderWidth: 1, yAxisID: "y", spanGaps: true },
        { label: `Taux moyen ${$("#mk-years").value} ans`, data: series.map((s) => s.rate), borderColor: COLORS.rate, backgroundColor: COLORS.rate, yAxisID: "y1", spanGaps: true },
      ] },
      options: { ...common,
        plugins: { ...common.plugins, tooltip: { callbacks: { label: (i) => `${i.dataset.label} : ${i.dataset.yAxisID === "y1" ? `${fmt(i.raw, 2)} %` : `${fmt(i.raw)} €`}` } } },
        scales: { ...common.scales,
          y: { position: "left", title: { display: true, text: "€ / m²" }, ticks: { callback: (v) => `${fmt(v)} €` } },
          y1: { position: "right", title: { display: true, text: "Taux" }, grid: { drawOnChartArea: false }, ticks: { callback: (v) => `${fmt(v, 1)} %` } },
        } },
    });

    make("mk-chart-cost", {
      type: "bar",
      data: { labels, datasets: [
        { label: "Apport", data: series.map((s) => s.downPayment ?? null), backgroundColor: COLORS.down, stack: "c" },
        { label: "Capital emprunté (va au vendeur)", data: series.map((s) => s.loan ?? null), backgroundColor: COLORS.capital, stack: "c" },
        { label: "Intérêts (vont au prêteur)", data: series.map((s) => s.interest ?? null), backgroundColor: COLORS.interest, stack: "c" },
      ] },
      options: { ...common,
        plugins: { ...common.plugins, tooltip: { callbacks: {
          label: (i) => `${i.dataset.label} : ${fmt(i.raw)} €`,
          footer: (items) => `Coût total : ${fmt(items.reduce((s, i) => s + (i.raw ?? 0), 0))} €`,
        } } },
        scales: { ...common.scales, x: { ...common.scales.x, stacked: true }, y: { stacked: true, ticks: { callback: (v) => `${fmt(v / 1000)} k€` } } } },
    });

    make("mk-chart-index", {
      type: "line",
      data: { labels, datasets: [
        { label: "Prix au m²", data: base("price"), borderColor: COLORS.price, spanGaps: true },
        { label: "Mensualité", data: base("payment"), borderColor: COLORS.payment, spanGaps: true },
        { label: "Coût total", data: base("totalCost"), borderColor: COLORS.total, spanGaps: true },
        { label: "Surface achetable avec 1 000 €/mois", data: base("surfaceFor1000"), borderColor: "#ff9575", spanGaps: true },
        { label: "Ventes (moyenne 12 mois)", data: volumeBase, borderColor: COLORS.volume, borderDash: [5, 4], spanGaps: true },
      ] },
      options: { ...common,
        plugins: { ...common.plugins, tooltip: { callbacks: { label: (i) => `${i.dataset.label} : ${fmt(i.raw, 1)}` } } },
        scales: { ...common.scales, y: { title: { display: true, text: `Base 100 = ${monthLabel(first.month)}` } } } },
    });
  }

  return {
    show() {
      if (!loaded) render();
      Object.values(charts).forEach((c) => c.resize());
    },
  };
}
