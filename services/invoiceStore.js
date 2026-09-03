/**
 * services/invoiceStore.js
 * Gestiona la numeración correlativa de facturas y guarda un registro.
 *
 * NOTA: Usa un fichero JSON como almacenamiento simple.
 * En producción, reemplazar por una base de datos para evitar problemas de concurrencia.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const COUNTER_FILE = path.join(DATA_DIR, "counter.json");
const RECORDS_FILE = path.join(DATA_DIR, "invoices.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// Formato: FRA-2026/0001, FRA-2026/0002, ...
function nextInvoiceNumber() {
  const prefix = process.env.INVOICE_PREFIX || "FRA";
  const year = new Date().getFullYear();
  const counter = readJSON(COUNTER_FILE, { year: 0, seq: 0 });

  if (counter.year !== year) { counter.year = year; counter.seq = 0; }
  counter.seq += 1;
  writeJSON(COUNTER_FILE, counter);

  return `${prefix}-${year}/${String(counter.seq).padStart(4, "0")}`;
}

function saveInvoiceRecord(record) {
  const records = readJSON(RECORDS_FILE, []);
  records.push(record);
  writeJSON(RECORDS_FILE, records);
}

function getAllRecords() {
  return readJSON(RECORDS_FILE, []);
}

function hasInvoiceForReceipt(receiptNumber) {
  const records = readJSON(RECORDS_FILE, []);
  return records.find((r) => r.receiptNumber === receiptNumber) || null;
}

module.exports = { nextInvoiceNumber, saveInvoiceRecord, getAllRecords, hasInvoiceForReceipt };
