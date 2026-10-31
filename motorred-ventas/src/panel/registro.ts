// Almacén en memoria (anillo) de todo lo que entra y sale del servicio, para el panel de logs.
// Es un singleton de módulo a propósito: lo usan el middleware de Express (antes de que exista
// el contenedor de Nest) y los servicios de salida (n8n, taller, tienda) sin cablear inyección.

export type Direccion = 'entrante' | 'saliente';
export type Canal =
  | 'mcp-ventas' // /mcp (contrato del kit)
  | 'mcp-facturacion' // /mcp-facturacion (taller real → nosotros)
  | 'facturacion' // /facturacion/sandbox/... (respuesta Telegram, confirmación PSE)
  | 'webhook' // webhook de la pasarela
  | 'otro'
  | 'telegram' // mensaje armado para el cliente (vía n8n)
  | 'n8n'
  | 'taller' // nuestras llamadas MCP al taller
  | 'tienda' // agente de repuestos (hablar_con_repuestos)
  | 'agente'; // decisiones de nuestro agente de facturación

export interface EntradaLog {
  id: number;
  ts: string;
  direccion: Direccion;
  canal: Canal;
  resumen: string; // "tools/call crear_cotizacion", "POST /facturacion/sandbox/..."
  metodo?: string;
  ruta?: string;
  estado?: number; // HTTP
  ok: boolean;
  ms?: number;
  peticion?: unknown;
  respuesta?: unknown;
  error?: string;
}

const MAX = 2000;
const MAX_TEXTO = 6000;
const SENSIBLE = /token|secret|secreto|password|clave|authorization|llave|firma/i;

export function redactar(valor: unknown, profundidad = 0): unknown {
  if (valor == null || profundidad > 8) return valor;
  if (typeof valor === 'string') return valor.length > MAX_TEXTO ? `${valor.slice(0, MAX_TEXTO)}… (${valor.length} caracteres)` : valor;
  if (Array.isArray(valor)) return valor.slice(0, 100).map((x) => redactar(x, profundidad + 1));
  if (typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).map(([k, x]) => [k, SENSIBLE.test(k) ? '***' : redactar(x, profundidad + 1)]),
    );
  }
  return valor;
}

class RegistroPanel {
  private entradas: EntradaLog[] = [];
  private siguiente = 1;

  agregar(e: Omit<EntradaLog, 'id' | 'ts'>): EntradaLog {
    const entrada: EntradaLog = { id: this.siguiente++, ts: new Date().toISOString(), ...e };
    this.entradas.push(entrada);
    if (this.entradas.length > MAX) this.entradas.splice(0, this.entradas.length - MAX);
    return entrada;
  }

  listar(desdeId = 0): EntradaLog[] {
    return this.entradas.filter((e) => e.id > desdeId);
  }

  limpiar() {
    this.entradas = [];
  }
}

export const registroPanel = new RegistroPanel();

// Mide una llamada saliente y deja la entrada (con éxito o error). Relanza el error tal cual.
export async function registrarSaliente<T>(
  base: { canal: Canal; resumen: string; metodo?: string; ruta?: string; peticion?: unknown },
  fn: () => Promise<T>,
  leerResultado?: (r: T) => { estado?: number; ok?: boolean; respuesta?: unknown },
): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    const info = leerResultado?.(r) ?? {};
    registroPanel.agregar({
      direccion: 'saliente', ...base, peticion: redactar(base.peticion), ok: info.ok ?? true,
      estado: info.estado, respuesta: redactar(info.respuesta), ms: Date.now() - t0,
    });
    return r;
  } catch (e) {
    registroPanel.agregar({
      direccion: 'saliente', ...base, peticion: redactar(base.peticion), ok: false,
      error: (e as Error).message, ms: Date.now() - t0,
    });
    throw e;
  }
}
