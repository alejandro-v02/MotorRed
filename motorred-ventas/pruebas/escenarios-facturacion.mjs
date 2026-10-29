// Escenarios de Facturación de punta a punta, contra el contrato del Taller real (MCP-Taller.xlsx):
//   F1 normal · F2 garantía parcial · F3 garantía total · F4 rechazo del cliente · F5 pago rechazado
//   F6 vencimiento · F7 taller caído · F8 servicio no realizado y repuesto no usado
//   F9 seguridad y validaciones
//
// Requisitos (cada uno en su terminal):
//   1. El kit:   cd ecosistema-motor ; node ecosistema.mjs --sin ventas       (pasarela en :4199)
//   2. Taller simulado:  node pruebas/simulador-taller-facturacion.mjs        (:4111)
//   3. Este servicio con TALLER_FACT_URL=http://localhost:4111 y TALLER_FACT_TOKEN=lab-token-taller-fact
// Uso:  node pruebas/escenarios-facturacion.mjs [urlVentas] [urlTallerSimulado]
import { writeFileSync, mkdirSync } from 'node:fs';
import pg from 'pg';
import { ClienteServicio } from '../../ecosistema-motor/lib/cliente.mjs';
import { bloque, pausa, prueba, resultados } from '../../ecosistema-motor/pruebas/comun.mjs';

const VENTAS = process.argv[2] ?? 'http://localhost:3010';
const TALLER = process.argv[3] ?? 'http://localhost:4111';
const LLAVE = process.env.FACT_LLAVE_INTERNA || 'lab-llave-interna-cambie-esto';
const DB = { host: process.env.DB_HOST ?? 'localhost', port: Number(process.env.DB_PORT ?? 5433), user: process.env.DB_USUARIO ?? 'motorred', password: process.env.DB_CLAVE ?? 'motorred', database: process.env.DB_BASE ?? 'motorred_ventas' };

const taller = new ClienteServicio({ destino: 'ventas', url: VENTAS, clientId: 'taller_fact', clientSecret: process.env.CLIENTE_TALLER_FACT_EN_VENTAS ?? 'lab-taller_fact-en-ventas', alcances: ['facturacion.operar'] });
const tallerViejo = new ClienteServicio({ destino: 'ventas', url: VENTAS, clientId: 'taller', clientSecret: 'lab-taller-en-ventas', alcances: ['ventas.crear'] });
const interno = (ruta, metodo = 'GET', cuerpo, llave = LLAVE) =>
  fetch(`${VENTAS}/internos/${ruta}`, { method: metodo, headers: { 'X-Llave-Interna': llave, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
const sim = (ruta, metodo = 'GET', cuerpo) => fetch(`${TALLER}${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then((r) => r.json());
const codigoError = async (fn) => { try { await fn(); return 'sin error'; } catch (e) { return e.codigo ?? e.message; } };

const esperar = async (fn, ms = 20_000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const v = await fn(); if (v) return v; await pausa(300); } return null; };
const estadoDe = async (codigo) => (await taller.llamar('estado_cotizacion', { codigo })).estado;
const esperarEstado = (codigo, estado, ms) => esperar(async () => ((await estadoDe(codigo)) === estado ? true : null), ms);
const recibidosDe = async (codigo, herramienta) => (await sim('/recibidos')).filter((m) => m.args.codigo === codigo && m.herramienta === herramienta);
const bandejaDe = async (codigo) => (await (await interno(`notificaciones?codigo=${codigo}`)).json()).filter((m) => m.codigo === codigo);
const responder = (codigo, aceptada, motivo) => interno(`cotizaciones/${codigo}/respuesta`, 'POST', { aceptada, motivo });
const pagar = async (url, resultado = 'aprobado') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `resultado=${resultado}` });

let consecutivo = 7000 + Math.floor(Math.random() * 1500);
const nuevoCodigo = () => `OT-${String(++consecutivo).padStart(4, '0')}`;
const noGarantia = { aplica: false, valida: false, pagador: 'cliente', motivo: null };
const gar = (pagador) => ({ aplica: true, valida: true, pagador, motivo: 'Garantía validada' });
const mano = (tarea_id, sku, descripcion, precio, garantia = noGarantia) => ({ tarea_id, sku, descripcion, precio, causa: null, garantia });
const repuesto = (tarea_id, codigo_repuesto, descripcion, cantidad, garantia) => ({ tarea_id, codigo_repuesto, descripcion, cantidad, ...(garantia ? { garantia } : {}) });
function cotizacion(codigo, manoObra, repuestos) {
  const total_mano_obra = manoObra.reduce((s, l) => s + l.precio, 0);
  const total_mano_obra_cliente = manoObra.filter((l) => !(l.garantia.aplica && l.garantia.valida)).reduce((s, l) => s + l.precio, 0);
  return {
    codigo, id_relacion: 'REL-1001', taller: 'Taller Pulgas Locas', sede: 'Pulgas Locas Frenos y Suspensión',
    cliente: { cedula: '39765432', nombre: 'Marta Gil', telefono: '3009998877' },
    vehiculo: { vin: '9FBHJD204LM500005', placa: 'MGL630', descripcion: 'Renault Duster Intens 1.3 Turbo 2020' },
    mano_obra: manoObra, repuestos, hay_repuestos: repuestos.length > 0, total_mano_obra, total_mano_obra_cliente,
    mensaje_garantia: 'Resultado de la garantía incluido', responder_con: 'registrar_respuesta_cliente',
  };
}
const terminada = (codigo, ref, hechas, noHechas, partes) => ({
  codigo, id_relacion: 'REL-1001', cotizacion_ref: ref,
  mano_obra_realizada: hechas.map((l) => ({ tarea_id: l.tarea_id, sku: l.sku, descripcion: l.descripcion, precio: l.precio, pagador: l.garantia.aplica && l.garantia.valida ? l.garantia.pagador : 'cliente' })),
  servicios_no_realizados: noHechas.map((l) => ({ tarea_id: l.tarea_id, sku: l.sku, descripcion: l.descripcion })),
  partes_usadas: partes, total_mano_obra: hechas.reduce((s, l) => s + l.precio, 0), responder_con: 'registrar_pago',
});

const PASTILLAS = (g) => mano(1, 'FRE-PASTILLAS', 'Cambio de pastillas delanteras', 80000, g);
const PAS = (g) => repuesto(1, 'PAS-DEL-CER', 'Juego de pastillas delanteras cerámicas', 1, g);

// ---------------------------------------------------------------------------------------------
await sim('/sandbox/limpiar', 'POST');
await interno('sandbox/reabastecer', 'POST');
const bd = new pg.Client(DB);
await bd.connect();

// Lleva una cotización hasta "cotizada" y devuelve su detalle.
async function cotizar(codigo, manoObra, repuestos) {
  const acuse = await taller.llamar('crear_cotizacion', cotizacion(codigo, manoObra, repuestos));
  await esperarEstado(codigo, 'cotizada');
  return { acuse, detalle: await taller.llamar('estado_cotizacion', { codigo }) };
}
// Acepta, termina la reparación y devuelve la cotización en cobro.
async function aceptarYTerminar(codigo, ref, hechas, noHechas, partes) {
  await responder(codigo, true);
  await taller.llamar('notificar_reparacion_terminada', terminada(codigo, ref, hechas, noHechas, partes));
  return esperar(async () => { const d = await taller.llamar('estado_cotizacion', { codigo }); return d.url_pago ? d : null; });
}

await bloque('F1 normal', async () => {
  const codigo = nuevoCodigo();
  const m = [PASTILLAS()];
  const { acuse, detalle } = await cotizar(codigo, m, [PAS()]);
  prueba('F1 normal', 'crear_cotizacion responde recibida con referencia FAC-<orden>', `FAC-${codigo}`, acuse.cotizacion_ref);
  prueba('F1 normal', 'La cotización queda cotizada con el precio de la tienda', 'cotizada 172050', `${detalle.estado} ${detalle.lineas.find((l) => l.tipo === 'repuesto').precio_unitario}`);
  prueba('F1 normal', 'Subtotal, IVA por línea y total al peso', '252050 47890 299940', `${detalle.subtotal} ${detalle.iva} ${detalle.total}`);
  prueba('F1 normal', 'El cliente paga todo (sin garantía)', 299940, detalle.total_cliente);
  prueba('F1 normal', 'El cliente recibió el aviso con el total', true, (await bandejaDe(codigo)).some((n) => n.payload.texto.includes('$299.940')));
  const sinLlave = await interno(`cotizaciones/${codigo}/respuesta`, 'POST', { aceptada: true }, 'llave-falsa');
  prueba('F1 normal', 'Responder sin la llave interna es 401', 401, sinLlave.status);
  await responder(codigo, true);
  const rc = await esperar(async () => (await recibidosDe(codigo, 'registrar_respuesta_cliente'))[0] ?? null);
  prueba('F1 normal', 'El Taller recibió registrar_respuesta_cliente aceptada', true, rc?.args.aceptada);
  prueba('F1 normal', 'La orden de compra trae tienda y precio', 'AutoPartes La 68 172050', `${rc?.args.orden_compra[0].tienda} ${rc?.args.orden_compra[0].precio_unitario}`);
  prueba('F1 normal', 'El Taller recibe la referencia de la cotización', `FAC-${codigo}`, rc?.args.referencia);
  const dup = await responder(codigo, true);
  prueba('F1 normal', 'Aceptar dos veces es idempotente', 200, dup.status);
  await taller.llamar('notificar_reparacion_terminada', terminada(codigo, `FAC-${codigo}`, m, [], [{ codigo_repuesto: 'PAS-DEL-CER', descripcion: 'Pastillas', cantidad: 1, compra_id: 31, tienda: 'AutoPartes La 68' }]));
  const cobro = await esperar(async () => { const d = await taller.llamar('estado_cotizacion', { codigo }); return d.url_pago ? d : null; });
  prueba('F1 normal', 'La reparación terminada genera el cobro PSE', 'en_cobro', cobro?.estado);
  const otra = await taller.llamar('notificar_reparacion_terminada', terminada(codigo, `FAC-${codigo}`, m, [], [{ codigo_repuesto: 'PAS-DEL-CER', cantidad: 1 }]));
  prueba('F1 normal', 'notificar_reparacion_terminada repetido no duplica el cobro', 'en_cobro', otra.estado);
  await pagar(cobro.url_pago);
  prueba('F1 normal', 'Con el pago aprobado la cotización llega a liquidada', true, await esperarEstado(codigo, 'liquidada'));
  const pago = await esperar(async () => (await recibidosDe(codigo, 'registrar_pago'))[0] ?? null);
  prueba('F1 normal', 'El Taller recibió registrar_pago por el total', 299940, pago?.args.valor);
  prueba('F1 normal', 'El pago llegó una sola vez (pasarela envía cada evento dos veces)', 1, (await recibidosDe(codigo, 'registrar_pago')).length);
  const final = await taller.llamar('estado_cotizacion', { codigo });
  const liq = await tallerViejo.llamar('consultar_liquidacion', { traza_id: final.traza_id, venta_id: final.venta_id });
  prueba('F1 normal', 'La liquidación cuadra y reparte al taller y a la tienda', 'true taller,tienda', `${liq.cuadra} ${liq.dispersiones.map((d) => d.beneficiario).sort().join(',')}`);
  prueba('F1 normal', 'Recaudado = total de la cotización', 299940, liq.recaudado);
});

await bloque('F2 garantía parcial', async () => {
  const codigo = nuevoCodigo();
  const m = [PASTILLAS()]; // la mano de obra la paga el cliente
  const { detalle } = await cotizar(codigo, m, [PAS(gar('tienda'))]); // el repuesto lo cubre la tienda
  prueba('F2 garantía parcial', 'El cliente paga solo la mano de obra con IVA', 95200, detalle.total_cliente);
  prueba('F2 garantía parcial', 'La garantía cubre el repuesto con IVA', 204740, detalle.total_cubierto_garantia);
  prueba('F2 garantía parcial', 'La línea del repuesto queda a cargo de la tienda', 'tienda', detalle.lineas.find((l) => l.tipo === 'repuesto').pagador);
  const cobro = await aceptarYTerminar(codigo, `FAC-${codigo}`, m, [], [{ codigo_repuesto: 'PAS-DEL-CER', cantidad: 1 }]);
  await pagar(cobro.url_pago);
  prueba('F2 garantía parcial', 'Se cobra solo lo del cliente y se liquida', true, await esperarEstado(codigo, 'liquidada'));
  const pago = await esperar(async () => (await recibidosDe(codigo, 'registrar_pago'))[0] ?? null);
  prueba('F2 garantía parcial', 'registrar_pago informa lo que pagó el cliente', 95200, pago?.args.valor);
});

await bloque('F3 garantía total', async () => {
  const codigo = nuevoCodigo();
  const m = [PASTILLAS(gar('fabricante'))];
  const { detalle } = await cotizar(codigo, m, [PAS(gar('fabricante'))]);
  prueba('F3 garantía total', 'El cliente no paga nada', 0, detalle.total_cliente);
  await responder(codigo, true);
  await taller.llamar('notificar_reparacion_terminada', terminada(codigo, `FAC-${codigo}`, m, [], [{ codigo_repuesto: 'PAS-DEL-CER', cantidad: 1 }]));
  const pago = await esperar(async () => (await recibidosDe(codigo, 'registrar_pago'))[0] ?? null);
  prueba('F3 garantía total', 'registrar_pago por 0, como el ejemplo del Excel', 0, pago?.args.valor);
  prueba('F3 garantía total', 'No se crea ninguna venta ni cobro', null, (await taller.llamar('estado_cotizacion', { codigo })).venta_id);
});

await bloque('F4 rechazo', async () => {
  const codigo = nuevoCodigo();
  await cotizar(codigo, [PASTILLAS()], [PAS()]);
  const r = await responder(codigo, false, 'Muy caro');
  prueba('F4 rechazo', 'El rechazo del cliente se acepta', 200, r.status);
  const rc = await esperar(async () => (await recibidosDe(codigo, 'registrar_respuesta_cliente'))[0] ?? null);
  prueba('F4 rechazo', 'El Taller recibe aceptada=false con el motivo', 'false Muy caro', `${rc?.args.aceptada} ${rc?.args.motivo}`);
  prueba('F4 rechazo', 'La cotización queda rechazada', 'rechazada', await estadoDe(codigo));
  const despues = await responder(codigo, true);
  prueba('F4 rechazo', 'Aceptar una cotización ya rechazada es ESTADO_INVALIDO', 409, despues.status);
  const tarde = await taller.llamar('notificar_reparacion_terminada', terminada(codigo, `FAC-${codigo}`, [PASTILLAS()], [], [])).then(() => 'sin error', (e) => e.codigo);
  prueba('F4 rechazo', 'No se cobra una cotización rechazada', 'ESTADO_INVALIDO', tarde);
});

await bloque('F5 pago rechazado', async () => {
  const codigo = nuevoCodigo();
  const m = [PASTILLAS()];
  await cotizar(codigo, m, []);
  const cobro = await aceptarYTerminar(codigo, `FAC-${codigo}`, m, [], []);
  await pagar(cobro.url_pago, 'rechazado');
  const nuevo = await esperar(async () => { const d = await taller.llamar('estado_cotizacion', { codigo }); return d.url_pago && d.url_pago !== cobro.url_pago ? d : null; });
  prueba('F5 pago rechazado', 'Un pago rechazado genera un nuevo enlace de pago', true, Boolean(nuevo));
  prueba('F5 pago rechazado', 'El cliente recibe el aviso del rechazo con el enlace nuevo', true, (await bandejaDe(codigo)).some((n) => n.payload.texto.includes('rechazado')));
  await pagar(nuevo.url_pago);
  prueba('F5 pago rechazado', 'Con el segundo pago la cotización se liquida', true, await esperarEstado(codigo, 'liquidada'));
});

await bloque('F6 vencimiento', async () => {
  const codigo = nuevoCodigo();
  await cotizar(codigo, [PASTILLAS()], [PAS()]);
  await bd.query(`UPDATE cotizaciones SET vence_en = now() - interval '1 minute' WHERE codigo = $1`, [codigo]);
  const tarde = await responder(codigo, true);
  prueba('F6 vencimiento', 'Aceptar una cotización vencida es ESTADO_INVALIDO', 409, tarde.status);
  prueba('F6 vencimiento', 'La cotización queda vencida', 'vencida', await estadoDe(codigo));
  const rc = await esperar(async () => (await recibidosDe(codigo, 'registrar_respuesta_cliente'))[0] ?? null);
  prueba('F6 vencimiento', 'El Taller recibe aceptada=false por vencimiento', false, rc?.args.aceptada);
});

await bloque('F7 taller caído', async () => {
  const codigo = nuevoCodigo();
  await cotizar(codigo, [PASTILLAS()], []);
  // El cliente MCP ya reintenta 3 veces por dentro; con 4 fallos la primera entrega de la bandeja
  // de salida se agota y la segunda (5 s después) tiene que salir bien.
  await sim('/sandbox/fallar', 'POST', { n: 4 });
  await responder(codigo, true);
  prueba('F7 taller caído', 'La respuesta del cliente se guarda aunque el Taller no responda', 'aceptada', await estadoDe(codigo));
  const rc = await esperar(async () => (await recibidosDe(codigo, 'registrar_respuesta_cliente'))[0] ?? null, 40_000);
  prueba('F7 taller caído', 'Se reintenta con la bandeja de salida hasta que el Taller responde', true, Boolean(rc));
  const mensajes = await (await interno(`mensajes?codigo=${codigo}`)).json();
  prueba('F7 taller caído', 'El mensaje queda enviado tras reintentos', 'enviado', mensajes[0]?.estado);
  prueba('F7 taller caído', 'Se hizo más de un intento', true, mensajes[0]?.intentos > 1);
});

await bloque('F8 no realizado', async () => {
  const codigo = nuevoCodigo();
  const m = [PASTILLAS(), mano(2, 'SUS-ALINEA', 'Alineación y balanceo', 70000)];
  const r = [PAS(), repuesto(1, 'LIQ-FRE-DOT4', 'Líquido de frenos DOT 4', 1)];
  const { detalle } = await cotizar(codigo, m, r);
  prueba('F8 no realizado', 'Se cotiza todo lo diagnosticado', 412395, detalle.total_cliente);
  const cobro = await aceptarYTerminar(codigo, `FAC-${codigo}`, [m[0]], [m[1]], [{ codigo_repuesto: 'PAS-DEL-CER', cantidad: 1 }]);
  const final = await taller.llamar('estado_cotizacion', { codigo });
  prueba('F8 no realizado', 'Solo se cobra lo realizado y usado', 299940, final.total_cliente);
  prueba('F8 no realizado', 'El servicio no realizado y el repuesto no usado quedan marcados', 'no_realizada liberada', `${final.lineas.find((l) => l.referencia === 'SUS-ALINEA').estado} ${final.lineas.find((l) => l.referencia === 'LIQ-FRE-DOT4').estado}`);
  await pagar(cobro.url_pago);
  await esperarEstado(codigo, 'liquidada');
  const pago = await esperar(async () => (await recibidosDe(codigo, 'registrar_pago'))[0] ?? null);
  prueba('F8 no realizado', 'registrar_pago por lo realmente cobrado', 299940, pago?.args.valor);
});

await bloque('F9 seguridad', async () => {
  const codigo = nuevoCodigo();
  const m = [PASTILLAS()];
  const base = cotizacion(codigo, m, [PAS()]);
  prueba('F9 seguridad', 'total_mano_obra que no suma las líneas', 'DATOS_INVALIDOS', await codigoError(() => taller.llamar('crear_cotizacion', { ...base, codigo: nuevoCodigo(), total_mano_obra: 1 })));
  prueba('F9 seguridad', 'hay_repuestos que no coincide con la lista', 'DATOS_INVALIDOS', await codigoError(() => taller.llamar('crear_cotizacion', { ...base, codigo: nuevoCodigo(), hay_repuestos: false })));
  await taller.llamar('crear_cotizacion', base);
  await esperarEstado(codigo, 'cotizada');
  const igual = await taller.llamar('crear_cotizacion', base);
  prueba('F9 seguridad', 'La misma orden con los mismos datos devuelve la misma cotización', `FAC-${codigo}`, igual.cotizacion_ref);
  prueba('F9 seguridad', 'La misma orden con otros datos es IDEMPOTENCIA_CONFLICTO', 'IDEMPOTENCIA_CONFLICTO', await codigoError(() => taller.llamar('crear_cotizacion', { ...base, mano_obra: [PASTILLAS()].map((l) => ({ ...l, precio: 79000 })), total_mano_obra: 79000, total_mano_obra_cliente: 79000 })));
  prueba('F9 seguridad', 'Cobrar antes de que el cliente acepte es ESTADO_INVALIDO', 'ESTADO_INVALIDO', await codigoError(() => taller.llamar('notificar_reparacion_terminada', terminada(codigo, `FAC-${codigo}`, m, [], []))));
  prueba('F9 seguridad', 'El cliente 1.0 del taller no ve crear_cotizacion', 'NO_AUTORIZADO', await codigoError(() => tallerViejo.llamar('crear_cotizacion', base)));
  await responder(codigo, true);
  prueba('F9 seguridad', 'Cobrar otro precio por la mano de obra es PRECIO_NO_COINCIDE', 'PRECIO_NO_COINCIDE', await codigoError(() => taller.llamar('notificar_reparacion_terminada', terminada(codigo, `FAC-${codigo}`, [{ ...m[0], precio: 20000 }], [], []))));
  prueba('F9 seguridad', 'Usar más repuestos de los comprados es DATOS_INVALIDOS', 'DATOS_INVALIDOS', await codigoError(() => taller.llamar('notificar_reparacion_terminada', terminada(codigo, `FAC-${codigo}`, m, [], [{ codigo_repuesto: 'PAS-DEL-CER', cantidad: 3 }]))));
  prueba('F9 seguridad', 'Una referencia de cotización ajena es NO_ENCONTRADO', 'NO_ENCONTRADO', await codigoError(() => taller.llamar('notificar_reparacion_terminada', terminada(codigo, 'FAC-OT-0001', m, [], []))));
  prueba('F9 seguridad', 'Una orden que no existe es NO_ENCONTRADO', 'NO_ENCONTRADO', await codigoError(() => taller.llamar('estado_cotizacion', { codigo: 'OT-9999' })));

  // El proveedor cambia el precio entre la cotización y la aceptación: no se compra a otro precio.
  const c2 = nuevoCodigo();
  await cotizar(c2, [PASTILLAS()], [repuesto(1, 'BAT-12V-60AH', 'Batería 12 V 60 Ah', 1)]);
  await interno('sandbox/cambiar-precio', 'POST', { codigo: 'BAT-12V-60AH', tienda: 'Repuestos del Sur', precio: 450000 });
  const r = await responder(c2, true);
  const cuerpo = await r.json().catch(() => ({}));
  prueba('F9 seguridad', 'Si la tienda cambió el precio, la aceptación no compra', 'PRECIO_NO_COINCIDE', cuerpo.error?.codigo);
  prueba('F9 seguridad', 'La cotización queda para revisión (sin_precio)', 'sin_precio', await estadoDe(c2));
  await interno('sandbox/reabastecer', 'POST');
});

await bd.end();
const bien = resultados.filter((r) => r.ok).length;
console.log(`\nRESUMEN DE ESCENARIOS DE FACTURACIÓN: ${bien} de ${resultados.length} pruebas correctas`);
mkdirSync(new URL('../resultados/', import.meta.url), { recursive: true });
writeFileSync(new URL('../resultados/escenarios-facturacion.csv', import.meta.url), ['grupo,nombre,esperado,obtenido,ok', ...resultados.map((r) => [r.grupo, r.nombre, r.esperado, r.obtenido, r.ok].map((c) => `"${String(c).replaceAll('"', '""')}"`).join(','))].join('\n'));
process.exit(bien === resultados.length ? 0 : 1);
