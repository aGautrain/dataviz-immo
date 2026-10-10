// Taux de crédit immobilier (Observatoire Crédit Logement/CSA) et calculs d'emprunt.
// Fonctions pures, testables sans navigateur.
import csvText from "./data/taux_credit_immobilier.csv?raw";

export const DURATIONS = [15, 20, 25];

// Découpe une ligne CSV en tenant compte des champs entre guillemets.
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseRates(text = csvText) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = splitCsvLine(header);
  return lines.filter(Boolean).map((line) => {
    const v = Object.fromEntries(splitCsvLine(line).map((x, i) => [cols[i], x.trim()]));
    return {
      month: v.mois,
      15: parseFloat(v.taux_15_ans_pct),
      20: parseFloat(v.taux_20_ans_pct),
      25: parseFloat(v.taux_25_ans_pct),
      source: v.source,
      comment: v.commentaire || null,
    };
  });
}

// Mensualité d'un prêt amortissable à taux fixe.
export function monthlyPayment(principal, annualRatePct, years) {
  const n = years * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - (1 + r) ** -n);
}

// Capital empruntable pour une mensualité donnée.
export function borrowingCapacity(payment, annualRatePct, years) {
  const n = years * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return payment * n;
  return (payment * (1 - (1 + r) ** -n)) / r;
}

// Moyenne glissante centrée sur `window` mois (lisse la saisonnalité des prix DVF).
export function smooth(values, window = 3) {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), i + half + 1).filter((v) => v != null);
    return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : null;
  });
}

// Combine la série DVF mensuelle et les taux en une série de coûts d'achat.
// prices : [{ d: "2022-01", price: €/m², volume }]
export function buildMarketSeries(prices, rates, { years = 20, surface = 60, downPaymentPct = 10, smoothing = 3 } = {}) {
  const rateByMonth = new Map(rates.map((r) => [r.month, r[years]]));
  const months = [...new Set([...prices.map((p) => p.d), ...rates.map((r) => r.month)])].sort();
  const priceByMonth = new Map(prices.map((p) => [p.d, p]));
  const rawPrices = months.map((m) => priceByMonth.get(m)?.price ?? null);
  const smoothed = smoothing > 1 ? smooth(rawPrices, smoothing) : rawPrices;
  // On ne lisse pas au-delà de la dernière donnée DVF.
  const lastPriceIdx = rawPrices.findLastIndex((v) => v != null);

  return months.map((month, i) => {
    const price = i <= lastPriceIdx ? smoothed[i] : null;
    const rate = rateByMonth.get(month) ?? null;
    const row = { month, price, rawPrice: rawPrices[i], volume: priceByMonth.get(month)?.volume ?? null, rate };
    if (price != null && rate != null) {
      const propertyPrice = price * surface;
      const downPayment = (propertyPrice * downPaymentPct) / 100;
      const loan = propertyPrice - downPayment;
      const payment = monthlyPayment(loan, rate, years);
      const totalRepaid = payment * years * 12;
      Object.assign(row, {
        propertyPrice,
        downPayment,
        loan,
        payment,
        interest: totalRepaid - loan,
        totalCost: downPayment + totalRepaid,
        // Surface achetable avec 1 000 €/mois (même apport en proportion).
        surfaceFor1000: borrowingCapacity(1000, rate, years) / (1 - downPaymentPct / 100) / price,
      });
    }
    return row;
  });
}
