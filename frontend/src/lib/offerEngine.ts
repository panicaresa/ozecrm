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
  beforeBase64?: string | null; // "data:image/jpeg;base64,..." or raw base64
  afterBase64?: string | null;
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
  logoDataUrl?: string; // base64 data-url of brand logo (offline-safe)
  intro?: string; // editable intro paragraph shown above the pricing table
}

function normalizeImgSrc(v?: string | null): string | null {
  if (!v) return null;
  if (v.startsWith("data:")) return v;
  return `data:image/jpeg;base64,${v}`;
}

export function buildOfferHtml(ctx: PdfContext): string {
  const { buildings, totals, cfg, client, author, validity, company, rrsoLabel, logoDataUrl, intro } = ctx;
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

  // Logo: EMBEDDED base64 ONLY — guarantees rendering in expo-print (native WebView)
  // even in fully offline mode. Remote URL fetches are unreliable during PDF rasterization.
  const headerLogo = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="Grupa OZE" style="height:42px;width:auto;display:block" />`
    : `<div style="font-weight:900;letter-spacing:-1px;font-size:22px;color:#0B2545">GRUPA <span style="color:#30A0E3">OZE</span></div>`;

  const showDiscount = cfg.discountEnabled && cfg.discount > 0;
  const showSubsidy = cfg.subsidyEnabled && cfg.subsidy > 0;
  const showInstallment = cfg.installments && totals.monthlyInstallment !== null;
  const finalPayable = showSubsidy || showDiscount ? totals.finalCost : totals.grossTotal;

  const introHtml = (intro || "").trim()
    ? escapeHtml(intro!).replace(/\n/g, "<br/>")
    : "";

  // Before/After visualizations — only buildings that have at least one image
  const visualBuildings = buildings.filter((b) => b.beforeBase64 || b.afterBase64);
  const visualsHtml = visualBuildings
    .map((b) => {
      const before = normalizeImgSrc(b.beforeBase64);
      const after = normalizeImgSrc(b.afterBase64);
      const cell = (src: string | null, caption: string, tone: string) =>
        src
          ? `<figure class="viz-cell">
                <div class="viz-img"><img src="${src}" alt="${escapeHtml(caption)}" /></div>
                <figcaption class="viz-cap" style="background:${tone}">${escapeHtml(caption)}</figcaption>
              </figure>`
          : `<figure class="viz-cell viz-empty">
                <div class="viz-img viz-img-empty">brak zdjęcia</div>
                <figcaption class="viz-cap" style="background:${tone}">${escapeHtml(caption)}</figcaption>
              </figure>`;
      return `
        <div class="viz-block">
          <div class="viz-title">${escapeHtml(b.name)} — wizualizacja modernizacji</div>
          <div class="viz-row">
            ${cell(before, "Stan obecny", "#64748B")}
            ${cell(after, "Wizualizacja po modernizacji", "#30A0E3")}
          </div>
        </div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8"/>
<title>Oferta Handlowa — ${escapeHtml(client.name || "Klient")}</title>
<style>
  *{box-sizing:border-box}
  @page{size:A4;margin:12mm 10mm}
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0B1220;font-size:11px;line-height:1.45}
  .doc{padding:0}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #30A0E3;padding-bottom:10px;margin-bottom:14px;page-break-inside:avoid}
  .firm{font-size:10px;color:#475569;line-height:1.5;text-align:right}
  .firm .firm-name{font-weight:800;color:#0B2545;font-size:11px}
  .firm a{color:#30A0E3;text-decoration:none}
  .title-block{margin-bottom:12px;display:flex;justify-content:space-between;gap:18px;page-break-inside:avoid}
  .title-left h1{margin:0;font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:2px;font-weight:700}
  .title-left .doc-title{font-size:22px;font-weight:900;color:#0B2545;letter-spacing:-1px;margin-top:2px;line-height:1.1}
  .title-right{text-align:right;font-size:10px;color:#64748B}
  .title-right .meta{margin:2px 0}
  .title-right b{color:#0B1220}
  .client-box{background:#F1F5F9;border-left:4px solid #30A0E3;padding:10px 14px;border-radius:6px;margin-bottom:12px;display:flex;justify-content:space-between;gap:16px;page-break-inside:avoid}
  .client-box .label{font-size:9px;color:#64748B;text-transform:uppercase;letter-spacing:1.2px;font-weight:700;margin-bottom:2px}
  .client-box .value{font-size:13px;color:#0B2545;font-weight:700}
  .client-box .addr{font-size:11px;color:#475569;margin-top:1px}
  .intro{color:#334155;line-height:1.55;margin:0 0 12px 0;text-align:justify;font-size:11px}
  .section-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#64748B;margin:10px 0 6px 0;padding-bottom:4px;border-bottom:1px solid #E2E8F0}
  /* Visualizations */
  .viz-block{page-break-inside:avoid;margin-bottom:12px}
  .viz-title{font-size:11px;font-weight:700;color:#0B2545;margin-bottom:6px}
  .viz-row{display:flex;gap:10px;page-break-inside:avoid}
  .viz-cell{flex:1;margin:0;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;background:#fff;page-break-inside:avoid}
  .viz-img{width:100%;height:150px;overflow:hidden;background:#F1F5F9;display:flex;align-items:center;justify-content:center}
  .viz-img img{width:100%;height:100%;object-fit:cover;display:block}
  .viz-img-empty{color:#94A3B8;font-size:10px;font-style:italic}
  .viz-empty{opacity:0.7}
  .viz-cap{color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;text-align:center;padding:6px 8px}
  /* Pricing table */
  table.pricing{width:100%;border-collapse:collapse;font-size:10px;page-break-inside:auto}
  table.pricing thead{display:table-header-group}
  table.pricing tr{page-break-inside:avoid}
  table.pricing thead th{background:#0B2545;color:#fff;text-align:left;padding:7px 6px;font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:700}
  table.pricing thead th:first-child{border-top-left-radius:6px}
  table.pricing thead th:last-child{border-top-right-radius:6px}
  table.pricing tbody tr{border-bottom:1px solid #E2E8F0}
  table.pricing tbody tr:nth-child(even){background:#F8FAFC}
  table.pricing td{padding:8px 6px;vertical-align:top}
  .col-lp{width:26px;font-weight:700;color:#64748B;text-align:center}
  .col-desc{font-size:11px}
  .row-title{font-weight:700;color:#0B2545}
  .row-sub{font-size:9px;color:#64748B;margin-top:2px}
  .col-qty{width:42px;text-align:right;font-weight:600}
  .col-unit{width:34px;color:#64748B}
  .col-price,.col-value{width:78px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .col-value{font-weight:700;color:#0B2545}
  .col-vat{width:70px;text-align:center}
  .vat-badge{display:inline-block;padding:2px 7px;border-radius:999px;background:#E0F2FE;color:#0369A1;font-weight:700;font-size:9px}
  /* Totals row — avoid split */
  .totals-row{display:flex;gap:12px;margin-top:14px;align-items:flex-start;page-break-inside:avoid}
  .warranty{flex:1;background:#EFF6FF;border:1px solid #BFDBFE;border-left:4px solid #30A0E3;padding:12px;border-radius:8px;page-break-inside:avoid}
  .warranty h3{margin:0 0 4px 0;font-size:11px;color:#0B2545;text-transform:uppercase;letter-spacing:1px;font-weight:800}
  .warranty p{margin:0;color:#1e3a5f;font-size:10px;line-height:1.5}
  .summary{flex:1.1;background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:2px 12px;page-break-inside:avoid}
  .summary table{width:100%;border-collapse:collapse}
  .summary td{padding:6px 0;font-size:11px;border-bottom:1px solid #F1F5F9}
  .summary tr:last-child td{border-bottom:none}
  .summary .label{color:#475569}
  .summary .value{text-align:right;font-weight:700;color:#0B1220;font-variant-numeric:tabular-nums;white-space:nowrap}
  .summary .muted .value{color:#64748B}
  .summary .discount .value{color:#EF4444}
  .summary .gross{background:#0B2545;color:#fff;padding:10px 12px;border-radius:8px;margin:8px -12px;display:flex;justify-content:space-between;align-items:center;page-break-inside:avoid}
  .summary .gross .label{color:#B6C5DB;font-size:9px;text-transform:uppercase;letter-spacing:1.3px;font-weight:700}
  .summary .gross .amount{font-size:18px;font-weight:900;letter-spacing:-0.5px}
  .summary .final{background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;padding:8px 10px;margin:4px -4px;display:flex;justify-content:space-between;align-items:center;page-break-inside:avoid}
  .summary .final .label{color:#166534;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px}
  .summary .final .amount{color:#166534;font-size:15px;font-weight:900}
  .installment{background:#30A0E3;color:#fff;padding:10px 12px;border-radius:8px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;page-break-inside:avoid;page-break-before:avoid}
  .installment .label{font-size:9px;text-transform:uppercase;letter-spacing:1.3px;font-weight:700;opacity:0.92}
  .installment .sublabel{font-size:9px;opacity:0.85;margin-top:1px}
  .installment .amount{font-size:18px;font-weight:900}
  .installment .mo{font-size:10px;opacity:0.9}
  .notice{margin-top:8px;padding:8px 10px;background:#FEF2F2;border-left:3px solid #EF4444;border-radius:4px;color:#991B1B;font-size:10px;page-break-inside:avoid}
  .footer{margin-top:16px;padding-top:8px;border-top:1px solid #E2E8F0;text-align:center;font-size:8px;color:#94A3B8;line-height:1.5;page-break-inside:avoid;page-break-before:avoid}
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
${visualsHtml ? `<div class="section-title" style="margin-top:14px">Wizualizacje</div>${visualsHtml}` : ""}
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
