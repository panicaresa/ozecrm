// Offer engine — port of the HTML calculator logic.
// All rounding uses 2 decimals. Currency is PLN.

export type BuildingType = "mieszkalny" | "gospodarczy";

export interface Building {
  id: string;
  name: string;
  type: BuildingType;
  area: number; // m²
  material?: string;
  color?: string;
}

export interface OfferConfig {
  basePriceLow: number; // <=200m² tier
  basePriceHigh: number; // >200m² tier
  globalMargin: number; // PLN total, spread over all m²
  discount: number;
  discountEnabled: boolean;
  subsidy: number;
  subsidyEnabled: boolean;
  installments: boolean;
  months: number;
  rrso: number; // annual %
  postalCode?: string;
  excludedZipCodes?: string[];
}

export interface BuildingCalc {
  buildingId: string;
  ratePerM2: number;
  net: number; // netto
  vatAmount: number;
  vatLabel: "8%" | "23%" | "Mieszany";
  gross: number;
}

export interface OfferTotals {
  buildings: BuildingCalc[];
  totalArea: number;
  baseRatePerM2: number;
  marginPerM2: number;
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
  afterDiscount: number;
  finalCost: number; // after discount + subsidy
  monthlyInstallment: number | null;
  vatSummaryLabel: string;
  isSubsidyExcluded: boolean;
}

export const fmtPln = (n: number) =>
  (isFinite(n) ? n : 0)
    .toLocaleString("pl-PL", {
      style: "currency",
      currency: "PLN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(/\u00a0/g, " ");

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calculateOffer(buildings: Building[], cfg: OfferConfig): OfferTotals {
  const safeBuildings = buildings.filter((b) => b.area > 0);
  const totalArea = safeBuildings.reduce((s, b) => s + b.area, 0);

  const baseRatePerM2 = totalArea > 200 ? cfg.basePriceHigh : cfg.basePriceLow;
  const marginPerM2 = totalArea > 0 ? cfg.globalMargin / totalArea : 0;
  const ratePerM2 = baseRatePerM2 + marginPerM2;

  const vatRateSet = new Set<string>();
  const buildingCalcs: BuildingCalc[] = safeBuildings.map((b) => {
    const net = round2(ratePerM2 * b.area);
    let vatAmount = 0;
    let vatLabel: BuildingCalc["vatLabel"] = "23%";
    if (b.type === "gospodarczy") {
      vatAmount = net * 0.23;
      vatLabel = "23%";
      vatRateSet.add("23%");
    } else {
      if (b.area <= 300 || b.area <= 0) {
        vatAmount = net * 0.08;
        vatLabel = "8%";
        vatRateSet.add("8%");
      } else {
        const factor8 = 300 / b.area;
        const factor23 = (b.area - 300) / b.area;
        vatAmount = net * factor8 * 0.08 + net * factor23 * 0.23;
        vatLabel = "Mieszany";
        vatRateSet.add("Mieszany");
      }
    }
    vatAmount = round2(vatAmount);
    return {
      buildingId: b.id,
      ratePerM2: round2(ratePerM2),
      net,
      vatAmount,
      vatLabel,
      gross: round2(net + vatAmount),
    };
  });

  const netTotal = round2(buildingCalcs.reduce((s, c) => s + c.net, 0));
  const vatTotal = round2(buildingCalcs.reduce((s, c) => s + c.vatAmount, 0));
  const grossTotal = round2(netTotal + vatTotal);

  const discount = cfg.discountEnabled ? cfg.discount : 0;
  const subsidy = cfg.subsidyEnabled ? cfg.subsidy : 0;
  const afterDiscount = round2(grossTotal - discount);
  const finalCost = round2(Math.max(0, afterDiscount - subsidy));

  let monthlyInstallment: number | null = null;
  if (cfg.installments && cfg.months > 0) {
    if (cfg.rrso === 0) {
      monthlyInstallment = round2(finalCost / cfg.months);
    } else {
      const r = cfg.rrso / 100 / 12;
      const pmt = (finalCost * (r * Math.pow(1 + r, cfg.months))) / (Math.pow(1 + r, cfg.months) - 1);
      monthlyInstallment = round2(pmt);
    }
  }

  let vatSummaryLabel = "VAT";
  if (vatRateSet.size === 1) {
    const only = Array.from(vatRateSet)[0];
    vatSummaryLabel = only === "Mieszany" ? "VAT (mieszany proporcjonalnie)" : `VAT ${only}`;
  } else if (vatRateSet.size > 1) {
    vatSummaryLabel = "VAT (mieszane stawki)";
  }

  const isSubsidyExcluded = !!(
    cfg.postalCode &&
    cfg.excludedZipCodes &&
    cfg.excludedZipCodes.includes(cfg.postalCode.trim())
  );

  return {
    buildings: buildingCalcs,
    totalArea: round2(totalArea),
    baseRatePerM2: round2(baseRatePerM2),
    marginPerM2: round2(marginPerM2),
    netTotal,
    vatTotal,
    grossTotal,
    afterDiscount,
    finalCost,
    monthlyInstallment,
    vatSummaryLabel,
    isSubsidyExcluded,
  };
}

export interface PdfContext {
  buildings: Building[];
  totals: OfferTotals;
  cfg: OfferConfig;
  client: {
    name: string;
    address: string;
  };
  author: string;
  validity: string;
  company: {
    name: string;
    address: string;
    zip: string;
    nip: string;
    email: string;
    phone: string;
  };
  rrsoLabel: string;
}

export function buildOfferHtml(ctx: PdfContext): string {
  const { buildings, totals, cfg, client, author, validity, company, rrsoLabel } = ctx;
  const today = new Date().toLocaleDateString("pl-PL");

  const rows = buildings
    .map((b, i) => {
      const calc = totals.buildings.find((x) => x.buildingId === b.id);
      if (!calc) return "";
      return `
      <tr>
        <td>${i + 1}</td>
        <td>
          <b>${escapeHtml(b.name)}</b><br/>
          <span style="color:#6b7280;font-size:11px">
            ${b.type === "mieszkalny" ? "Mieszkalny" : "Gospodarczy"} · ${b.area} m²
            ${b.material ? " · " + escapeHtml(b.material) : ""}
            ${b.color ? " · " + escapeHtml(b.color) : ""}
          </span>
        </td>
        <td>${b.area}</td>
        <td>m²</td>
        <td style="text-align:right">${fmtPln(calc.ratePerM2)}</td>
        <td style="text-align:right">${fmtPln(calc.net)}</td>
        <td style="text-align:center">${calc.vatLabel}</td>
      </tr>`;
    })
    .join("");

  const installmentRow =
    cfg.installments && totals.monthlyInstallment !== null
      ? `<tr><td colspan="2" style="color:#FF4D00;font-weight:700">Rata miesięczna (${rrsoLabel}, ${cfg.months} m-cy)</td>
         <td style="text-align:right;color:#FF4D00;font-weight:700">${fmtPln(totals.monthlyInstallment)}/mc</td></tr>`
      : "";

  const discountRow = cfg.discountEnabled
    ? `<tr><td colspan="2">Rabat</td><td style="text-align:right">− ${fmtPln(cfg.discount)}</td></tr>
       <tr><td colspan="2">Cena po rabacie</td><td style="text-align:right">${fmtPln(totals.afterDiscount)}</td></tr>`
    : "";

  const subsidyRow = cfg.subsidyEnabled
    ? `<tr><td colspan="2">Dotacja</td><td style="text-align:right">− ${fmtPln(cfg.subsidy)}</td></tr>
       <tr><td colspan="2"><b>Koszt końcowy klienta</b></td><td style="text-align:right"><b>${fmtPln(totals.finalCost)}</b></td></tr>`
    : "";

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8"/>
<title>Oferta Handlowa — ${escapeHtml(client.name)}</title>
<style>
  body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;margin:0;padding:24px}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #f3f4f6;padding-bottom:16px;margin-bottom:24px}
  .brand{font-size:22px;font-weight:900;color:#FF4D00;letter-spacing:-0.5px}
  h1{font-size:28px;margin:0 0 4px 0}
  h2{font-size:14px;margin:16px 0 4px 0;color:#6b7280;text-transform:uppercase;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
  th,td{border-bottom:1px solid #e5e7eb;padding:10px 8px;vertical-align:top}
  th{background:#09090B;color:#fff;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
  .summary{margin-top:24px;float:right;width:55%;font-size:14px}
  .summary table{border:none}
  .summary td{border:none;padding:6px 4px}
  .gross{background:#09090B;color:#fff;padding:12px;border-radius:8px;font-size:16px;font-weight:900;display:flex;justify-content:space-between}
  .warranty{float:left;width:40%;font-size:12px;color:#374151;background:#f9fafb;padding:12px;border-radius:8px}
  .foot{clear:both;margin-top:40px;border-top:1px solid #e5e7eb;padding-top:8px;font-size:10px;color:#9ca3af;text-align:center}
</style>
</head>
<body>
<header>
  <div>
    <div class="brand">GRUPA OZE</div>
    <div style="font-size:11px;color:#6b7280;margin-top:4px">${escapeHtml(company.name)}</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#374151">
    <div>${escapeHtml(company.address)}</div>
    <div>${escapeHtml(company.zip)}</div>
    <div>${escapeHtml(company.nip)}</div>
    <div style="color:#0055FF">${escapeHtml(company.email)}</div>
    <div style="color:#0055FF">${escapeHtml(company.phone)}</div>
  </div>
</header>

<div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:16px">
  <div>
    <h2>Przygotowano dla</h2>
    <div style="font-size:16px;font-weight:700">${escapeHtml(client.name || "—")}</div>
    <h2>Adres inwestycji</h2>
    <div style="color:#374151">${escapeHtml(client.address || "—")}</div>
  </div>
  <div style="text-align:right">
    <h1>OFERTA HANDLOWA</h1>
    <div style="font-size:11px;color:#6b7280">Data: ${today}</div>
    <div style="font-size:11px;color:#6b7280">Ważność: ${escapeHtml(validity)}</div>
    <div style="font-size:11px;color:#6b7280">Przygotował: ${escapeHtml(author)}</div>
  </div>
</div>

<p style="font-size:13px;line-height:1.6;color:#374151">
  Szanowni Państwo, w odpowiedzi na zainteresowanie naszymi usługami, przedstawiamy ofertę
  kompleksowej modernizacji dachu wraz z instalacją systemu fotowoltaicznego. Poniżej znajdą Państwo
  kosztorys uwzględniający obowiązujące stawki VAT oraz, jeśli wybrano tę opcję, symulację finansowania.
</p>

<table>
  <thead>
    <tr>
      <th>Lp.</th><th>Opis usługi / materiału</th><th>Ilość</th><th>J.m.</th>
      <th style="text-align:right">Cena jedn. netto</th>
      <th style="text-align:right">Wartość netto</th><th style="text-align:center">VAT</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div class="warranty">
  <b>Gwarancja</b><br/>
  Na wykonane prace udzielamy 10-letniej gwarancji. Producenci materiałów zapewniają gwarancję
  do 40 lat. Instalacja PV objęta osobną gwarancją producenta paneli.
</div>

<div class="summary">
  <table>
    <tr><td>Razem netto</td><td style="text-align:right">${fmtPln(totals.netTotal)}</td></tr>
    <tr><td>${escapeHtml(totals.vatSummaryLabel)}</td><td style="text-align:right">${fmtPln(totals.vatTotal)}</td></tr>
    ${discountRow}
    ${subsidyRow}
  </table>
  <div class="gross">
    <span>DO ZAPŁATY BRUTTO</span>
    <span>${fmtPln(cfg.subsidyEnabled || cfg.discountEnabled ? totals.finalCost : totals.grossTotal)}</span>
  </div>
  <table>${installmentRow}</table>
  ${
    totals.isSubsidyExcluded
      ? `<div style="margin-top:8px;padding:8px;background:#fef2f2;color:#991b1b;font-size:11px;border-radius:6px">Uwaga: podany kod pocztowy (${escapeHtml(cfg.postalCode || "")}) jest wykluczony z dotacji regionalnej.</div>`
      : ""
  }
</div>

<div class="foot">
  Oferta ma charakter informacyjny i nie stanowi oferty handlowej w rozumieniu art. 66 §1 KC.
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
