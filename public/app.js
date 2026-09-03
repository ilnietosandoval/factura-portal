/**
 * app.js — Frontend del portal de facturación.
 * Vanilla JS, sin dependencias, sin build step.
 */

let currentStep = 0;
let transaction = null; // includes .business (issuer data from matched account)
let fiscal = null;
let invoiceResult = null;

const STEPS = ["Buscar ticket", "Verificar", "Datos fiscales", "Factura"];

const $ = (sel) => document.querySelector(sel);
const fmtMoney = (cents) => (cents / 100).toFixed(2).replace(".", ",") + " €";
const fmtDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const fmtDateShort = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
};

function renderSteps() {
  const nav = $("#stepsNav");
  nav.innerHTML = STEPS.map((label, i) => {
    const dotClass = i < currentStep ? "done" : i === currentStep ? "active" : "";
    const labelClass = i < currentStep ? "done" : i === currentStep ? "active" : "";
    const lineClass = i < currentStep ? "done" : "";
    return `
      <div class="step-item">
        <div class="step-dot-wrap">
          <div class="step-dot ${dotClass}">${i < currentStep ? "✓" : i + 1}</div>
          <span class="step-label ${labelClass}">${label}</span>
        </div>
        ${i < STEPS.length - 1 ? `<div class="step-line ${lineClass}"></div>` : ""}
      </div>`;
  }).join("");
}

function render() {
  renderSteps();
  const main = $("#mainContent");
  switch (currentStep) {
    case 0: main.innerHTML = renderSearch(); break;
    case 1: main.innerHTML = renderVerify(); break;
    case 2: main.innerHTML = renderFiscal(); break;
    case 3: main.innerHTML = renderInvoice(); break;
  }
  bindEvents();
}

// ─── Step 0: Search ──────────────────────────────────────────
function renderSearch() {
  return `
    <div class="card">
      <div class="card-center">
        <div class="card-icon">🧾</div>
        <h2 class="card-title">Solicita tu factura</h2>
        <p class="card-subtitle">Introduce el número (N.º) y el importe total que aparecen en tu ticket.</p>
      </div>
      <div class="form-group">
        <label class="form-label">Número de recibo/ticket (N.º)</label>
        <div class="input-wrap">
          <input type="text" id="inputTicket" placeholder="Ej: fpn5" autofocus />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Importe total</label>
        <div class="input-wrap">
          <span class="input-prefix">€</span>
          <input type="text" id="inputAmount" placeholder="Ej: 4,00" class="has-prefix" inputmode="decimal" />
        </div>
      </div>
      <div id="searchError"></div>
      <button class="btn btn-primary btn-block" id="btnSearch">Buscar ticket</button>
      <p class="form-hint">El N.º aparece en la esquina superior derecha de tu ticket de compra.</p>
    </div>`;
}

// ─── Step 1: Verify ──────────────────────────────────────────
function renderVerify() {
  if (!transaction) return "";
  const tx = transaction;
  const base = tx.totalAmount - tx.taxAmount - (tx.tipAmount || 0);
  return `
    <div class="card">
      <div class="tx-header">
        <h2 class="card-title-sm">Detalle del ticket #${tx.receiptNumber}</h2>
        <span class="tx-badge">ENCONTRADO</span>
      </div>
      ${tx.business ? `<div class="tx-meta" style="font-weight:600;color:#555">${tx.business.name}</div>` : ""}
      ${tx.location ? `<div class="tx-meta">${tx.location}</div>` : ""}
      <div class="tx-meta" style="margin-bottom:20px">${fmtDate(tx.date)}</div>
      <div class="items-table-wrap">
        <table class="items-table">
          <thead><tr><th>Concepto</th><th class="center">Ud.</th><th class="right">Importe</th></tr></thead>
          <tbody>
            ${tx.items.map(it => `
              <tr>
                <td${it.name.startsWith("  +") ? ' style="color:#888;font-size:12px"' : ""}>${it.name}</td>
                <td class="center muted">${it.name.startsWith("  +") ? "" : it.qty}</td>
                <td class="right mono${it.name.startsWith("  +") ? " muted" : ""}">${fmtMoney(it.price * it.qty)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="totals">
        <div class="totals-row"><span>Base imponible</span><span class="mono">${fmtMoney(Math.round(base))}</span></div>
        <div class="totals-row"><span>IVA (${tx.taxPercentage}%)</span><span class="mono">${fmtMoney(tx.taxAmount)}</span></div>
        ${tx.tipAmount ? `<div class="totals-row"><span>Propina</span><span class="mono">${fmtMoney(tx.tipAmount)}</span></div>` : ""}
        <div class="totals-total"><span>Total</span><span class="mono">${fmtMoney(tx.totalAmount)}</span></div>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="btnBackToSearch">Atrás</button>
        <button class="btn btn-primary" id="btnConfirm">Es correcto, continuar</button>
      </div>
    </div>`;
}

// ─── Step 2: Fiscal data ─────────────────────────────────────
function renderFiscal() {
  return `
    <div class="card">
      <div class="card-center">
        <h2 class="card-title-sm">Datos de facturación</h2>
        <p class="card-subtitle-sm">Introduce los datos fiscales que aparecerán en tu factura.</p>
      </div>
      <div class="form-group">
        <label class="form-label">NIF / CIF</label>
        <div class="input-wrap" id="wrapNif"><input type="text" id="inputNif" placeholder="Ej: B12345678" autofocus /></div>
        <div class="form-error" id="errNif"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Razón social / Nombre completo</label>
        <div class="input-wrap" id="wrapName"><input type="text" id="inputName" placeholder="Ej: Empresa S.L." /></div>
        <div class="form-error" id="errName"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Dirección</label>
        <div class="input-wrap" id="wrapAddr"><input type="text" id="inputAddr" placeholder="Ej: C/ Mayor 10, 2º Izq" /></div>
        <div class="form-error" id="errAddr"></div>
      </div>
      <div class="form-row">
        <div class="form-group w2">
          <label class="form-label">Ciudad</label>
          <div class="input-wrap" id="wrapCity"><input type="text" id="inputCity" placeholder="Madrid" /></div>
          <div class="form-error" id="errCity"></div>
        </div>
        <div class="form-group">
          <label class="form-label">C.P.</label>
          <div class="input-wrap" id="wrapZip"><input type="text" id="inputZip" placeholder="28001" inputmode="numeric" /></div>
          <div class="form-error" id="errZip"></div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="btnBackToVerify">Atrás</button>
        <button class="btn btn-primary" id="btnGenerate">Generar factura</button>
      </div>
    </div>`;
}

// ─── Step 3: Invoice result ──────────────────────────────────
function renderInvoice() {
  if (!invoiceResult) {
    return `<div class="card loading-card"><div class="spinner">⏳</div><p style="color:#888;font-size:15px">Generando tu factura...</p></div>`;
  }

  const tx = transaction;
  const f = fiscal;
  const inv = invoiceResult;
  const biz = tx.business || {};
  const base = tx.totalAmount - tx.taxAmount - (tx.tipAmount || 0);

  return `
    <div class="card invoice-card">
      <div class="invoice-header">
        <div>
          <div class="invoice-title">FACTURA</div>
          <div class="invoice-num">${inv.invoiceNumber}</div>
        </div>
        <div class="invoice-biz">
          <div class="invoice-biz-name">${biz.name || ""}</div>
          <div class="invoice-biz-detail">CIF: ${biz.cif || ""}</div>
          <div class="invoice-biz-detail">${biz.address || ""}</div>
          ${biz.phone ? `<div class="invoice-biz-detail">${biz.phone}</div>` : ""}
        </div>
      </div>
      <div class="invoice-body">
        <div class="invoice-parties">
          <div>
            <div class="invoice-label">Cliente</div>
            <div class="invoice-client-name">${f.name}</div>
            <div class="invoice-client-detail">${f.nif}</div>
            <div class="invoice-client-detail">${f.address}</div>
            <div class="invoice-client-detail">${f.zip} ${f.city}</div>
          </div>
          <div class="invoice-right">
            <div class="invoice-label">Fecha</div>
            <div class="invoice-date-text">${fmtDateShort(tx.date)}</div>
            <div class="invoice-label" style="margin-top:12px">Nº Ticket</div>
            <div class="invoice-date-text" style="font-family:'DM Mono',monospace">#${tx.receiptNumber}</div>
          </div>
        </div>
        <div class="items-table-wrap">
          <table class="items-table">
            <thead><tr><th>Concepto</th><th class="center">Ud.</th><th class="right">Precio</th><th class="right">Importe</th></tr></thead>
            <tbody>
              ${tx.items.map(it => `
                <tr>
                  <td${it.name.startsWith("  +") ? ' style="color:#888;font-size:12px"' : ""}>${it.name}</td>
                  <td class="center muted">${it.name.startsWith("  +") ? "" : it.qty}</td>
                  <td class="right mono muted">${fmtMoney(it.price)}</td>
                  <td class="right mono">${fmtMoney(it.price * it.qty)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="totals" style="max-width:260px;margin-left:auto">
          <div class="totals-row"><span>Base imponible</span><span class="mono">${fmtMoney(Math.round(base))}</span></div>
          <div class="totals-row"><span>IVA (${tx.taxPercentage}%)</span><span class="mono">${fmtMoney(tx.taxAmount)}</span></div>
          ${tx.tipAmount ? `<div class="totals-row"><span>Propina</span><span class="mono">${fmtMoney(tx.tipAmount)}</span></div>` : ""}
          <div class="totals-total" style="font-size:17px"><span>Total</span><span class="mono">${fmtMoney(tx.totalAmount)}</span></div>
        </div>
      </div>
    </div>
    ${inv.duplicate ? `<div class="alert-error" style="margin-top:20px;background:#fef9c3;border-color:#fde68a;color:#92400e">Este ticket ya tenía una factura emitida (${inv.invoiceNumber}). Puedes descargarla a continuación.</div>` : ""}
    <div class="success-bar">
      <a href="${inv.pdfUrl}" target="_blank" class="btn btn-primary" style="text-align:center;text-decoration:none">📄 Descargar PDF</a>
    </div>
    <div class="reset-link"><button class="btn-link" id="btnReset">Generar otra factura</button></div>`;
}

// ─── Event binding ───────────────────────────────────────────
function bindEvents() {
  const btnSearch = $("#btnSearch");
  if (btnSearch) {
    btnSearch.addEventListener("click", handleSearch);
    ["inputTicket", "inputAmount"].forEach(id => {
      const el = $(`#${id}`);
      if (el) el.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSearch(); });
    });
  }

  const btnBack1 = $("#btnBackToSearch");
  if (btnBack1) btnBack1.addEventListener("click", () => { currentStep = 0; render(); });
  const btnConfirm = $("#btnConfirm");
  if (btnConfirm) btnConfirm.addEventListener("click", () => { currentStep = 2; render(); });

  const btnBack2 = $("#btnBackToVerify");
  if (btnBack2) btnBack2.addEventListener("click", () => { currentStep = 1; render(); });
  const btnGen = $("#btnGenerate");
  if (btnGen) btnGen.addEventListener("click", handleGenerate);

  const btnReset = $("#btnReset");
  if (btnReset) btnReset.addEventListener("click", () => {
    currentStep = 0; transaction = null; fiscal = null; invoiceResult = null; render();
  });
}

// ─── API calls ───────────────────────────────────────────────
async function handleSearch() {
  const ticket = ($("#inputTicket")?.value || "").trim();
  const rawAmount = ($("#inputAmount")?.value || "").trim();
  const errorDiv = $("#searchError");
  const btn = $("#btnSearch");

  if (!ticket || !rawAmount) { errorDiv.innerHTML = `<div class="alert-error">Rellena ambos campos.</div>`; return; }

  const amount = rawAmount.replace(",", ".");
  if (isNaN(parseFloat(amount))) { errorDiv.innerHTML = `<div class="alert-error">El importe no es válido.</div>`; return; }

  errorDiv.innerHTML = "";
  btn.disabled = true;
  btn.innerHTML = `<span class="btn-spinner"></span> Buscando ticket en el sistema...`;

  // Mostrar barra de progreso animada debajo del botón
  const hint = document.querySelector(".form-hint");
  if (hint) hint.innerHTML = `<span class="search-progress"><span class="search-progress-bar"></span></span><br>Esta búsqueda puede tardar hasta 3 minutos. No recargue la página.`;

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiptNumber: ticket, amount }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorDiv.innerHTML = `<div class="alert-error">${data.error}</div>`;
      btn.disabled = false; btn.innerHTML = "Buscar ticket"; return;
    }
    transaction = data;
    currentStep = 1;
    render();
  } catch (err) {
    errorDiv.innerHTML = `<div class="alert-error">Error de conexión. Inténtalo de nuevo.</div>`;
    btn.disabled = false; btn.innerHTML = "Buscar ticket";
  }
}

async function handleGenerate() {
  const fields = {
    nif: ($("#inputNif")?.value || "").trim(),
    name: ($("#inputName")?.value || "").trim(),
    address: ($("#inputAddr")?.value || "").trim(),
    city: ($("#inputCity")?.value || "").trim(),
    zip: ($("#inputZip")?.value || "").trim(),
  };

  let hasError = false;
  ["nif", "name", "address", "city", "zip"].forEach((key) => {
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    const errEl = $(`#err${label}`);
    const wrapEl = $(`#wrap${label}`);
    if (!fields[key]) {
      if (errEl) errEl.textContent = "Obligatorio";
      if (wrapEl) wrapEl.classList.add("error");
      hasError = true;
    } else {
      if (errEl) errEl.textContent = "";
      if (wrapEl) wrapEl.classList.remove("error");
    }
  });

  if (hasError) return;

  fiscal = fields;
  currentStep = 3;
  invoiceResult = null;
  render();

  try {
    const res = await fetch("/api/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction, fiscal }),
    });
    const data = await res.json();
    if (res.status === 409 && data.pdfUrl) {
      // Ya existe factura para este ticket — mostrarla
      invoiceResult = { invoiceNumber: data.invoiceNumber, pdfUrl: data.pdfUrl, duplicate: true };
      render();
      return;
    }
    if (!res.ok) { alert(data.error || "Error generando la factura."); currentStep = 2; render(); return; }
    invoiceResult = data;
    render();
  } catch (err) {
    alert("Error de conexión. Inténtalo de nuevo.");
    currentStep = 2; render();
  }
}

render();
