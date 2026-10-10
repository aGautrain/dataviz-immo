import { scaleLinear } from "d3-scale";

// Même échelle que l'explorateur d'origine : vert -> jaune -> rouge, pivot sur la médiane.
const RANGE = ["#028758", "#FFF64E", "#CC000A"];
export const NO_VALUE_COLOR = "rgba(100, 100, 100, 0.6)";
export const OUTSIDE_COLOR = "rgba(100, 100, 100, 0.1)";

export function median(values) {
  const nums = [...values].sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

// Construit l'expression MapLibre "match" qui colore chaque territoire selon son prix médian,
// ainsi que les bornes affichées dans la légende.
export function choropleth(rows, priceKey, tileProperty) {
  const seen = new Set();
  const unique = rows.filter((r) => !seen.has(r.c) && seen.add(r.c));
  const values = unique.map((r) => r[priceKey]).filter((v) => v != null).map(Number);

  if (!unique.length) return { expression: OUTSIDE_COLOR, legend: null };

  let scale = () => NO_VALUE_COLOR;
  let legend = null;
  if (values.length) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pivot = median(values);
    scale = scaleLinear().domain([min, pivot, max]).range(RANGE);
    legend = {
      min: Math.floor(min / 100) * 100,
      pivot: Math.ceil(pivot / 100) * 100,
      max: Math.ceil(max / 1000) * 1000,
    };
  }

  const expression = ["match", ["get", tileProperty]];
  unique.forEach((r) => {
    expression.push(String(r.c), r[priceKey] != null ? scale(Number(r[priceKey])) : NO_VALUE_COLOR);
  });
  expression.push(OUTSIDE_COLOR);
  return { expression, legend };
}
