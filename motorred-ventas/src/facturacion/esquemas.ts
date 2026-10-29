import { z } from 'zod';

// Esquemas del contrato REAL del taller (grupo Falla), no el del kit. Ver
// docs/contratos-reales/mcp-taller.md. Los campos marcados "asumido" no están 100% confirmados
// por el documento que nos enviaron (la extracción de su tabla PDF se mezcló en esos puntos);
// se basan en el patrón que el resto del documento sí deja claro (id_mensaje en toda escritura,
// "Solo acuse de recibo" en las notificaciones asíncronas).

export const GarantiaLinea = z.object({
  aplica: z.boolean(),
  valida: z.boolean(),
  pagador: z.enum(['cliente', 'fabricante', 'tienda', 'taller']),
  motivo: z.string(),
});

export const ManoObraLinea = z.object({
  tarea_id: z.number().int(),
  sku: z.string(),
  descripcion: z.string(),
  precio: z.number().int().min(0),
  causa: z.enum(['defecto_fabrica', 'repuesto_defectuoso', 'mala_instalacion_taller', 'manipulacion_cliente', 'desgaste_normal']).nullable(),
  garantia: GarantiaLinea,
});
export type ManoObraLineaT = z.infer<typeof ManoObraLinea>;

export const RepuestoLinea = z.object({
  tarea_id: z.number().int(),
  codigo_repuesto: z.string(),
  descripcion: z.string(),
  cantidad: z.number().int().min(1),
  garantia: GarantiaLinea,
});
export type RepuestoLineaT = z.infer<typeof RepuestoLinea>;

// Entrada de crear_cotizacion (lo que el taller nos envía). "taller"/"sede" documentado como un
// único texto "Nombre del taller y de la sede."
export const CrearCotizacionInput = z.object({
  codigo: z.string(),
  id_relacion: z.string(),
  taller: z.string(),
  sede: z.string(),
  cliente: z.object({ cedula: z.string(), nombre: z.string(), telefono: z.string() }),
  vehiculo: z.object({ vin: z.string().length(17), placa: z.string(), descripcion: z.string() }),
  mano_obra: z.array(ManoObraLinea),
  repuestos: z.array(RepuestoLinea),
  id_mensaje: z.string().max(120), // asumido: patrón de idempotencia usado en todo el documento
});
export type CrearCotizacionInputT = z.infer<typeof CrearCotizacionInput>;

export const ManoObraRealizada = z.object({
  tarea_id: z.number().int(),
  sku: z.string(),
  descripcion: z.string(),
  precio: z.number().int().min(0),
  pagador: z.enum(['cliente', 'fabricante', 'tienda', 'taller']),
});
export const ServicioNoRealizado = z.object({ tarea_id: z.number().int(), sku: z.string(), descripcion: z.string() });
export const ParteUsada = z.object({ codigo_repuesto: z.string(), descripcion: z.string(), cantidad: z.number().int().min(1), compra_id: z.number().int().nullable(), tienda: z.string().nullable() });

// Entrada de notificar_reparacion_terminada.
export const NotificarReparacionTerminadaInput = z.object({
  codigo: z.string(),
  id_relacion: z.string(),
  cotizacion_ref: z.string(),
  mano_obra_realizada: z.array(ManoObraRealizada),
  servicios_no_realizados: z.array(ServicioNoRealizado),
  partes_usadas: z.array(ParteUsada),
  total_mano_obra: z.number().int().min(0),
  id_mensaje: z.string().max(120), // asumido
});
export type NotificarReparacionTerminadaInputT = z.infer<typeof NotificarReparacionTerminadaInput>;

// Acuse de recibo: lo único que devolvemos de forma síncrona a estas dos herramientas (el
// documento dice que son asíncronas tipo webhook; la respuesta real llega después, con nuestra
// propia llamada a registrar_respuesta_cliente / registrar_pago en el MCP del taller).
export const Acuse = z.object({ recibido: z.boolean() });

// Lo que NOSOTROS llamamos de vuelta en el MCP del taller (textual, del documento, sección
// "Cómo responder" de facturacion.crear_cotizacion / facturacion.notificar_reparacion_terminada).
export interface OrdenCompraLinea {
  codigo_repuesto: string;
  cantidad: number;
  tienda: string;
  precio_unitario: number;
  pagador?: 'cliente' | 'fabricante' | 'tienda' | 'taller';
}
export interface RegistrarRespuestaClienteArgs {
  codigo: string;
  aceptada: boolean;
  motivo?: string;
  referencia: string;
  orden_compra: OrdenCompraLinea[];
  id_mensaje: string;
}
export interface RegistrarPagoArgs {
  codigo: string;
  referencia_pse: string;
  valor: number;
  id_mensaje: string;
}
