require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const squareService = require("./services/square");
const pdfService = require("./services/pdf");
const emailService = require("./services/email");
const invoiceStore = require("./services/invoiceStore");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Datos fiscales por cuenta ───────────────────────────────
// Cada cuenta de Square tiene su propia razón social, CIF, etc.
function getBusinessData(accountIndex) {
  const i = accountIndex || 1;
  return {
    name:    process.env[`BUSINESS_NAME_${i}`]    || process.env.BUSINESS_NAME    || "",
    cif:     process.env[`BUSINESS_CIF_${i}`]     || process.env.BUSINESS_CIF     || "",
    address: process.env[`BUSINESS_ADDRESS_${i}`] || process.env.BUSINESS_ADDRESS || "",
    phone:   process.env[`BUSINESS_PHONE_${i}`]   || process.env.BUSINESS_PHONE   || "",
    email:   process.env[`BUSINESS_EMAIL_${i}`]   || process.env.BUSINESS_EMAIL   || "",
  };
}

// ─── Health check ────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── 1. Buscar ticket ────────────────────────────────────────
app.post("/api/search", async (req, res) => {
  try {
    const { receiptNumber, amount } = req.body;

    if (!receiptNumber || !amount) {
      return res.status(400).json({ error: "Número de ticket e importe son obligatorios." });
    }

    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: "Importe no válido." });
    }

    const result = await squareService.findTransaction(receiptNumber.trim(), amountCents);

    if (!result) {
      return res.status(404).json({
        error: "No hemos encontrado ninguna transacción con ese número de ticket e importe. Revisa los datos e inténtalo de nuevo.",
      });
    }

    // Adjuntar los datos fiscales del emisor correspondiente
    const business = getBusinessData(result.accountIndex);
    result.business = business;

    res.json(result);
  } catch (err) {
    console.error("Error en /api/search:", err);
    res.status(500).json({ error: "Error interno del servidor. Inténtalo de nuevo más tarde." });
  }
});

// ─── 2. Generar factura PDF ──────────────────────────────────
app.post("/api/invoice", async (req, res) => {
  try {
    const { transaction, fiscal } = req.body;

    if (!transaction || !fiscal) {
      return res.status(400).json({ error: "Datos de transacción y fiscales son obligatorios." });
    }

    if (!fiscal.nif || !fiscal.name || !fiscal.address || !fiscal.city || !fiscal.zip) {
      return res.status(400).json({ error: "Faltan datos fiscales obligatorios." });
    }

    // Comprobar si este ticket ya tiene factura emitida
    const existing = invoiceStore.hasInvoiceForReceipt(transaction.receiptNumber);
    if (existing) {
      return res.status(409).json({
        error: `Este ticket ya tiene una factura emitida (${existing.invoiceNumber}).`,
        invoiceNumber: existing.invoiceNumber,
        pdfUrl: `/invoices/${require("path").basename(existing.pdfPath)}`,
      });
    }

    // Resolver datos del emisor según la cuenta donde se encontró el ticket
    const business = getBusinessData(transaction.accountIndex);

    // Generar número de factura correlativo
    const invoiceNumber = invoiceStore.nextInvoiceNumber();

    // Generar PDF
    const pdfPath = await pdfService.generateInvoice({
      invoiceNumber,
      transaction,
      fiscal,
      business,
    });

    // Guardar registro de factura emitida
    invoiceStore.saveInvoiceRecord({
      invoiceNumber,
      receiptNumber: transaction.receiptNumber,
      accountIndex: transaction.accountIndex,
      fiscal,
      amount: transaction.totalAmount,
      businessCif: business.cif,
      createdAt: new Date().toISOString(),
      pdfPath,
    });

    // Enviar por email si se proporcionó
    let emailSent = false;
    if (fiscal.email) {
      try {
        await emailService.sendInvoice({
          to: fiscal.email,
          invoiceNumber,
          pdfPath,
          businessName: business.name,
        });
        emailSent = true;
      } catch (emailErr) {
        console.error("Error enviando email:", emailErr);
      }
    }

    res.json({
      invoiceNumber,
      pdfUrl: `/invoices/${path.basename(pdfPath)}`,
      emailSent,
    });
  } catch (err) {
    console.error("Error en /api/invoice:", err);
    res.status(500).json({ error: "Error generando la factura. Inténtalo de nuevo." });
  }
});

// ─── Servir PDFs generados ───────────────────────────────────
app.use("/invoices", express.static(path.join(__dirname, "data", "invoices")));

// ─── Fallback: servir el frontend ────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Arrancar servidor ───────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🧾 Portal de facturación arrancado en http://localhost:${PORT}\n`);
});
