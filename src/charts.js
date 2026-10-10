// Courbe d'évolution mensuelle et histogramme de distribution (LineChart.vue / BarChart.vue).
import {
  Chart, LineController, LineElement, PointElement, BarController, BarElement,
  CategoryScale, LinearScale, Tooltip,
} from "chart.js";

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Tooltip);
Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue("--font").trim() || "sans-serif";

const MONTHS = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
const monthLabel = (d) => `${MONTHS[parseInt(d.slice(5, 7), 10) - 1]} ${d.slice(0, 4)}`;
const fmt = (n) => Math.round(n).toLocaleString("fr-FR");

const ACCENT = "rgb(74, 157, 247)";
const tooltipStyle = { backgroundColor: ACCENT, bodyColor: "#fff", titleColor: "#fff", displayColors: false };

export function createLineChart(canvas) {
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: [], datasets: [{
      data: [], borderWidth: 1.5, borderColor: "#161616", tension: 0.2,
      pointRadius: 0, pointHitRadius: 10, pointHoverRadius: 5,
      pointHoverBackgroundColor: ACCENT, pointHoverBorderColor: ACCENT,
    }] },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: (i) => `${fmt(i.raw)} €/m²` } } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: {
          autoSkip: false, maxRotation: 0,
          callback(_, index) { const n = this.chart.data.labels.length; return index === 0 || index === n - 1 ? this.chart.data.labels[index] : null; },
        } },
        y: { grid: { color: "#e5e5e5" }, border: { display: false, dash: [3] }, ticks: { maxTicksLimit: 4, callback: (v) => `${fmt(v)} €` } },
      },
    },
  });

  return {
    update(rows, priceKey) {
      const points = rows.filter((r) => r[priceKey] != null && Math.round(r[priceKey]) !== 0);
      chart.data.labels = points.map((r) => monthLabel(r.d));
      chart.data.datasets[0].data = points.map((r) => Math.round(r[priceKey]));
      chart.update();
      return points.length > 0;
    },
  };
}

export function createBarChart(canvas) {
  let bins = [];
  const chart = new Chart(canvas, {
    type: "bar",
    data: { labels: [], datasets: [{ data: [], backgroundColor: "#B6CFFB", hoverBackgroundColor: ACCENT, barPercentage: 1, categoryPercentage: 0.95 }] },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipStyle, callbacks: {
          title: (items) => {
            const i = items[0].dataIndex;
            const [lo, hi] = bins[i];
            return i === bins.length - 1 ? `plus de ${fmt(lo)} €/m²` : `entre ${fmt(lo)} € et ${fmt(hi)} €/m²`;
          },
          label: (i) => `${fmt(i.raw)} ventes`,
        } },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: {
          autoSkip: false, maxRotation: 0,
          callback(_, index) { const n = bins.length; return index === 0 || index === n - 1 ? `${fmt(bins[index][0])} €` : null; },
        } },
        y: { display: false },
      },
    },
  });

  return {
    update(distribution) {
      bins = distribution?.xaxis ?? [];
      chart.data.labels = bins.map((b) => b[0]);
      chart.data.datasets[0].data = distribution?.yaxis ?? [];
      chart.update();
      return bins.length > 0;
    },
  };
}
