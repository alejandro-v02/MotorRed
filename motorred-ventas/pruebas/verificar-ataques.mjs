// Tres ataques propios de la sección "Acceso y seguridad" del Trabajo 8 (más allá del
// escenario E6 del kit): pagador de garantía sin autorización, consultar una liquidación antes de
// pagar, y un webhook con un cobro_id inventado reenviado con otro monto.
//
// Requiere: este servicio corriendo (por defecto en :3002) y, como hermana de esta carpeta, la
// carpeta ecosistema-motor del kit (de donde se toman las utilidades de firma y cliente MCP).
//   node pruebas/verificar-ataques.mjs [http://localhost:3002]
import { randomUUID } from 'node:crypto';
import { URLS, FIRMA, credencial } from '../../ecosistema-motor/lib/config.mjs';
import { firmarEvento } from '../../ecosistema-motor/lib/firma.mjs';
import { ClienteServicio } from '../../ecosistema-motor/lib/cliente.mjs';

URLS.ventas = process.argv[2] ?? 'http://localhost:3002';
const taller = new ClienteServicio({ destino: 'ventas', url: URLS.ventas, clientId: 'taller', clientSecret: credencial('taller', 'ventas'), alcances: ['ventas.crear'] });

try {
  await taller.llamar('crear_venta', {
    traza_id: randomUUID(), clave_idempotencia: randomUUID(), orden_id: 'OT-VERIF-1',
    pagador: { tipo: 'concesionario', documento: '900765432-5', nombre: 'Sur Motor', retenedor: true, autorizacion: null },
    lineas: [{ beneficiario: 'taller', concepto: 'servicio', referencia: 'MO-X', descripcion: 'Mano de obra', cantidad: 1, precio_unitario: 50000, iva_porcentaje: 19, reserva_id: null }],
    url_notificacion: `${URLS.taller}/eventos`,
  });
  console.log('Ataque "garantía sin autorización": NO SE RECHAZÓ (mal)');
} catch (e) { console.log('Ataque "garantía sin autorización" ->', e.codigo ?? e.message); }

const traza = randomUUID();
const v = await taller.llamar('crear_venta', {
  traza_id: traza, clave_idempotencia: randomUUID(), orden_id: 'OT-VERIF-2',
  pagador: { tipo: 'cliente', documento: '1000000001', nombre: 'Prueba Verificación', retenedor: false, autorizacion: null },
  lineas: [{ beneficiario: 'taller', concepto: 'servicio', referencia: 'MO-Y', descripcion: 'Mano de obra', cantidad: 1, precio_unitario: 50000, iva_porcentaje: 19, reserva_id: null }],
  url_notificacion: `${URLS.taller}/eventos`,
});
console.log('Venta de prueba:', v.venta_id, v.estado);
try {
  await taller.llamar('consultar_liquidacion', { traza_id: traza, venta_id: v.venta_id });
  console.log('Ataque "liquidación antes de pagar": NO SE RECHAZÓ (mal)');
} catch (e) { console.log('Ataque "liquidación antes de pagar" ->', e.codigo ?? e.message); }

const evento_id = `EVP-VERIFICACION-${randomUUID()}`;
const evento = JSON.stringify({ evento_id, tipo: 'cobro.aprobado', cobro_id: 'CB-NOEXISTE', referencia: v.venta_id, monto: 1, fecha: new Date().toISOString() });
const r1 = await fetch(`${URLS.ventas}/webhooks/pasarela`, { method: 'POST', headers: { 'X-Pasarela-Firma': firmarEvento(evento, FIRMA.pasarela), 'Content-Type': 'application/json' }, body: evento });
console.log('Ataque "cobro_id inventado", primer envío ->', r1.status, await r1.text());
const evento2 = JSON.stringify({ evento_id, tipo: 'cobro.aprobado', cobro_id: 'CB-NOEXISTE', referencia: v.venta_id, monto: 999999, fecha: new Date().toISOString() });
const r2 = await fetch(`${URLS.ventas}/webhooks/pasarela`, { method: 'POST', headers: { 'X-Pasarela-Firma': firmarEvento(evento2, FIRMA.pasarela), 'Content-Type': 'application/json' }, body: evento2 });
console.log('Ataque "cobro_id inventado", mismo evento_id con otro monto ->', r2.status, await r2.text());

await taller.cerrar();
