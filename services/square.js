/**
 * services/square.js
 * Conecta con las 2 cuentas de Square y busca transacciones
 * por número de ticket (receipt_number) + importe.
 */

const { SquareClient, SquareEnvironment } = require("square");

// ─── Crear clientes para cada cuenta ─────────────────────────
function buildClients() {
  const environment =
    process.env.SQUARE_ENVIRONMENT === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox;

  const accounts = [];

  if (process.env.SQUARE_ACCESS_TOKEN_1) {
    accounts.push({
      index: 1,
      label: "Scarlett Ópera",
      client: new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN_1, environment }),
      locationId: process.env.SQUARE_LOCATION_ID_1,
    });
  }

  if (process.env.SQUARE_ACCESS_TOKEN_2) {
    accounts.push({
      index: 2,
      label: "Scarlett Atocha",
      client: new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN_2, environment }),
      locationId: process.env.SQUARE_LOCATION_ID_2,
    });
  }

  if (accounts.length === 0) {
    console.warn("⚠️  No hay tokens de Square configurados en .env");
  }

  return accounts;
}

const accounts = buildClients();

// ─── Buscar transacción por receipt_number + importe ─────────
async function findTransaction(receiptNumber, amountCents) {
  const results = await Promise.allSettled(
    accounts.map((acc) => searchInAccount(acc, receiptNumber, amountCents))
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      return result.value;
    }
  }

  return null;
}

// ─── Buscar en una cuenta concreta ───────────────────────────
async function searchInAccount(account, receiptNumber, amountCents) {
  const { client, locationId, label, index } = account;

  const daysBack = parseInt(process.env.SEARCH_DAYS_BACK || "90", 10);
  const beginTime = new Date();
  beginTime.setDate(beginTime.getDate() - daysBack);

  let found = null;

  try {
    // Filtrar por importe exacto (total) para que Square solo devuelva
    // los pagos con ese importe — muchísimo más rápido que recorrer todos.
    const page = await client.payments.list({
      locationId,
      beginTime: beginTime.toISOString(),
      endTime: new Date().toISOString(),
      sortOrder: "DESC",
      total: BigInt(amountCents),
    });

    for await (const payment of page) {
      if (payment.receiptNumber?.toLowerCase() === receiptNumber.toLowerCase()) {
        found = payment;
        break;
      }
    }
  } catch (err) {
    console.error(`Error buscando en ${label}:`, err.message);
    if (err.body) console.error(`Detalle:`, JSON.stringify(err.body));

    // Fallback: si el filtro total falla, buscar sin él
    try {
      console.log(`Reintentando ${label} sin filtro total...`);
      const page = await client.payments.list({
        locationId,
        beginTime: beginTime.toISOString(),
        endTime: new Date().toISOString(),
        sortOrder: "DESC",
      });
      for await (const payment of page) {
        const paymentAmount = Number(payment.totalMoney?.amount ?? 0);
        if (payment.receiptNumber?.toLowerCase() === receiptNumber.toLowerCase() && paymentAmount === amountCents) {
          found = payment;
          break;
        }
      }
    } catch (err2) {
      console.error(`Error en fallback ${label}:`, err2.message);
      return null;
    }
  }

  if (!found) {
    console.log(`No encontrado en ${label}`);
    return null;
  }

  console.log(`✅ Ticket ${receiptNumber} encontrado en ${label}`);

  // Obtener detalle del pedido (line items)
  let orderDetails = null;
  if (found.orderId) {
    try {
      orderDetails = await client.orders.get({ orderId: found.orderId });
    } catch (err) {
      console.error(`Error obteniendo pedido ${found.orderId}:`, err.message);
    }
  }

  // Obtener info de la ubicación (opcional, puede fallar por permisos)
  let locationInfo = null;
  try {
    locationInfo = await client.locations.get({ locationId });
  } catch (_) {
    // No pasa nada, la ubicación se muestra desde los datos del .env
  }

  try {
    return normalizeTransaction(found, orderDetails, locationInfo, index);
  } catch (err) {
    console.error(`❌ Error normalizando transacción:`, err.message, err.stack);
    // Devolver datos mínimos si la normalización falla
    return {
      accountIndex: index,
      receiptNumber: found.receiptNumber,
      paymentId: found.id,
      orderId: found.orderId,
      totalAmount: Number(found.totalMoney?.amount ?? 0),
      currency: found.totalMoney?.currency || "EUR",
      taxPercentage: 0,
      taxAmount: 0,
      date: found.createdAt,
      location: "",
      items: [],
    };
  }
}

// ─── Normalizar datos para el frontend ───────────────────────
function normalizeTransaction(payment, order, location, accountIndex) {
  // El pedido viene envuelto: { order: { lineItems, totalTaxMoney, ... } }
  const actualOrder = order?.order || order;

  // Extraer line items con modificadores como sub-líneas
  const items = [];
  const lineItems = actualOrder?.lineItems || [];
  for (const li of lineItems) {
    const basePrice = Number(li.basePriceMoney?.amount ?? 0);
    const qty = Number(li.quantity) || 1;

    // Artículo principal
    items.push({
      name: li.name || "Artículo",
      qty,
      price: basePrice,
    });

    // Modificadores como líneas separadas (ej: "+ Leche Avena")
    const modifiers = li.modifiers || [];
    for (const m of modifiers) {
      const modPrice = Number(m.basePriceMoney?.amount ?? 0);
      items.push({
        name: `  + ${m.name || "Modificador"}`,
        qty: qty,
        price: modPrice,
      });
    }
  }

  // Total del pago (incluye propina)
  const totalAmount = Number(payment.totalMoney?.amount ?? 0);

  // Propina
  const tipAmount = Number(payment.tipMoney?.amount ?? actualOrder?.totalTipMoney?.amount ?? 0);

  // Impuestos — base imponible = total - IVA - propina (la propina NO lleva IVA)
  let taxPercentage = 0;
  let taxAmount = 0;
  const taxMoney = actualOrder?.totalTaxMoney;
  if (taxMoney?.amount) {
    taxAmount = Number(taxMoney.amount);
    const baseImponible = totalAmount - taxAmount - tipAmount;
    if (baseImponible > 0) {
      taxPercentage = Math.round((taxAmount / baseImponible) * 100);
    }
  }

  // Ubicación
  let locationName = "";
  if (location) {
    const loc = location?.location || location;
    const addr = loc?.address || {};
    locationName = [
      loc.businessName || loc.name || "",
      addr.addressLine1 || "",
      addr.locality || "",
    ]
      .filter(Boolean)
      .join(" — ");
  }

  console.log(`📋 Resultado: ${items.length} items, IVA=${taxAmount}c (${taxPercentage}%), Propina=${tipAmount}c, Total=${totalAmount}c`);

  return {
    accountIndex,
    receiptNumber: payment.receiptNumber,
    paymentId: payment.id,
    orderId: payment.orderId,
    totalAmount,
    currency: payment.totalMoney?.currency || "EUR",
    taxPercentage,
    taxAmount,
    tipAmount,
    date: payment.createdAt,
    location: locationName,
    items,
  };
}

module.exports = { findTransaction };
