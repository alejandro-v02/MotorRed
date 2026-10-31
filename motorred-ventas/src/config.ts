import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  Object.entries(PERMISOS[GRUPO]).map(([cliente, alcances]) => [
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

// Base de datos propia del servicio (una base de datos por servicio: regla del Trabajo 7).
export const DB = {
  host: v('DB_HOST', 'localhost'),
  port: n('DB_PORT', 5432),
  usuario: v('DB_USUARIO', 'motorred'),
  clave: v('DB_CLAVE', 'motorred'),
  base: v('DB_BASE', 'motorred_ventas'),
};

// Integración con el taller REAL (contrato propio, no el del kit: ver ADR 0003 y
// docs/contratos-reales/mcp-taller.md). Autenticación por token fijo compartido, como el patrón
// MCP_<DESTINO>_URL / MCP_<DESTINO>_TOKEN que ya usa el taller para sus propias llamadas salientes.
export const TALLER_REAL = {
  // Token que el taller debe presentar al llamarnos (Authorization: Bearer <...>).
  tokenEntrante: v('MCP_FACTURACION_TOKEN', 'token_facturacion_mcp'),
  // Dirección y token del MCP del taller, para nuestras llamadas de vuelta
  // (registrar_respuesta_cliente, registrar_pago).
  url: v('MCP_TALLER_URL', 'http://localhost:3001'),
  token: v('MCP_TALLER_TOKEN', 'lab-taller-token-cambie-esto'),
};

// Automatización de Telegram vía n8n (ver docs/contratos-reales/mcp-taller.md, punto 3). Si no
// se configuran, TelegramSimuladoService solo deja el registro de siempre (nada se rompe).
export const N8N = {
  webhookCotizacion: v('N8N_WEBHOOK_COTIZACION', ''),
  webhookPago: v('N8N_WEBHOOK_PAGO', ''),
};

// MCP de la tienda/concesionario de repuestos. Hablamos con SU AGENTE por la herramienta
// hablar_con_repuestos (cotizar, apartar, entregar, pagar, cancelar por mensaje); ya no llamamos
// su API REST (/api/stock/...), que ese grupo va a cerrar. Su agente tarda de 10 a 25 s con el
// modelo local: ellos piden un timeout de al menos 60 s.
export const REPUESTOS_MCP = {
  url: v('MCP_REPUESTOS_URL', 'http://localhost:3100/mcp'),
  token: v('MCP_REPUESTOS_TOKEN', 'dev-mcp-token'),
  timeoutMs: n('MCP_REPUESTOS_TIMEOUT_MS', 90_000),
};

// Modelo de embeddings para el RAG (Actividad 4.4). Por defecto, el de Ollama local.
export const RAG = {
  ollamaUrl: v('OLLAMA_URL', 'http://localhost:11434'),
  modeloEmbedding: v('EMBED_MODELO', 'nomic-embed-text'),
  dimensiones: n('EMBED_DIMENSIONES', 768),
  modeloChat: v('LLM_MODELO', 'qwen2.5:7b'),
};

// Agente de facturación (decide qué decirle a repuestos y cuándo avisar al taller). Usa cualquier
// API compatible con OpenAI: Ollama local (…/v1) o un proveedor en la nube. Responde con JSON
// validado, así que NO exige herramientas nativas (gemma3:4b no las tiene). AGENTE_FACTURACION=no
// o un modelo que no responde → todo lo hace el código (plan B), como antes.
export const AGENTE_LLM = {
  activo: v('AGENTE_FACTURACION', 'si') !== 'no',
  url: v('LLM_URL', `${RAG.ollamaUrl}/v1`).replace(/\/$/, ''),
  llave: v('LLM_LLAVE', 'ollama'),
  modelo: v('LLM_AGENTE_MODELO', RAG.modeloChat),
  tiempoMs: n('LLM_AGENTE_TIEMPO_MS', 60_000),
  maxPasos: n('LLM_AGENTE_MAX_PASOS', 5),
};
