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
  logoDataUrl?: string; // base64 data-url of brand logo (offline fallback)
  logoRemoteUrl?: string; // remote URL for the brand logo
  intro?: string; // editable intro paragraph shown above the pricing table
}

export function buildOfferHtml(ctx: PdfContext): string {
  const { buildings, totals, cfg, client, author, validity, company, rrsoLabel, logoDataUrl, logoRemoteUrl, intro } = ctx;
  const today = new Date().toLocaleDateString("pl-PL");

  const rows = buildings
    .map((b, i) => {
      const calc = totals.buildings.find((x) => x.buildingId === b.id);
      if (!calc) return "";
      const subtitle =
        (b.type === "mieszkalny" ? "Obiekt mieszkalny" : "Obiekt gospodarczy") +
        (b.material ? " · " + escapeHtml(b.material) : "") +
        (b.color ? " · " + escapeHtml(b.color) : "");
      return `
      <tr>
        <td class="col-lp">${i + 1}</td>
        <td class="col-desc">
          <div class="row-title">${escapeHtml(b.name)} — modernizacja dachu</div>
          <div class="row-sub">${subtitle}</div>
        </td>
        <td class="col-qty">${b.area}</td>
        <td class="col-unit">m²</td>
        <td class="col-price">${fmtPln(calc.ratePerM2)}</td>
        <td class="col-value">${fmtPln(calc.net)}</td>
        <td class="col-vat"><span class="vat-badge">${calc.vatLabel}</span></td>
      </tr>`;
    })
    .join("");

  // Logo: use remote URL as primary (always the latest brand mark), fallback to embedded base64 PNG if URL fails to load (e.g. offline)
  const primarySrc = logoRemoteUrl || logoDataUrl || "";
  const fallbackSrc = logoDataUrl && logoRemoteUrl ? logoDataUrl : "";
  const headerLogo = primarySrc
    ? `<img src="${primarySrc}" alt="Grupa OZE" style="height:44px;width:auto;display:block"${
        fallbackSrc ? ` onerror="this.onerror=null;this.src='${fallbackSrc}'"` : ""
      } />`
    : `<div style="font-weight:900;letter-spacing:-1px;font-size:24px;color:#0B2545">GRUPA <span style="color:#30A0E3">OZE</span></div>`;

  const showDiscount = cfg.discountEnabled && cfg.discount > 0;
  const showSubsidy = cfg.subsidyEnabled && cfg.subsidy > 0;
  const showInstallment = cfg.installments && totals.monthlyInstallment !== null;
  const finalPayable = showSubsidy || showDiscount ? totals.finalCost : totals.grossTotal;

  const introHtml = (intro || "").trim()
    ? escapeHtml(intro!).replace(/\n/g, "<br/>")
    : "";

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8"/>
<title>Oferta Handlowa — ${escapeHtml(client.name || "Klient")}</title>
<style>
  *{box-sizing:border-box}
  @page{size:A4;margin:18mm 14mm}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0B1220;margin:0;padding:0;font-size:12px;line-height:1.5}
  .doc{padding:0}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #30A0E3;padding-bottom:16px;margin-bottom:28px}
  .firm{font-size:11px;color:#475569;line-height:1.6;text-align:right}
  .firm .firm-name{font-weight:800;color:#0B2545;font-size:12px}
  .firm a{color:#30A0E3;text-decoration:none}
  .title-block{margin-bottom:24px;display:flex;justify-content:space-between;gap:24px}
  .title-left h1{margin:0;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:2px;font-weight:700}
  .title-left .doc-title{font-size:28px;font-weight:900;color:#0B2545;letter-spacing:-1px;margin-top:4px}
  .title-right{text-align:right;font-size:11px;color:#64748B}
  .title-right .meta{margin:3px 0}
  .title-right b{color:#0B1220}
  .client-box{background:#F1F5F9;border-left:4px solid #30A0E3;padding:14px 18px;border-radius:6px;margin-bottom:24px;display:flex;justify-content:space-between;gap:20px}
  .client-box .label{font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:4px}
  .client-box .value{font-size:15px;color:#0B2545;font-weight:700}
  .client-box .addr{font-size:12px;color:#475569;margin-top:2px}
  .intro{color:#334155;line-height:1.65;margin-bottom:20px;text-align:justify}
  .section-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#64748B;margin:22px 0 10px 0;padding-bottom:6px;border-bottom:1px solid #E2E8F0}
  table.pricing{width:100%;border-collapse:collapse;font-size:11px}
  table.pricing thead th{background:linear-gradient(135deg,#0B2545 0%,#1e3a5f 100%);color:#fff;text-align:left;padding:10px 8px;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700}
  table.pricing thead th:first-child{border-top-left-radius:6px}
  table.pricing thead th:last-child{border-top-right-radius:6px}
  table.pricing tbody tr{border-bottom:1px solid #E2E8F0}
  table.pricing tbody tr:nth-child(even){background:#F8FAFC}
  table.pricing td{padding:12px 8px;vertical-align:top}
  .col-lp{width:32px;font-weight:700;color:#64748B;text-align:center}
  .col-desc{font-size:12px}
  .row-title{font-weight:700;color:#0B2545}
  .row-sub{font-size:10px;color:#64748B;margin-top:3px}
  .col-qty{width:50px;text-align:right;font-weight:600}
  .col-unit{width:40px;color:#64748B}
  .col-price,.col-value{width:90px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .col-value{font-weight:700;color:#0B2545}
  .col-vat{width:80px;text-align:center}
  .vat-badge{display:inline-block;padding:3px 8px;border-radius:999px;background:#E0F2FE;color:#0369A1;font-weight:700;font-size:10px}
  .totals-row{display:flex;gap:16px;margin-top:24px;align-items:flex-start}
  .warranty{flex:1;background:#EFF6FF;border:1px solid #BFDBFE;border-left:4px solid #30A0E3;padding:16px;border-radius:8px}
  .warranty h3{margin:0 0 6px 0;font-size:12px;color:#0B2545;text-transform:uppercase;letter-spacing:1px;font-weight:800}
  .warranty p{margin:0;color:#1e3a5f;font-size:11px;line-height:1.6}
  .summary{flex:1.1;background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:4px 14px;box-shadow:0 1px 2px rgba(0,0,0,0.04)}
  .summary table{width:100%;border-collapse:collapse}
  .summary td{padding:8px 0;font-size:12px;border-bottom:1px solid #F1F5F9}
  .summary tr:last-child td{border-bottom:none}
  .summary .label{color:#475569}
  .summary .value{text-align:right;font-weight:700;color:#0B1220;font-variant-numeric:tabular-nums;white-space:nowrap}
  .summary .muted .value{color:#64748B}
  .summary .discount .value{color:#EF4444}
  .summary .gross{background:linear-gradient(135deg,#0B2545,#1e3a5f);color:#fff;padding:14px;border-radius:8px;margin:10px -14px;display:flex;justify-content:space-between;align-items:center}
  .summary .gross .label{color:#B6C5DB;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700}
  .summary .gross .amount{font-size:20px;font-weight:900;letter-spacing:-0.5px}
  .summary .final{background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;padding:10px;margin:6px -4px;display:flex;justify-content:space-between;align-items:center}
  .summary .final .label{color:#166534;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px}
  .summary .final .amount{color:#166534;font-size:17px;font-weight:900}
  .installment{background:linear-gradient(135deg,#30A0E3 0%,#1F87C6 100%);color:#fff;padding:14px;border-radius:8px;margin-top:12px;display:flex;justify-content:space-between;align-items:center}
  .installment .label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;opacity:0.9}
  .installment .sublabel{font-size:10px;opacity:0.85;margin-top:2px}
  .installment .amount{font-size:20px;font-weight:900}
  .installment .mo{font-size:11px;opacity:0.9}
  .notice{margin-top:12px;padding:10px 12px;background:#FEF2F2;border-left:3px solid #EF4444;border-radius:4px;color:#991B1B;font-size:11px}
  .footer{margin-top:40px;padding-top:14px;border-top:1px solid #E2E8F0;text-align:center;font-size:9px;color:#94A3B8;line-height:1.6}
</style>
</head>
<body>
<div class="doc">

<header>
  <div>${headerLogo}</div>
  <div class="firm">
    <div class="firm-name">${escapeHtml(company.name)}</div>
    <div>${escapeHtml(company.address)}</div>
    <div>${escapeHtml(company.zip)}</div>
    <div>${escapeHtml(company.nip)}</div>
    <div><a>${escapeHtml(company.email)}</a></div>
    <div><a>${escapeHtml(company.phone)}</a></div>
  </div>
</header>

<div class="title-block">
  <div class="title-left">
    <h1>Dokument</h1>
    <div class="doc-title">OFERTA HANDLOWA</div>
  </div>
  <div class="title-right">
    <div class="meta"><b>Data sporządzenia:</b> ${today}</div>
    <div class="meta"><b>Ważność oferty:</b> ${escapeHtml(validity)}</div>
    <div class="meta"><b>Przygotował:</b> ${escapeHtml(author)}</div>
  </div>
</div>

<div class="client-box">
  <div style="flex:1">
    <div class="label">Przygotowano dla</div>
    <div class="value">${escapeHtml(client.name || "—")}</div>
    <div class="addr">${escapeHtml(client.address || "Adres inwestycji — do uzupełnienia")}</div>
  </div>
  <div style="text-align:right">
    <div class="label">Łączny metraż</div>
    <div class="value">${totals.totalArea} m²</div>
  </div>
</div>

<p class="intro">
  ${introHtml || "Szanowni Państwo, dziękujemy za zainteresowanie naszą ofertą. Poniżej przedstawiamy kompletny kosztorys przygotowany indywidualnie pod Państwa inwestycję, uwzględniający obowiązujące stawki VAT oraz — jeśli wybrano tę opcję — symulację finansowania."}
</p>

<div class="section-title">Kosztorys</div>
<table class="pricing">
  <thead>
    <tr>
      <th class="col-lp">Lp.</th>
      <th>Opis usługi / materiału</th>
      <th class="col-qty" style="text-align:right">Ilość</th>
      <th class="col-unit">J.m.</th>
      <th class="col-price" style="text-align:right">Cena jedn.<br/><span style="font-weight:400;opacity:0.7">PLN netto</span></th>
      <th class="col-value" style="text-align:right">Wartość<br/><span style="font-weight:400;opacity:0.7">PLN netto</span></th>
      <th class="col-vat" style="text-align:center">VAT</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div class="totals-row">
  <div class="warranty">
    <h3>Gwarancja</h3>
    <p>
      Na wykonane prace montażowe udzielamy <b>10-letniej gwarancji</b>. Producenci materiałów
      pokryciowych zapewniają gwarancję materiałową <b>do 40 lat</b>. Instalacja fotowoltaiczna
      objęta jest osobną gwarancją producenta paneli oraz falownika (do 25 lat).
    </p>
  </div>
  <div class="summary">
    <table>
      <tr>
        <td class="label">Razem netto</td>
        <td class="value">${fmtPln(totals.netTotal)}</td>
      </tr>
      <tr class="muted">
        <td class="label">${escapeHtml(totals.vatSummaryLabel)}</td>
        <td class="value">${fmtPln(totals.vatTotal)}</td>
      </tr>
    </table>
    <div class="gross">
      <span class="label">Do zapłaty brutto</span>
      <span class="amount">${fmtPln(totals.grossTotal)}</span>
    </div>
    ${
      showDiscount
        ? `<table>
            <tr class="discount">
              <td class="label">Rabat</td>
              <td class="value">− ${fmtPln(cfg.discount)}</td>
            </tr>
            <tr>
              <td class="label">Cena po rabacie</td>
              <td class="value">${fmtPln(totals.afterDiscount)}</td>
            </tr>
          </table>`
        : ""
    }
    ${
      showSubsidy
        ? `<table>
            <tr class="discount">
              <td class="label">Dotacja</td>
              <td class="value">− ${fmtPln(cfg.subsidy)}</td>
            </tr>
          </table>
          <div class="final">
            <span class="label">Koszt końcowy klienta</span>
            <span class="amount">${fmtPln(totals.finalCost)}</span>
          </div>`
        : !showDiscount
        ? ""
        : `<div class="final">
            <span class="label">Koszt końcowy klienta</span>
            <span class="amount">${fmtPln(totals.finalCost)}</span>
          </div>`
    }
    ${
      showInstallment
        ? `<div class="installment">
            <div>
              <div class="label">Eko-Abonament — rata mies.</div>
              <div class="sublabel">${escapeHtml(rrsoLabel)} · ${cfg.months} m-cy</div>
            </div>
            <div>
              <span class="amount">${fmtPln(totals.monthlyInstallment!)}</span><span class="mo"> /mc</span>
            </div>
          </div>`
        : ""
    }
    ${
      totals.isSubsidyExcluded
        ? `<div class="notice">Uwaga: podany kod pocztowy (${escapeHtml(cfg.postalCode || "")}) jest wykluczony z dotacji regionalnej.</div>`
        : ""
    }
  </div>
</div>

<div class="footer">
  Oferta ma charakter informacyjny i nie stanowi oferty handlowej w rozumieniu art. 66 §1 Kodeksu Cywilnego.<br/>
  Finalne warunki współpracy ustalane są indywidualnie w umowie.
</div>

</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
