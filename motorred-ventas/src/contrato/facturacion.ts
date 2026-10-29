// CONTRATO DE FACTURACIÓN - lo que el Taller (grupo Falla) le envía a Ventas/Facturación y lo que
// Facturación le responde. Fuente: Docs/Equipos/MCP-Taller.xlsx (hojas "Llamadas salientes",
// "Herramientas", "Parámetros" y "Respuestas", generado del servidor del Taller el 2026-10-29).
// Vive aparte de contrato/herramientas.ts: aquel archivo es el contrato 1.0 del kit y se reemplaza
// copiando una versión nueva; este es el contrato del Taller real.
// Montos: pesos colombianos (COP) enteros. Fechas ISO 8601 con zona.
import { z } from 'zod';
import { Pesos } from './esquemas.js';

// ---------- valores permitidos (hoja "Catálogos" del Excel del Taller) ----------
export const PAGADORES_GARANTIA = ['cliente', 'fabricante', 'tienda', 'taller'] as const;
export const PagadorGarantia = z.enum(PAGADORES_GARANTIA);
export const CAUSAS_FALLA = ['defecto_fabrica', 'repuesto_defectuoso', 'mala_instalacion_taller', 'manipulacion_cliente', 'desgaste_normal'] as const;

// Estados de la cotización dentro de Facturación (no son los de la orden del Taller).
export const ESTADOS_COTIZACION = [
  'recibida', // llegó crear_cotizacion y se están buscando los precios
  'cotizada', // con precios, avisada al cliente, esperando su respuesta
  'aceptada', // el cliente aceptó y se compraron los repuestos
  'rechazada', // el cliente rechazó
  'vencida', // el cliente no respondió a tiempo
  'cancelada', // el taller canceló la orden
  'sin_precio', // no se pudo cotizar algún repuesto (revisión humana)
  'en_cobro', // la reparación terminó y se envió el PSE
  'pagada', // el pago PSE se confirmó
  'liquidada', // se repartió el dinero
  'en_revision', // algo no cuadró: una persona debe revisar
] as const;

// ---------- lo que el Taller envía: crear_cotizacion ----------
const Garantia = z.object({
  aplica: z.boolean().describe('Dictamen del mecánico'),
  valida: z.boolean().nullable().describe('Validación del concesionario (null si aún no respondió)'),
  pagador: PagadorGarantia,
  motivo: z.string().nullable().optional(),
});

export const LineaManoObra = z.object({
  tarea_id: z.number().int(),
  sku: z.string(),
  descripcion: z.string(),
  precio: Pesos.describe('Precio fijo del SKU, lo pone el Taller'),
  causa: z.string().nullable().optional(),
  garantia: Garantia,
});

// El repuesto llega SIN precio: el precio lo consigue Facturación en las tiendas.
export const LineaRepuesto = z.object({
  tarea_id: z.number().int(),
  codigo_repuesto: z.string(),
  descripcion: z.string(),
  cantidad: z.number().int().min(1).max(50),
  garantia: Garantia.optional(),
});

export const CrearCotizacionEntrada = z.object({
  codigo: z.string().regex(/^OT-\d+$/i, 'Código de orden del Taller, por ejemplo OT-0054'),
  id_relacion: z.string(),
  taller: z.string().optional(),
  sede: z.string().optional(),
  cliente: z.object({ cedula: z.string(), nombre: z.string(), telefono: z.string() }),
  vehiculo: z.object({ vin: z.string().optional(), placa: z.string(), descripcion: z.string() }),
  mano_obra: z.array(LineaManoObra).max(40),
  repuestos: z.array(LineaRepuesto).max(40),
  hay_repuestos: z.boolean(),
  total_mano_obra: Pesos,
  total_mano_obra_cliente: Pesos.describe('Lo que paga el cliente: descuenta la garantía válida'),
  mensaje_garantia: z.string().optional(),
  responder_con: z.literal('registrar_respuesta_cliente').optional(),
});

// ---------- lo que el Taller envía: notificar_reparacion_terminada ----------
export const NotificarReparacionEntrada = z.object({
  codigo: z.string().regex(/^OT-\d+$/i),
  id_relacion: z.string().optional(),
  cotizacion_ref: z.string().describe('La referencia que Facturación envió al aceptar (FAC-OT-0054)'),
  mano_obra_realizada: z.array(z.object({
    tarea_id: z.number().int(), sku: z.string(), descripcion: z.string(), precio: Pesos, pagador: PagadorGarantia,
  })).max(40),
  servicios_no_realizados: z.array(z.object({ tarea_id: z.number().int(), sku: z.string(), descripcion: z.string() })).max(40),
  partes_usadas: z.array(z.object({
    codigo_repuesto: z.string(), descripcion: z.string().optional(), cantidad: z.number().int().min(1),
    compra_id: z.number().int().nullable().optional(), tienda: z.string().nullable().optional(),
  })).max(40),
  total_mano_obra: Pesos,
  responder_con: z.literal('registrar_pago').optional(),
});

// ---------- lo que Facturación responde (salida de las herramientas) ----------
export const AcuseCotizacion = z.object({
  codigo: z.string(),
  cotizacion_ref: z.string(),
  traza_id: z.uuid(),
  estado: z.enum(ESTADOS_COTIZACION),
  mensaje: z.string(),
});

export const LineaCotizada = z.object({
  tipo: z.enum(['mano_obra', 'repuesto']),
  referencia: z.string(),
  descripcion: z.string(),
  cantidad: z.number().int(),
  precio_unitario: Pesos.nullable(),
  iva_porcentaje: z.number(),
  pagador: PagadorGarantia,
  tienda: z.string().nullable(),
  estado: z.string(),
});

export const Cotizacion = z.object({
  codigo: z.string(),
  cotizacion_ref: z.string(),
  traza_id: z.uuid(),
  estado: z.enum(ESTADOS_COTIZACION),
  lineas: z.array(LineaCotizada),
  subtotal: Pesos,
  iva: Pesos,
  total: Pesos.describe('Total de la cotización con IVA, antes de descontar lo que paga otro por garantía'),
  total_cliente: Pesos.describe('Lo que paga el cliente'),
  total_cubierto_garantia: Pesos,
  vence_en: z.string().nullable(),
  venta_id: z.string().nullable(),
  pago_ref: z.string().nullable(),
  url_pago: z.string().nullable(),
  motivo: z.string().nullable(),
});

const soloLectura = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const escribe = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// Herramientas que ESTE servicio publica para el Taller real. Mismo formato que HERRAMIENTAS del
// contrato 1.0, para que el controlador MCP las trate igual.
export const HERRAMIENTAS_FACTURACION = [
  {
    grupo: 'ventas',
    nombre: 'crear_cotizacion',
    alcance: 'facturacion.operar',
    descripcion:
      'El Taller envía la mano de obra (con precio) y los repuestos (sin precio) de una orden en ' +
      'en_cotizacion. Facturación busca los precios, cotiza con IVA, avisa al cliente y responde ' +
      'después con registrar_respuesta_cliente en el MCP del Taller. Idempotente por código de orden.',
    entrada: CrearCotizacionEntrada,
    salida: AcuseCotizacion,
    anotaciones: escribe,
  },
  {
    grupo: 'ventas',
    nombre: 'notificar_reparacion_terminada',
    alcance: 'facturacion.operar',
    descripcion:
      'El Taller informa lo realmente hecho y usado en una orden en pendiente_facturacion. Facturación ' +
      'recalcula el cobro final, envía el PSE al cliente y, al confirmarse el pago, responde con ' +
      'registrar_pago en el MCP del Taller. Idempotente por código de orden.',
    entrada: NotificarReparacionEntrada,
    salida: AcuseCotizacion,
    anotaciones: escribe,
  },
  {
    grupo: 'ventas',
    nombre: 'estado_cotizacion',
    alcance: ['facturacion.operar', 'facturacion.consultar'],
    descripcion: 'Devuelve la cotización de una orden con sus líneas, sus totales y su estado.',
    entrada: z.object({ codigo: z.string().regex(/^OT-\d+$/i) }),
    salida: Cotizacion,
    anotaciones: soloLectura,
  },
];

// Clientes de servicio que acepta Facturación además de los del contrato 1.0. Son clientes APARTE
// (no se suman a "taller" ni "app") para que la conformidad 1.0 siga viendo exactamente las cinco
// herramientas de ventas. "taller_fact" es el Taller real (grupo Falla): su secreto es
// CLIENTE_TALLER_FACT_EN_VENTAS.
export const PERMISOS_FACTURACION: Record<string, string[]> = {
  taller_fact: ['facturacion.operar'],
  app_fact: ['facturacion.consultar'],
};

// Herramientas del MCP del Taller que Facturación llama (hoja "Herramientas" del Excel).
export const RespuestaClienteSalida = z.object({
  codigo: z.string(),
  aceptada: z.boolean(),
  referencia: z.string().optional(),
  motivo: z.string().optional(),
  orden_compra: z.array(z.object({
    codigo_repuesto: z.string(),
    descripcion: z.string().optional(),
    cantidad: z.number().int(),
    tienda: z.string(),
    precio_unitario: Pesos,
    pagador: PagadorGarantia.optional(),
  })).optional(),
  id_mensaje: z.string().max(120),
});

export const PagoSalida = z.object({
  codigo: z.string(),
  referencia_pse: z.string(),
  valor: Pesos,
  id_mensaje: z.string().max(120),
});
