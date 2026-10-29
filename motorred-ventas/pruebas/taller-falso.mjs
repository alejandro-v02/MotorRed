// Taller FALSO mínimo, solo para probar nuestra integración de facturación de punta a punta:
// expone /mcp con registrar_respuesta_cliente y registrar_pago, y guarda lo que recibe.
//   node pruebas/taller-falso.mjs [puerto]
import { createServer } from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';

const PUERTO = Number(process.argv[2] ?? 3001);
const TOKEN = process.env.MCP_TALLER_TOKEN ?? 'lab-taller-token-cambie-esto';
export const recibidos = [];

const fabrica = () => {
  const servidor = new McpServer({ name: 'taller-falso', version: '1.0.0' });
  servidor.registerTool(
    'registrar_respuesta_cliente',
    {
      title: 'Registrar respuesta del cliente',
      inputSchema: z.object({ codigo: z.string(), aceptada: z.boolean(), motivo: z.string().optional(), referencia: z.string(), orden_compra: z.array(z.any()), id_mensaje: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
    },
    async (args) => {
      console.log('[taller-falso] registrar_respuesta_cliente', JSON.stringify(args));
      recibidos.push({ herramienta: 'registrar_respuesta_cliente', args });
      return { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } };
    },
  );
  servidor.registerTool(
    'registrar_pago',
    {
      title: 'Registrar pago',
      inputSchema: z.object({ codigo: z.string(), referencia_pse: z.string(), valor: z.number(), id_mensaje: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
    },
    async (args) => {
      console.log('[taller-falso] registrar_pago', JSON.stringify(args));
      recibidos.push({ herramienta: 'registrar_pago', args });
      return { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } };
    },
  );
  return servidor;
};
const atender = toNodeHandler(createMcpHandler(fabrica));

const servidor = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/salud') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ servicio: 'taller-falso', estado: 'ok' }));
  }
  if (req.url === '/mcp') {
    const [tipo, token] = String(req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || token !== TOKEN) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' });
      return res.end('{"error":"token invalido"}');
    }
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', async () => {
      req.body = cuerpo ? JSON.parse(cuerpo) : undefined;
      await atender(req, res, req.body);
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
servidor.listen(PUERTO, () => console.log(`taller-falso en el puerto ${PUERTO} (token esperado: ${TOKEN})`));
