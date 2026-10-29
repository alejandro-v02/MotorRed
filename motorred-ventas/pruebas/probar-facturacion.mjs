// Prueba de punta a punta de la nueva integración con el taller real (ver ADR 0003).
//   node pruebas/probar-facturacion.mjs
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const URL_FACTURACION = 'http://localhost:3002/mcp-facturacion';
const TOKEN = 'lab-facturacion-token-prueba';

const cliente = new Client({ name: 'taller-real-simulado', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
await cliente.connect(new StreamableHTTPClientTransport(new URL(URL_FACTURACION), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));

console.log('--- crear_cotizacion (orden OT-0054, ejemplo del documento del taller) ---');
const r1 = await cliente.callTool({
  name: 'crear_cotizacion',
  arguments: {
    codigo: 'OT-0054', id_relacion: 'REL-1005', taller: 'Taller Pulgas Locas', sede: 'Pulgas Locas Centro',
    cliente: { cedula: '39765432', nombre: 'Marta Gil', telefono: '3009998877' },
    vehiculo: { vin: '9FBHJD204LM500005', placa: 'MGL630', descripcion: 'Renault Duster Intens 1.3 Turbo 2020' },
    mano_obra: [
      { tarea_id: 60, sku: 'REV-GENERAL', descripcion: 'Revisión general', precio: 60000, causa: null, garantia: { aplica: false, valida: false, pagador: 'cliente', motivo: 'Revisión general: no aplica garantía' } },
      { tarea_id: 61, sku: 'SUS-AMORT', descripcion: 'Cambio de amortiguadores', precio: 150000, causa: 'defecto_fabrica', garantia: { aplica: true, valida: false, pagador: 'cliente', motivo: 'La garantía venció el 2023-02-17' } },
    ],
    repuestos: [{ tarea_id: 61, codigo_repuesto: 'AMO-DEL-GAS', descripcion: 'Amortiguador delantero a gas', cantidad: 2, garantia: { aplica: true, valida: false, pagador: 'cliente', motivo: 'La garantía venció el 2023-02-17' } }],
    id_mensaje: `prueba-cotiza-${Date.now()}`,
  },
});
console.log('Respuesta (acuse):', r1.structuredContent);

// Buscar la cotización recién creada en la base de datos vía el endpoint interno no existe aún,
// así que la consultamos directo (igual que haría cualquiera revisando el log del servicio).
console.log('\nRevisa el log del servicio para ver "cotizacion_ref" y el log del taller-falso para la respuesta.');
console.log('Sigue con: curl -X POST http://localhost:3002/facturacion/sandbox/telegram/<cotizacion_ref>/responder -H "Content-Type: application/json" -d \'{"aceptada":true}\'');

await cliente.close();
