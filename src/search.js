// Barre de recherche d'adresse ou d'identifiant de parcelle (SearchBar.vue).
import { api } from "./api.js";

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const PARCEL_ID = /^\d{8}(\d|[A-Z])[A-Z]\d{4}$/;

export function createSearch(form, { onAddress, onParcel }) {
  const input = form.querySelector("input");
  const list = form.querySelector(".results");
  let results = [];
  let active = 0;
  let timer = null;
  let seq = 0;

  const close = () => {
    list.hidden = true;
    list.innerHTML = "";
    results = [];
  };

  function show(features) {
    results = features;
    active = 0;
    if (!features.length) {
      list.innerHTML = `<li class="muted">Aucun résultat</li>`;
      list.hidden = false;
      return;
    }
    list.innerHTML = features
      .map((f, i) => `<li role="option" data-i="${i}" class="${i === 0 ? "active" : ""}">${esc(f.label)}</li>`)
      .join("");
    list.hidden = false;
  }

  async function search() {
    const q = input.value.trim();
    if (q.length < 3) return close();
    const id = ++seq;
    try {
      const upper = q.toUpperCase().replace(/\s+/g, "");
      let features;
      if (PARCEL_ID.test(upper)) {
        const data = await api.searchParcel(upper);
        features = data.features.map((f) => ({
          label: `Parcelle ${f.properties.id}`, coordinates: f.geometry.coordinates, parcel: f.properties.id,
        }));
      } else {
        const data = await api.searchAddress(q);
        features = data.features.map((f) => ({
          label: f.properties.label, coordinates: f.geometry.coordinates,
        }));
      }
      if (id === seq) show(features);
    } catch (err) {
      console.error(err);
    }
  }

  function choose(i) {
    const f = results[i];
    if (!f) return;
    input.value = f.label;
    close();
    if (f.parcel) onParcel(f.parcel, f.coordinates);
    else onAddress(f.coordinates);
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(search, 350);
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden || !results.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      list.querySelectorAll("li").forEach((li, i) => li.classList.toggle("active", i === active));
    } else if (e.key === "Escape") close();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (results.length) return choose(active);
    await search();
    choose(0);
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) choose(Number(li.dataset.i));
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
}
