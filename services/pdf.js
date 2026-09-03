/**
 * services/pdf.js
 * Genera facturas en PDF con diseño profesional.
 * Una sola página salvo que haya muchos items.
 */

const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const INVOICES_DIR = path.join(__dirname, "..", "data", "invoices");

if (!fs.existsSync(INVOICES_DIR)) {
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
}

const fmt = (cents, currency = "EUR") => {
  const val = (cents / 100).toFixed(2);
  return currency === "EUR" ? `${val.replace(".", ",")} €` : `$${val}`;
};

const fmtDate = (isoStr) => {
  const d = new Date(isoStr);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
};

const C = {
  black: "#1a1a1a", dark: "#333333", mid: "#666666",
  light: "#999999", pale: "#e5e5e5", white: "#ffffff",
};

// Helper: write text at exact position, no chaining, no auto line break
function txt(doc, text, x, y, opts = {}) {
  doc.text(text, x, y, { lineBreak: false, ...opts });
}

async function generateInvoice({ invoiceNumber, transaction, fiscal, business }) {
  return new Promise((resolve, reject) => {
    const fileName = `${invoiceNumber.replace(/\//g, "-")}.pdf`;
    const filePath = path.join(INVOICES_DIR, fileName);
    const writeStream = fs.createWriteStream(filePath);

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 55, right: 55 },
      bufferPages: true,
    });

    doc.pipe(writeStream);

    const pw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const lx = doc.page.margins.left;
    const rx = 340;
    const pageH = doc.page.height;

    // ── Header bar ──────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 100).fill(C.black);

    doc.font("Helvetica-Bold").fontSize(22).fillColor(C.white);
    txt(doc, "FACTURA", lx, 30);

    doc.font("Helvetica").fontSize(10).fillColor("#aaaaaa");
    txt(doc, invoiceNumber, lx, 56);

    doc.font("Helvetica-Bold").fontSize(10).fillColor(C.white);
    txt(doc, business.name, rx, 28, { width: 210, align: "right" });

    doc.font("Helvetica").fontSize(8).fillColor("#cccccc");
    txt(doc, `CIF: ${business.cif}`, rx, 44, { width: 210, align: "right" });
    txt(doc, business.address, rx, 56, { width: 210, align: "right" });
    if (business.phone) {
      txt(doc, `Tel: ${business.phone}`, rx, 68, { width: 210, align: "right" });
    }

    // ── Client data (left) ──────────────────────────────
    let y = 125;
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.light);
    txt(doc, "DATOS DEL CLIENTE", lx, y);

    y += 14;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(C.black);
    txt(doc, fiscal.name, lx, y);

    y += 16;
    doc.font("Helvetica").fontSize(9).fillColor(C.mid);
    txt(doc, `NIF/CIF: ${fiscal.nif}`, lx, y);
    y += 13;
    txt(doc, fiscal.address, lx, y);
    y += 13;
    txt(doc, `${fiscal.zip} ${fiscal.city}`, lx, y);

    // ── Date & ticket (right) ───────────────────────────
    let ry = 125;
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.light);
    txt(doc, "FECHA DE EMISIÓN", rx, ry, { width: 210, align: "right" });
    ry += 14;
    doc.font("Helvetica").fontSize(10).fillColor(C.dark);
    txt(doc, fmtDate(transaction.date), rx, ry, { width: 210, align: "right" });

    ry += 24;
    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.light);
    txt(doc, "Nº RECIBO/TICKET", rx, ry, { width: 210, align: "right" });
    ry += 14;
    doc.font("Helvetica").fontSize(10).fillColor(C.dark);
    txt(doc, `#${transaction.receiptNumber}`, rx, ry, { width: 210, align: "right" });

    if (transaction.location) {
      ry += 24;
      doc.font("Helvetica-Bold").fontSize(7).fillColor(C.light);
      txt(doc, "UBICACIÓN", rx, ry, { width: 210, align: "right" });
      ry += 14;
      doc.font("Helvetica").fontSize(8).fillColor(C.dark);
      txt(doc, transaction.location, rx, ry, { width: 210, align: "right" });
    }

    // ── Separator ───────────────────────────────────────
    y = Math.max(y, ry) + 25;
    doc.moveTo(lx, y).lineTo(lx + pw, y).strokeColor(C.pale).lineWidth(1).stroke();
    y += 12;

    // ── Items table header ──────────────────────────────
    const cC = lx;
    const cU = lx + 280;
    const cP = lx + 340;
    const cI = lx + pw - 70;

    doc.font("Helvetica-Bold").fontSize(7).fillColor(C.light);
    txt(doc, "CONCEPTO", cC, y);
    txt(doc, "UDS.", cU, y, { width: 40, align: "center" });
    txt(doc, "PRECIO", cP, y, { width: 60, align: "right" });
    txt(doc, "IMPORTE", cI, y, { width: 70, align: "right" });

    y += 10;
    doc.moveTo(lx, y).lineTo(lx + pw, y).strokeColor(C.pale).lineWidth(0.5).stroke();
    y += 8;

    // ── Items ───────────────────────────────────────────
    const items = transaction.items || [];
    const footerSpace = 120; // space needed for totals + footer

    for (const item of items) {
      // Check if we need a new page
      if (y > pageH - footerSpace - 40) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      const isMod = item.name.startsWith("  +");

      if (isMod) {
        doc.font("Helvetica").fontSize(8).fillColor(C.light);
        txt(doc, item.name, cC + 10, y);
        txt(doc, fmt(item.price * item.qty, transaction.currency), cI, y, { width: 70, align: "right" });
        y += 14;
      } else {
        doc.font("Helvetica").fontSize(9).fillColor(C.dark);
        txt(doc, item.name, cC, y);
        txt(doc, String(item.qty), cU, y, { width: 40, align: "center" });
        doc.fillColor(C.mid);
        txt(doc, fmt(item.price, transaction.currency), cP, y, { width: 60, align: "right" });
        doc.fillColor(C.dark);
        txt(doc, fmt(item.price * item.qty, transaction.currency), cI, y, { width: 70, align: "right" });
        y += 18;
      }

      doc.moveTo(lx, y - 4).lineTo(lx + pw, y - 4).strokeColor("#f0f0f0").lineWidth(0.5).stroke();
    }

    // ── Totals ──────────────────────────────────────────
    y += 8;
    const tx2 = lx + 300;

    doc.moveTo(tx2, y).lineTo(lx + pw, y).strokeColor(C.pale).lineWidth(1).stroke();
    y += 10;

    const tipAmount = transaction.tipAmount || 0;
    const baseAmount = transaction.totalAmount - transaction.taxAmount - tipAmount;

    doc.font("Helvetica").fontSize(9).fillColor(C.mid);
    txt(doc, "Base imponible", tx2, y);
    txt(doc, fmt(baseAmount, transaction.currency), cI, y, { width: 70, align: "right" });

    y += 16;
    txt(doc, `IVA (${transaction.taxPercentage}%)`, tx2, y);
    txt(doc, fmt(transaction.taxAmount, transaction.currency), cI, y, { width: 70, align: "right" });

    if (tipAmount > 0) {
      y += 16;
      txt(doc, "Propina", tx2, y);
      txt(doc, fmt(tipAmount, transaction.currency), cI, y, { width: 70, align: "right" });
    }

    y += 20;
    doc.moveTo(tx2, y).lineTo(lx + pw, y).strokeColor(C.pale).lineWidth(1).stroke();
    y += 8;

    doc.font("Helvetica-Bold").fontSize(14).fillColor(C.black);
    txt(doc, "TOTAL", tx2, y);
    txt(doc, fmt(transaction.totalAmount, transaction.currency), cI - 10, y, { width: 80, align: "right" });

    // ── Footer (always on last page, at bottom) ─────────
    const lastPage = doc.bufferedPageRange().count - 1;
    doc.switchToPage(lastPage);

    const fy = pageH - 55;
    doc.moveTo(lx, fy).lineTo(lx + pw, fy).strokeColor(C.pale).lineWidth(0.5).stroke();

    doc.font("Helvetica").fontSize(7).fillColor(C.light);

    // Centrar manualmente — width+align cerca del borde causa páginas extra en PDFKit
    const footerLine1 = `${business.name} · CIF: ${business.cif} · ${business.address}`;
    const footerLine2 = `Factura generada electrónicamente · ${invoiceNumber}`;
    const fw1 = doc.widthOfString(footerLine1);
    const fw2 = doc.widthOfString(footerLine2);
    txt(doc, footerLine1, lx + (pw - fw1) / 2, fy + 8);
    txt(doc, footerLine2, lx + (pw - fw2) / 2, fy + 22);

    doc.end();
    writeStream.on("finish", () => resolve(filePath));
    writeStream.on("error", reject);
  });
}

module.exports = { generateInvoice };
