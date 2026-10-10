// État global minimal (équivalent du store Vuex de l'original) avec abonnements.
import centers from "./data/centers_deps.json";

export const FILTERS = {
  tous: { price: "m_am", count: "am", label: "Appartements et maisons", distrib: "apt_maison" },
  appartement: { price: "m_a", count: "a", label: "Appartements", distrib: "appartement" },
  maison: { price: "m_m", count: "m", label: "Maisons", distrib: "maison" },
  local: { price: "m_l", count: "l", label: "Locaux", distrib: "local" },
};

// Paris, Lyon et Marseille : la commune « mère » est remplacée par ses arrondissements.
export const PLM = ["75056", "69123", "13055"];

// Les données DVF ne couvrent pas l'Alsace-Moselle (livre foncier).
export const isNoDataArea = (code) =>
  !!code && ["57", "67", "68"].includes(String(code).substring(0, 2));

export function depOf(code) {
  if (!code) return null;
  return parseInt(code.substring(0, 2), 10) >= 97 ? code.substring(0, 3) : code.substring(0, 2);
}

export const depName = (dep) => centers[dep]?.nom ?? dep;
export const depCenter = (dep) => centers[dep]?.coordinates;

const listeners = new Set();

export const state = {
  filter: "tous",
  // Niveau affiché : fra | departement | commune | section | parcelle
  location: { level: "fra", dep: null, com: null, comName: null, section: null, parcelle: null },
};

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}

export function setLocation(loc) {
  const prev = state.location;
  const next = { level: "fra", dep: null, com: null, comName: null, section: null, parcelle: null, ...loc };
  const same = Object.keys(next).every((k) => next[k] === prev[k]);
  if (!same) setState({ location: next });
}

export const subscribe = (fn) => listeners.add(fn);
