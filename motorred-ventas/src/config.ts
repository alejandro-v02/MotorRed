import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISOS_FACTURACION } from './contrato/facturacion.js';
import { PERMISOS } from './contrato/herramientas.js';

// Lee el .env de esta carpeta. Los valores por defecto coinciden con los del kit del ecosistema,
// para que este servicio pueda reemplazar al simulador de ventas sin reconfigurar a los demás grupos.
export const RAIZ = join(import.meta.dirname, '..');
if (existsSync(join(RAIZ, '.env'))) process.loadEnvFile(join(RAIZ, '.env'));
const v = (nombre: string, porDefecto: string) => process.env[nombre] || porDefecto;
const n = (nombre: string, porDefecto: number) => Number(process.env[nombre] ?? porDefecto);

export const GRUPO = v('GRUPO', 'ventas');
if (!PERMISOS[GRUPO])
  throw new Error(`GRUPO debe ser taller, tienda, concesionario o ventas (llegó ${GRUPO})`);
export const PUERTO = Number(v('PUERTO', '3000'));
// Dirección pública de ESTE servicio, para pedirle a la pasarela que llame de vuelta a nuestro
// webhook. En Docker, cada grupo la cambia a su nombre de servicio (p. ej. http://ventas:3000).
export const URL_PROPIA = v('URL_PROPIA', `http://localhost:${PUERTO}`);
export const SECRETO_JWT = v(`SECRETO_JWT_${GRUPO.toUpperCase()}`, `lab-jwt-${GRUPO}-cambie-esto`);

// Clientes de servicio que acepta este grupo: CLIENTE_<CLIENTE>_EN_<GRUPO>=secreto
export const CLIENTES: Record<string, { secreto: string; alcances: string[] }> = Object.fromEntries(
  Object.entries({ ...PERMISOS[GRUPO], ...(GRUPO === 'ventas' ? PERMISOS_FACTURACION : {}) }).map(([cliente, alcances]) => [
    cliente,
    { secreto: v(`CLIENTE_${cliente.toUpperCase()}_EN_${GRUPO.toUpperCase()}`, `lab-${cliente}-en-${GRUPO}`), alcances },
  ]),
);
export const FIRMA_EVENTOS_VENTAS = v('FIRMA_EVENTOS_VENTAS', 'lab-firma-ventas-cambie-esto');
export const FIRMA_EVENTOS_PASARELA = v('FIRMA_EVENTOS_PASARELA', 'lab-firma-pasarela-cambie-esto');

// ---------- lo que ventas necesita además, por ser orquestador comercial ----------
// Direcciones de los otros servicios del ecosistema (simuladores o reales, según .env del ecosistema).
export const URLS = {
  taller: v('URL_TALLER', 'http://localhost:4101'),
  tienda: v('URL_TIENDA', 'http://localhost:4102'),
  concesionario: v('URL_CONCESIONARIO', 'http://localhost:4103'),
  pasarela: v('URL_PASARELA', 'http://localhost:4199'),
};
// Credencial que ESTE servicio usa para llamar a otro: CLIENTE_VENTAS_EN_<destino>=secreto
export const credencialSaliente = (destino: string) =>
  v(`CLIENTE_VENTAS_EN_${destino.toUpperCase()}`, `lab-ventas-en-${destino}`);

export const PASARELA_LLAVE = v('PASARELA_LLAVE', 'lab-llave-pasarela');

// url_notificacion de crear_venta solo puede apuntar a direcciones del ecosistema (regla del contrato).
export const NOTIFICACIONES_PERMITIDAS = v('NOTIFICACIONES_PERMITIDAS', `${URLS.taller}`)
  .split(',')
  .map((u) => new URL(u).origin);

// Parámetros tributarios y comerciales: valores de PRÁCTICA, por si la tabla parametros_tributarios
// está vacía (primer arranque antes del seed). En producción SIEMPRE se leen de la base de datos,
// porque cambian por decreto (ver Concepto 5 del Instructivo 5).
export const PARAMETROS_POR_DEFECTO = {
  iva_porcentaje: n('IVA_PORCENTAJE', 19),
  comision_porcentaje: n('COMISION_PORCENTAJE', 3),
  uvt: n('UVT', 52374),
  retefuente: {
    servicio: { tarifa: n('RETEFUENTE_SERVICIOS', 4), base_uvt: n('RETEFUENTE_SERVICIOS_BASE_UVT', 2) },
    repuesto: { tarifa: n('RETEFUENTE_COMPRAS', 2.5), base_uvt: n('RETEFUENTE_COMPRAS_BASE_UVT', 10) },
  },
};

// ---------- Facturación (contrato del Taller real: Docs/Equipos/MCP-Taller.xlsx) ----------
// Todo lo que depende de un grupo del que aún no se tiene el contrato está detrás de un "modo":
//   TIENDA_MODO       simulado | real     (real = falta escribir facturacion/adaptadores/tienda.real.ts)
//   NOTIFICADOR_MODO  bandeja | telegram  (telegram = falta escribir facturacion/adaptadores/notificador.telegram.ts)
// Ver docs/pendientes-contratos.md para la lista de qué archivo editar cuando llegue cada contrato.
export const FACTURACION = {
  vigenciaHoras: n('COTIZACION_VIGENCIA_HORAS', 48),
  tiendaModo: v('TIENDA_MODO', 'simulado'),
  notificadorModo: v('NOTIFICADOR_MODO', 'bandeja'),
  // El Taller no envía si el cliente es agente de retención: se asume este valor (1 = retenedor).
  clienteRetenedor: v('CLIENTE_RETENEDOR', '0') === '1',
  // MCP del Taller real. Sin URL, los mensajes quedan en la bandeja de salida (mensajes_salida).
  taller: {
    url: v('TALLER_FACT_URL', ''),
    // Token de portador fijo que el Taller entrega a Facturación. Pendiente confirmar si el Taller
    // usa este esquema o OAuth client_credentials como el contrato 1.0.
    token: v('TALLER_FACT_TOKEN', ''),
    reintentos: n('TALLER_FACT_REINTENTOS', 5),
  },
  // Rutas internas (/internos/cotizaciones/...): llave de operador, ver FacturacionController.
  llaveInterna: v('FACT_LLAVE_INTERNA', 'lab-llave-interna-cambie-esto'),
  // Dirección que se guarda como url_notificacion de las ventas que nacen de una cotización: el
  // Taller real no expone POST /eventos, así que los eventos de venta se quedan en este servicio.
  urlEventosVenta: `${URL_PROPIA}/internos/eventos-venta`,
};

// Base de datos propia del servicio (una base de datos por servicio: regla del Trabajo 7).
export const DB = {
  host: v('DB_HOST', 'localhost'),
  port: n('DB_PORT', 5432),
  usuario: v('DB_USUARIO', 'motorred'),
  clave: v('DB_CLAVE', 'motorred'),
  base: v('DB_BASE', 'motorred_ventas'),
};

// Modelo de embeddings para el RAG (Actividad 4.4). Por defecto, el de Ollama local.
export const RAG = {
  ollamaUrl: v('OLLAMA_URL', 'http://localhost:11434'),
  modeloEmbedding: v('EMBED_MODELO', 'nomic-embed-text'),
  dimensiones: n('EMBED_DIMENSIONES', 768),
  modeloChat: v('LLM_MODELO', 'qwen2.5:7b'),
};
