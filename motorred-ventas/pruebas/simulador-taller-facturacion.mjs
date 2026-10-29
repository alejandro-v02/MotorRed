// Taller SIMULADO para probar Facturación sin esperar al grupo Falla. Imita SOLO la parte del MCP
// del Taller que Facturación llama (MCP-Taller.xlsx): registrar_respuesta_cliente y registrar_pago,
// con id_mensaje idempotente y token de portador fijo. Guarda lo que recibe para que las pruebas lo lean.
//
//   node pruebas/simulador-taller-facturacion.mjs [puerto]        (por defecto 4111)
//   en .env de Ventas:  TALLER_FACT_URL=http://localhost:4111  TALLER_FACT_TOKEN=lab-token-taller-fact
//
// Rutas de laboratorio:  GET /recibidos   POST /sandbox/fallar {n}   POST /sandbox/limpiar
import { createServer } from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';

const PUERTO = Number(process.argv[2] ?? process.env.PUERTO_TALLER_SIM ?? 4111);
const TOKEN = process.env.TALLER_FACT_TOKEN || 'lab-token-taller-fact';

const recibidos = []; // { ts, herramienta, args, repetido }
const vistos = new Map(); // id_mensaje → respuesta de la primera vez
let fallosPendientes = 0;

const orden = (codigo, estado) => ({ codigo, estado });

function fabrica() {
  const servidor = new McpServer({ name: 'taller-simulado', version: '1.0' });
  const registrar = (nombre, entrada, estadoNuevo) =>
    servidor.registerTool(nombre, { title: nombre, description: `Simulado: ${nombre}`, inputSchema: entrada }, async (args) => {
      if (fallosPendientes > 0) {
        fallosPendientes--;
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { codigo: 'PROVEEDOR_NO_DISPONIBLE', mensaje: 'Taller simulado caído a propósito', reintentable: true } }) }] };
      }
      const previo = args.id_mensaje ? vistos.get(args.id_mensaje) : undefined;
      recibidos.push({ ts: new Date().toISOString(), herramienta: nombre, args, repetido: Boolean(previo) });
      const respuesta = previo ?? orden(args.codigo, estadoNuevo(args));
      if (args.id_mensaje && !previo) vistos.set(args.id_mensaje, respuesta);
      return { content: [{ type: 'text', text: JSON.stringify(respuesta) }], structuredContent: respuesta };
    });
  registrar(
    'registrar_respuesta_cliente',
    z.object({
      codigo: z.string(), aceptada: z.boolean(), motivo: z.string().optional(), referencia: z.string().optional(), id_mensaje: z.string().max(120).optional(),
      orden_compra: z.array(z.object({
        codigo_repuesto: z.string(), descripcion: z.string().optional(), cantidad: z.number().int(), tienda: z.string(), precio_unitario: z.number().int(),
        pagador: z.enum(['cliente', 'fabricante', 'tienda', 'taller']).optional(),
      })).optional(),
    }),
    (a) => (a.aceptada ? 'aprobada' : 'rechazada'),
  );
  registrar(
    'registrar_pago',
    z.object({ codigo: z.string(), referencia_pse: z.string(), valor: z.number().int().min(0), id_mensaje: z.string().max(120).optional() }),
    () => 'facturada',
  );
  return servidor;
}
const atender = toNodeHandler(createMcpHandler(fabrica));

const leer = (req) => new Promise((r) => { let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => r(t)); });
const json = (res, estado, cuerpo) => { res.writeHead(estado, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(cuerpo)); };

createServer(async (req, res) => {
  try {
    const ruta = new URL(req.url, 'http://x').pathname;
    if (ruta === '/salud') return json(res, 200, { servicio: 'taller-simulado', estado: 'ok' });
    if (ruta === '/recibidos') return json(res, 200, recibidos);
    if (ruta === '/sandbox/limpiar') { recibidos.length = 0; vistos.clear(); fallosPendientes = 0; return json(res, 200, { limpio: true }); }
    if (ruta === '/sandbox/fallar') { fallosPendientes = Number(JSON.parse((await leer(req)) || '{}').n ?? 1); return json(res, 200, { fallosPendientes }); }
    if (ruta === '/mcp') {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.setHeader('WWW-Authenticate', 'Bearer'); return json(res, 401, { error: 'Token inválido' }); }
      const cuerpo = req.method === 'POST' ? await leer(req) : '';
      req.auth = { token: TOKEN, clientId: 'facturacion', scopes: [], extra: {} };
      return await atender(req, res, cuerpo ? JSON.parse(cuerpo) : undefined);
    }
    json(res, 404, { error: 'No existe la ruta' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Error interno' });
  }
}).listen(PUERTO, () => console.log(`Taller simulado (Facturación) en http://localhost:${PUERTO}`));
