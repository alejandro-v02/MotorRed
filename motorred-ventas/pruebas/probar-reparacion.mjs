// node pruebas/probar-reparacion.mjs <cotizacion_ref> [http://localhost:3000]
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const cotizacion_ref = process.argv[2];
const BASE = process.argv[3] ?? 'http://localhost:3000';
const TOKEN = process.env.MCP_FACTURACION_TOKEN ?? 'token_facturacion_mcp';
if (!cotizacion_ref) {
  console.error('Uso: node pruebas/probar-reparacion.mjs <cotizacion_ref> [http://localhost:3000]');
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
    partes_usadas: [{ codigo_repuesto: 'AMO-DEL-GAS', descripcion: 'Amortiguador delantero a gas', cantidad: 2, compra_id: 39, tienda: 'AutoPartes La 68' }],
    total_mano_obra: 210000,
    id_mensaje: `prueba-reparacion-${Date.now()}`,
  },
});
console.log('Respuesta (acuse):', r.structuredContent);
await cliente.close();
