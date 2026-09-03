/**
 * services/email.js
 * Envía facturas por email usando Nodemailer.
 */

const nodemailer = require("nodemailer");
const path = require("path");

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host, port, secure: port === 465, auth: { user, pass },
  });
}

async function sendInvoice({ to, invoiceNumber, pdfPath, businessName }) {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn("⚠️  Email no configurado (faltan datos SMTP en .env). Factura no enviada.");
    return false;
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `Tu factura ${invoiceNumber} — ${businessName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 0;">
        <h2 style="color: #1a1a1a; font-size: 20px; margin-bottom: 8px;">Tu factura está lista</h2>
        <p style="color: #666; font-size: 14px; line-height: 1.6;">
          Adjuntamos la factura <strong>${invoiceNumber}</strong> correspondiente a tu compra en
          <strong>${businessName}</strong>.
        </p>
        <p style="color: #666; font-size: 14px; line-height: 1.6;">
          Si tienes cualquier duda, no dudes en contactarnos respondiendo a este email.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 11px;">
          ${businessName} · Este email se ha generado automáticamente desde el portal de facturación.
        </p>
      </div>
    `,
    attachments: [{ filename: path.basename(pdfPath), path: pdfPath, contentType: "application/pdf" }],
  });

  console.log(`📧 Factura ${invoiceNumber} enviada a ${to}`);
  return true;
}

module.exports = { sendInvoice };
