// PUERTOS de Facturación: lo que el servicio necesita de otros grupos, escrito como interfaces.
// La lógica (cotizaciones.service.ts) solo conoce estas interfaces. Cada una tiene un adaptador
// simulado que funciona hoy y un adaptador real que se completa cuando llegue el contrato del
// grupo correspondiente (ver docs/pendientes-contratos.md). Cambiar de simulado a real es cambiar
// una variable de .env, no la lógica.
import type { z } from 'zod';
import type { PagoSalida, RespuestaClienteSalida } from '../contrato/facturacion.js';

export type ProveedorRepuesto = 'tienda' | 'concesionario';

// Una oferta de repuesto para un código universal (PAS-DEL-CER, FIL-ACE-STD...).
export interface OfertaRepuesto {
  oferta_ref: string; // identificador que el proveedor devuelve y que se usa al comprar
  proveedor: ProveedorRepuesto; // define el beneficiario de la línea en la venta
  tienda: string; // nombre comercial: "AutoPartes La 68"
  precio_unitario: number; // pesos enteros, sin IVA
  iva_porcentaje: number | null; // null = usar el IVA vigente de parametros_tributarios
  stock: number;
}

export interface CompraRepuesto {
  compra_ref: string;
  precio_unitario: number; // el precio con que quedó la compra: debe coincidir con la oferta
}

// Tienda de repuestos y concesionario (grupos José y Emerson).
export interface PuertoPrecios {
  // La mejor oferta para un código y una cantidad, o null si nadie la tiene. No reserva nada.
  cotizar(traza_id: string, repuesto: { codigo_repuesto: string; cantidad: number }): Promise<OfertaRepuesto | null>;
  // Compra (reserva y confirma) una oferta. La misma clave_idempotencia devuelve la misma compra.
  comprar(traza_id: string, clave_idempotencia: string, oferta: OfertaRepuesto, cantidad: number): Promise<CompraRepuesto>;
  // Deshace una compra (cotización rechazada a mitad de camino, o repuesto no usado).
  liberar(traza_id: string, compra_ref: string, motivo: string): Promise<void>;
}

// MCP del Taller (grupo Falla): las dos herramientas con las que Facturación le responde.
export interface PuertoTaller {
  registrarRespuestaCliente(entrada: z.infer<typeof RespuestaClienteSalida>): Promise<void>;
  registrarPago(entrada: z.infer<typeof PagoSalida>): Promise<void>;
  // true si hay un Taller configurado al que entregar; si no, los mensajes quedan en la bandeja.
  disponible(): boolean;
}

// Cómo se le avisa al cliente (Telegram según el Excel del Taller).
export interface PuertoNotificaciones {
  // Entrega el texto al cliente. Devuelve true si quedó entregado.
  avisarCliente(aviso: { traza_id: string; codigo: string; telefono: string; nombre: string; texto: string }): Promise<boolean>;
}

export const PUERTO_PRECIOS = Symbol('PUERTO_PRECIOS');
export const PUERTO_TALLER = Symbol('PUERTO_TALLER');
export const PUERTO_NOTIFICACIONES = Symbol('PUERTO_NOTIFICACIONES');
