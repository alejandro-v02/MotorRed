// Concesionario FALSO mínimo, para probar TiendaBuscadorService de punta a punta sin el
// servicio real: implementa solo las rutas REST que usamos, con las mismas reglas de negocio
// documentadas en docs/contratos-reales/documentacion-api-repuestos.xlsx (disponible = físico -
// reservado, nunca negativo; "desdeReserva" consume lo reservado y baja el físico).
//   node pruebas/repuestos-falso.mjs [puerto]
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PUERTO = Number(process.argv[2] ?? 3002);

// Catálogo de práctica con los mismos codigo_repuesto que usan pruebas/probar-facturacion.mjs y
// probar-reparacion.mjs, para que las pruebas existentes encuentren un sku exacto.
const repuestos = new Map([
  ['AMO-DEL-GAS', { id: randomUUID(), sku: 'AMO-DEL-GAS', nombre: 'Amortiguador delantero a gas', precio: 144150 }],
  ['PAS-DEL-CER', { id: randomUUID(), sku: 'PAS-DEL-CER', nombre: 'Pastilla de freno delantera cerámica', precio: 172050 }],
  ['FIL-ACE-STD', { id: randomUUID(), sku: 'FIL-ACE-STD', nombre: 'Filtro de aceite', precio: 28000 }],
]);
const porId = new Map([...repuestos.values()].map((r) => [r.id, r]));
// stock[repuestoId][bodega] = { cantidad, reservada }
const stock = new Map([...repuestos.values()].map((r) => [r.id, { PRINCIPAL: { cantidad: 10, reservada: 0 } }]));

const leerCuerpo = (req) =>
  new Promise((resolve) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', () => resolve(c ? JSON.parse(c) : {}));
  });
const json = (res, codigo, cuerpo) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
};

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  console.log(`[repuestos-falso] ${req.method} ${url.pathname}${url.search}`);

  if (req.method === 'GET' && url.pathname === '/api/repuestos') {
    const texto = (url.searchParams.get('texto') ?? '').toUpperCase();
    const limite = Number(url.searchParams.get('limite') ?? 10);
    const items = [...repuestos.values()]
      .filter((r) => !texto || r.sku.includes(texto) || r.nombre.toUpperCase().includes(texto))
      .slice(0, limite);
    return json(res, 200, { items, total: items.length, pagina: 1, limite });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/stock/repuestos/')) {
    const id = url.pathname.split('/').pop();
    const bodegas = stock.get(id);
    if (!bodegas) return json(res, 404, { statusCode: 404, error: 'NotFoundError', message: `No existe el repuesto ${id}` });
    const detalle = Object.entries(bodegas).map(([bodega, s]) => ({
      bodega, cantidad: s.cantidad, reservada: s.reservada, disponible: s.cantidad - s.reservada,
    }));
    return json(res, 200, {
      repuestoId: id,
      totalFisico: detalle.reduce((s, b) => s + b.cantidad, 0),
      totalDisponible: detalle.reduce((s, b) => s + b.disponible, 0),
      bodegas: detalle,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/stock/reservas') {
    const { repuestoId, cantidad, bodega = 'PRINCIPAL' } = await leerCuerpo(req);
    const s = stock.get(repuestoId)?.[bodega];
    if (!s) return json(res, 404, { statusCode: 404, error: 'NotFoundError', message: `No hay stock registrado del repuesto ${repuestoId} en la bodega ${bodega}` });
    const disponible = s.cantidad - s.reservada;
    if (cantidad > disponible) return json(res, 409, { statusCode: 409, error: 'StockInsuficienteError', message: `Solo hay ${disponible} unidad(es) disponible(s) y se piden ${cantidad}` });
    s.reservada += cantidad;
    return json(res, 200, { repuestoId, bodega, cantidad: s.cantidad, reservada: s.reservada, disponible: s.cantidad - s.reservada });
  }

  if (req.method === 'POST' && url.pathname === '/api/stock/reservas/liberar') {
    const { repuestoId, cantidad, bodega = 'PRINCIPAL' } = await leerCuerpo(req);
    const s = stock.get(repuestoId)?.[bodega];
    if (!s) return json(res, 404, { statusCode: 404, error: 'NotFoundError', message: `No hay stock registrado del repuesto ${repuestoId} en la bodega ${bodega}` });
    if (cantidad > s.reservada) return json(res, 409, { statusCode: 409, error: 'ConflictError', message: `Solo hay ${s.reservada} unidad(es) reservada(s) y se piden ${cantidad}` });
    s.reservada -= cantidad;
    return json(res, 200, { repuestoId, bodega, cantidad: s.cantidad, reservada: s.reservada, disponible: s.cantidad - s.reservada });
  }

  if (req.method === 'POST' && url.pathname === '/api/stock/salidas') {
    const { repuestoId, cantidad, bodega = 'PRINCIPAL', desdeReserva } = await leerCuerpo(req);
    const s = stock.get(repuestoId)?.[bodega];
    if (!s) return json(res, 404, { statusCode: 404, error: 'NotFoundError', message: `No hay stock registrado del repuesto ${repuestoId} en la bodega ${bodega}` });
    if (desdeReserva) {
      if (cantidad > s.reservada) return json(res, 409, { statusCode: 409, error: 'ConflictError', message: `Solo hay ${s.reservada} unidad(es) reservada(s) y se piden ${cantidad}` });
      s.reservada -= cantidad;
    } else if (cantidad > s.cantidad - s.reservada) {
      return json(res, 409, { statusCode: 409, error: 'StockInsuficienteError', message: `Solo hay ${s.cantidad - s.reservada} unidad(es) disponible(s) y se piden ${cantidad}` });
    }
    s.cantidad -= cantidad;
    return json(res, 200, { repuestoId, bodega, cantidad: s.cantidad, reservada: s.reservada, disponible: s.cantidad - s.reservada });
  }

  json(res, 404, { statusCode: 404, message: 'No existe esa ruta en el concesionario falso' });
});

servidor.listen(PUERTO, () => {
  console.log(`repuestos-falso en el puerto ${PUERTO}`);
  console.log('Catálogo:', [...repuestos.values()].map((r) => `${r.sku} (${r.id})`).join(', '));
});
