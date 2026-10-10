// Moteur d'estimation : méthode des ventes comparables, prix ramenés à aujourd'hui
// avec l'évolution mensuelle du prix médian au m² du territoire.
// Fonctions pures (sans appel réseau) pour pouvoir être testées isolément.

export const PROPERTY_TYPES = {
  Appartement: { code: "2", priceKey: "m_a" },
  Maison: { code: "1", priceKey: "m_m" },
  "Local industriel. commercial ou assimilé": { code: "4", priceKey: "m_l" },
};
const SALE_NATURES = ["Vente", "Vente en l'état futur d'achèvement", "Adjudication"];

// ------------------------------------------------------------ outils
export function haversine([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Quantile pondéré interpolé : items = [{ value, weight }].
// Chaque valeur est placée au milieu de sa masse cumulée, puis on interpole linéairement.
export function weightedQuantile(items, q) {
  const list = items.filter((i) => i.weight > 0).sort((a, b) => a.value - b.value);
  const total = list.reduce((s, i) => s + i.weight, 0);
  if (!total) return null;
  if (list.length === 1) return list[0].value;
  let acc = 0;
  const pos = list.map((i) => {
    const p = (acc + i.weight / 2) / total;
    acc += i.weight;
    return p;
  });
  if (q <= pos[0]) return list[0].value;
  if (q >= pos[pos.length - 1]) return list[list.length - 1].value;
  const k = pos.findIndex((p) => p >= q);
  const t = (q - pos[k - 1]) / (pos[k] - pos[k - 1]);
  return list[k - 1].value + t * (list[k].value - list[k - 1].value);
}

const monthIndex = (d) => {
  const [y, m] = d.slice(0, 7).split("-").map(Number);
  return y * 12 + (m - 1);
};
const monthLabel = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

// ------------------------------------------------------------ ventes
// Regroupe les lignes DVF (une ligne par lot / parcelle) en ventes « mono-bien » :
// une seule maison, un seul appartement ou un seul local (les dépendances ne comptent pas),
// comme le fait le pipeline statistique de data.gouv.fr.
export function singlePropertySales(rows) {
  const byMutation = new Map();
  for (const r of rows) {
    if (!byMutation.has(r.id_mutation)) byMutation.set(r.id_mutation, []);
    byMutation.get(r.id_mutation).push(r);
  }
  const sales = [];
  for (const [id, list] of byMutation) {
    const first = list[0];
    if (!SALE_NATURES.includes(first.nature_mutation)) continue;
    const price = Number(first.valeur_fonciere);
    if (!(price > 0)) continue;
    const seen = new Set();
    const properties = list.filter((r) => {
      if (!PROPERTY_TYPES[r.type_local]) return false;
      const key = `${r.type_local}|${r.surface_reelle_bati}|${r.nombre_pieces_principales}|${r.lot1_numero ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (properties.length !== 1) continue;
    const p = properties[0];
    const surface = Number(p.surface_reelle_bati);
    if (!(surface >= 9)) continue;
    const located = list.find((r) => r.longitude != null && r.latitude != null);
    sales.push({
      id,
      date: first.date_mutation,
      price,
      type: p.type_local,
      surface,
      rooms: p.nombre_pieces_principales ?? null,
      pricePerM2: price / surface,
      parcelle: p.id_parcelle,
      address: first.adresse_nom_voie
        ? `${first.adresse_numero ?? ""} ${first.adresse_nom_voie}`.trim().toLowerCase()
        : null,
      coords: located ? [Number(located.longitude), Number(located.latitude)] : null,
      hasOutbuilding: list.some((r) => r.type_local === "Dépendance"),
    });
  }
  return sales;
}

// Décrit une vente (même multi-biens) pour pré-remplir le formulaire de prédiction.
export function describeMutation(rows, mutationId) {
  const list = rows.filter((r) => r.id_mutation === mutationId);
  if (!list.length) return null;
  const first = list[0];
  const main = list
    .filter((r) => PROPERTY_TYPES[r.type_local])
    .sort((a, b) => (Number(b.surface_reelle_bati) || 0) - (Number(a.surface_reelle_bati) || 0))[0];
  const located = list.find((r) => r.longitude != null && r.latitude != null);
  return {
    id: mutationId,
    date: first.date_mutation,
    price: Number(first.valeur_fonciere) || null,
    nature: first.nature_mutation,
    address: first.adresse_nom_voie ? `${first.adresse_numero ?? ""} ${first.adresse_nom_voie}`.trim().toLowerCase() : null,
    parcelle: first.id_parcelle,
    type: main?.type_local ?? null,
    surface: main ? Number(main.surface_reelle_bati) || null : null,
    rooms: main?.nombre_pieces_principales ?? null,
    coords: located ? [Number(located.longitude), Number(located.latitude)] : null,
    propertyCount: new Set(list.filter((r) => PROPERTY_TYPES[r.type_local]).map((r) => `${r.type_local}|${r.surface_reelle_bati}`)).size,
  };
}

// ------------------------------------------------------------ indice de prix
// Indice mensuel lissé (médiane glissante sur 7 mois) du prix médian au m² d'un territoire.
export function buildPriceIndex(series, priceKey, minMonths = 18) {
  const points = series
    .filter((r) => r.d && r[priceKey] != null && Number(r[priceKey]) > 0)
    .map((r) => ({ m: monthIndex(r.d), v: Number(r[priceKey]) }))
    .sort((a, b) => a.m - b.m);
  if (points.length < minMonths) return null;
  const first = points[0].m;
  const last = points[points.length - 1].m;
  const smoothed = new Map();
  for (let m = first; m <= last; m++) {
    const window = points.filter((p) => Math.abs(p.m - m) <= 3).map((p) => p.v).sort((a, b) => a - b);
    if (window.length) smoothed.set(m, quantile(window, 0.5));
  }
  const at = (date) => {
    const m = Math.min(Math.max(monthIndex(date), first), last);
    for (let d = 0; d < 24; d++) {
      if (smoothed.has(m - d)) return smoothed.get(m - d);
      if (smoothed.has(m + d)) return smoothed.get(m + d);
    }
    return null;
  };
  return {
    first: monthLabel(first),
    last: monthLabel(last),
    at,
    // Coefficient pour ramener un prix de `date` au dernier mois disponible.
    factor: (date) => smoothed.get(last) / at(date),
  };
}

// ------------------------------------------------------------ estimation
// subject : { type, surface, rooms, coords, excludeMutation }
// sales   : ventes mono-bien du voisinage (singlePropertySales)
// index   : buildPriceIndex(...) ou null (pas d'actualisation)
export function estimate(subject, sales, index, { now = new Date() } = {}) {
  const typed = sales.filter((s) => s.type === subject.type && s.id !== subject.excludeMutation);

  // Fenêtres de surface de plus en plus larges jusqu'à avoir assez de comparables.
  const windows = [[0.75, 1.33], [0.6, 1.66], [0.4, 2.5]];
  let pool = [];
  let windowUsed = null;
  for (const [lo, hi] of windows) {
    pool = typed.filter((s) => s.surface >= subject.surface * lo && s.surface <= subject.surface * hi);
    windowUsed = [lo, hi];
    if (pool.length >= 8) break;
  }

  // Prix ramenés à aujourd'hui.
  let comps = pool.map((s) => {
    const factor = index ? index.factor(s.date) : 1;
    const distance = subject.coords && s.coords ? haversine(subject.coords, s.coords) : null;
    return { ...s, factor, adjustedPerM2: s.pricePerM2 * factor, distance };
  });

  // Écarte les valeurs aberrantes (règle de Tukey) quand l'échantillon le permet.
  if (comps.length >= 8) {
    const sorted = comps.map((c) => c.adjustedPerM2).sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    comps = comps.filter((c) => c.adjustedPerM2 >= q1 - 1.5 * iqr && c.adjustedPerM2 <= q3 + 1.5 * iqr);
  }

  // Pondération : proximité, fraîcheur de la vente, ressemblance (surface, pièces).
  const nowMs = now.getTime();
  for (const c of comps) {
    const years = Math.max(0, (nowMs - new Date(c.date).getTime()) / (365.25 * 864e5));
    const wDistance = c.distance == null ? 0.5 : Math.exp(-c.distance / 600);
    const wTime = Math.exp(-years / 4);
    const wSurface = Math.exp(-2 * Math.abs(Math.log(c.surface / subject.surface)));
    const wRooms = subject.rooms && c.rooms ? (c.rooms === subject.rooms ? 1 : Math.abs(c.rooms - subject.rooms) === 1 ? 0.7 : 0.4) : 0.8;
    c.weight = wDistance * wTime * wSurface * wRooms;
  }
  comps.sort((a, b) => b.weight - a.weight);

  if (comps.length < 3) {
    return { ok: false, reason: "Moins de 3 ventes comparables dans le voisinage.", comps, windowUsed };
  }

  const items = comps.map((c) => ({ value: c.adjustedPerM2, weight: c.weight }));
  const perM2 = weightedQuantile(items, 0.5);
  const low = weightedQuantile(items, 0.25);
  const high = weightedQuantile(items, 0.75);
  const dispersion = (high - low) / perM2;
  const confidence = comps.length >= 15 && dispersion < 0.25 ? "élevée" : comps.length >= 8 && dispersion < 0.45 ? "moyenne" : "faible";

  return {
    ok: true,
    perM2,
    value: perM2 * subject.surface,
    low: low * subject.surface,
    high: high * subject.surface,
    lowPerM2: low,
    highPerM2: high,
    confidence,
    comps,
    windowUsed,
    referenceMonth: index?.last ?? null,
  };
}
