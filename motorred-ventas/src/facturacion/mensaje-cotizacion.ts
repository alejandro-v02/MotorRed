import type { DineroService } from '../negocio/dinero.service.js';

// Redacta el texto de la cotización que ve el cliente. Las cifras salen SOLO de este código (mismo
// DineroService que el cobro por PSE), nunca de un modelo ni del agente que entregue el mensaje.
//
// Formato: párrafos separados por líneas en blanco y una línea por ítem. Si el destino convierte los
// saltos de línea en espacios (hoy AutoMax lo hace), cada línea termina igual en punto o en un precio,
// así que se sigue leyendo bien. Con { negrita: true } los precios van en <b>…</b> (HTML de Telegram) y
// todo el texto dinámico se escapa; se enciende con MENSAJE_NEGRITA=html SOLO cuando el destino lo soporte,
// porque en texto plano el cliente vería las etiquetas literales.

interface Garantia { aplica: boolean; valida: boolean; pagador: string; motivo: string }
export interface LineaManoObra { descripcion: string; precio: number; causa?: string | null; garantia: Garantia }
export interface LineaRepuesto { descripcion: string; cantidad: number; precio_unitario: number; garantia: Garantia }

export interface DatosMensajeCotizacion {
  cliente: string;
  vehiculo: string;
  placa: string;
  codigo: string;
  cotizacion_ref: string;
  manoObra: LineaManoObra[];
  repuestos: LineaRepuesto[];
}

const recortar = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t);
const sinPunto = (t: string) => t.trim().replace(/[.\s]+$/, '');
const quienPaga = (p: string) => ({ fabricante: 'el fabricante', tienda: 'la tienda', taller: 'el taller', cliente: 'el cliente' })[p] ?? p;
const CAUSAS: Record<string, string> = {
  defecto_fabrica: 'defecto de fábrica',
  repuesto_defectuoso: 'repuesto defectuoso',
  mala_instalacion_taller: 'mala instalación del taller',
  manipulacion_cliente: 'manipulación del vehículo por parte del cliente',
  desgaste_normal: 'desgaste normal de las piezas',
};
// El taller describe como "Título: detalle". Para no duplicar los dos puntos antes del precio, el
// detalle pasa a paréntesis: "Título (detalle)".
const nombreLinea = (d: string, max: number) => {
  const [titulo, ...resto] = recortar(d, max).split(': ');
  return resto.length ? `${sinPunto(titulo)} (${sinPunto(resto.join(': '))})` : sinPunto(titulo);
};

export function redactarCotizacion(
  d: DatosMensajeCotizacion,
  dinero: DineroService,
  opciones: { negrita?: boolean } = {},
): { mensaje: string; total: number; subtotal: number; iva: number } {
  const html = opciones.negrita === true;
  const e = (t: string) => (html ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : t); // texto dinámico
  const dinero$ = (v: number) => '$' + v.toLocaleString('es-CO');
  const precio = (v: number) => (html ? `<b>${dinero$(v)}</b>` : dinero$(v));

  const lineasCobro = [
    ...d.manoObra.filter((l) => !l.garantia.valida).map((l) => ({ beneficiario: 'taller', concepto: 'servicio' as const, cantidad: 1, precio_unitario: l.precio, iva_porcentaje: 19 })),
    ...d.repuestos.filter((r) => !r.garantia.valida).map((r) => ({ beneficiario: 'tienda', concepto: 'repuesto' as const, cantidad: r.cantidad, precio_unitario: r.precio_unitario, iva_porcentaje: 19 })),
  ];
  const { subtotal, iva, total } = dinero.totales(lineasCobro);

  const cubre = (g: Garantia) => `sin costo, lo cubre la garantía (${e(quienPaga(g.pagador))})`;
  const bloques: string[] = [];

  bloques.push(`Hola ${e(d.cliente)}, esta es la cotización de tu ${e(d.vehiculo)} (placa ${e(d.placa)}), orden ${e(d.codigo)}.`);

  if (d.manoObra.length) {
    bloques.push(
      ['Mano de obra:', ...d.manoObra.map((l) => `• ${e(nombreLinea(l.descripcion, 120))}: ${l.garantia.valida ? cubre(l.garantia) : precio(l.precio)}`)].join('\n'),
    );
  }
  if (d.repuestos.length) {
    bloques.push(
      ['Repuestos:', ...d.repuestos.map((r) => {
        const nombre = `${nombreLinea(r.descripcion, 120)}${r.cantidad > 1 ? ` x${r.cantidad}` : ''}`;
        return `• ${e(nombre)}: ${r.garantia.valida ? cubre(r.garantia) : precio(r.precio_unitario * r.cantidad)}`;
      })].join('\n'),
    );
  }
  bloques.push([`Subtotal sin IVA: ${precio(subtotal)}.`, `IVA 19 %: ${precio(iva)}.`, `Total a pagar: ${precio(total)}.`].join('\n'));

  // Garantía: qué cubre y, si no aplica, el motivo que dio el taller (sin inventar nada).
  const todas = [...d.manoObra, ...d.repuestos];
  const cubiertas = todas.filter((l) => l.garantia.valida);
  const noCubiertas = todas.filter((l) => !l.garantia.valida);
  const motivos = [...new Set(noCubiertas.map((l) => sinPunto(l.garantia.motivo ?? '')).filter(Boolean))].map((m) => recortar(m, 160));
  const causas = [...new Set(d.manoObra.filter((l) => !l.garantia.valida && l.causa && CAUSAS[l.causa]).map((l) => CAUSAS[l.causa!]))];
  const garantia: string[] = [];
  if (cubiertas.length === 0) {
    if (motivos.length) {
      garantia.push('Garantía: no se aplica a esta reparación.', `Motivo: ${e(motivos.join('; '))}.`);
    } else {
      garantia.push('Garantía: ningún ítem de esta cotización quedó cubierto por garantía.');
    }
    if (causas.length) garantia.push(`Causa de la falla según el taller: ${e(causas.join(' y '))}.`);
  } else {
    garantia.push(`Garantía: ${cubiertas.length} ítem(s) quedaron cubiertos y no los pagas.`);
    if (motivos.length) garantia.push(`El resto no se cubre: ${e(motivos.join('; '))}.`);
  }
  bloques.push(garantia.join('\n'));

  bloques.push(`Ref. ${e(d.cotizacion_ref)}.`);
  return { mensaje: recortar(bloques.join('\n\n'), 1450), total, subtotal, iva };
}
