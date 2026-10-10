// Accès à l'API publique DVF de data.gouv.fr (https://github.com/datagouv/api-dvf).
// Toutes les réponses sont mises en cache en mémoire : la carte interroge souvent les mêmes URL.

export const DVF_API = import.meta.env.VITE_DVF_API || "https://dvf-api.data.gouv.fr";
const GEOCODER = "https://data.geopf.fr/geocodage/search";

const cache = new Map();

async function getJson(url) {
  if (!cache.has(url)) {
    const promise = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
      return res.json();
    });
    cache.set(url, promise);
    // On ne garde pas les erreurs en cache pour pouvoir réessayer.
    promise.catch(() => cache.delete(url));
  }
  return cache.get(url);
}

const dvf = (path) => getJson(DVF_API + path).then((r) => r.data ?? r);

export const api = {
  // Médianes sur la période complète (5 ans) d'un ensemble de territoires.
  nation: () => dvf("/nation"),
  departements: () => dvf("/departement"),
  epcis: () => dvf("/epci"),
  communesOfDep: (dep) => dvf(`/departement/${dep}/communes`),
  sectionsOfCommune: (com) => dvf(`/commune/${com}/sections`),

  // Séries mensuelles d'un territoire.
  monthly(level, code) {
    if (level === "fra") return dvf("/nation/mois");
    if (level === "departement") return dvf(`/departement/${code}`);
    if (level === "commune") return dvf(`/commune/${code}`);
    if (level === "section") return dvf(`/section/${code}`);
    return Promise.resolve([]);
  },

  // Distribution des prix au m² (histogramme).
  distribution: (code) => getJson(`${DVF_API}/distribution/${code}`),

  // Mutations d'une section cadastrale : /mutations/{commune}/{prefixe+section}.
  mutations: (parcelle) =>
    dvf(`/mutations/${parcelle.substring(0, 5)}/${parcelle.substring(5, 10)}`),

  // DPE (BDNB) et copropriétés d'une parcelle.
  dpeCopro: (parcelle) => dvf(`/dpe-copro/${parcelle}`),

  // Géocodage (adresses ou parcelles) via la Géoplateforme de l'IGN.
  searchAddress: (q) =>
    getJson(`${GEOCODER}?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`),
  searchParcel: (id) => getJson(`${GEOCODER}?index=parcel&q=${encodeURIComponent(id)}`),
};
