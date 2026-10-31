// Igual que probar-reparacion.mjs, pero usando MENOS repuestos de los cotizados (cotizado: 2x
// AMO-DEL-GAS, usado: 1x). Cubre el caso que reveló un bug real: confirmarPago recalculaba el
// cobro desde la cotización original en vez de desde lo que esta notificación reporta, y el
// monto no cuadraba contra lo que ya se le había dicho al cliente que pagara (ver migración
// 0003_pagos_pse_lineas.ts). Úsela junto con probar-facturacion.mjs y repuestos-falso.mjs para
// probar de punta a punta que la reserva del repuesto no usado se libera y el cobro sí refleja
// solo lo usado.
//   node pruebas/probar-reparacion-parcial.mjs <cotizacion_ref> [http://localhost:3000]
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const cotizacion_ref = process.argv[2];
const BASE = process.argv[3] ?? 'http://localhost:3000';
const TOKEN = process.env.MCP_FACTURACION_TOKEN ?? 'lab-facturacion-token-cambie-esto';
if (!cotizacion_ref) {
  console.error('Uso: node pruebas/probar-reparacion-parcial.mjs <cotizacion_ref> [http://localhost:3000]');
  process.exit(1);
}
const cliente = new Client({ name: 'x', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
await cliente.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp-facturacion`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
const r = await cliente.callTool({
  name: 'notificar_reparacion_terminada',
  arguments: {
    codigo: 'OT-0054', id_relacion: 'REL-1005', cotizacion_ref,
    mano_obra_realizada: [
      { tarea_id: 60, sku: 'REV-GENERAL', descripcion: 'Revisión general', precio: 60000, pagador: 'cliente' },
      { tarea_id: 61, sku: 'SUS-AMORT', descripcion: 'Cambio de amortiguadores', precio: 150000, pagador: 'cliente' },
    ],
    servicios_no_realizados: [],
    // Cotizado: 2 unidades. Solo se usó 1: la otra debe liberarse en el concesionario y el
    // cobro final debe ser menor al de la cotización original.
    partes_usadas: [{ codigo_repuesto: 'AMO-DEL-GAS', descripcion: 'Amortiguador delantero a gas', cantidad: 1, compra_id: 39, tienda: 'AutoPartes La 68' }],
    total_mano_obra: 210000,
    id_mensaje: `prueba-reparacion-parcial-${Date.now()}`,
  },
});
console.log('Respuesta (acuse):', r.structuredContent);
await cliente.close();
