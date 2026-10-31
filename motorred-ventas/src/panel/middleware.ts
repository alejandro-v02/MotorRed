import type { NextFunction, Request, Response } from 'express';
import { redactar, registroPanel, type Canal } from './registro.js';

function canalDe(ruta: string): Canal {
  if (ruta.startsWith('/mcp-facturacion')) return 'mcp-facturacion';
  if (ruta.startsWith('/mcp')) return 'mcp-ventas';
  if (ruta.startsWith('/facturacion')) return 'facturacion';
  if (ruta.startsWith('/webhook')) return 'webhook';
  return 'otro';
}

// Para JSON-RPC (MCP) muestra "tools/call crear_cotizacion" en vez de solo "POST /mcp-facturacion".
function resumenDe(req: Request, ruta: string): string {
  const b = req.body as { method?: string; params?: { name?: string } } | undefined;
  if (b && typeof b === 'object' && typeof b.method === 'string') {
    return b.params?.name ? `${b.method} ${b.params.name}` : b.method;
  }
  return `${req.method} ${ruta}`;
}

function intentarJson(texto: string): unknown {
  const limpio = texto.trim();
  if (!limpio) return undefined;
  try {
    return JSON.parse(limpio);
  } catch {
    // Respuestas MCP en SSE: "event: message\ndata: {...}"
    const linea = limpio.split('\n').find((l) => l.startsWith('data:'));
    if (linea) {
      try {
        return JSON.parse(linea.slice(5).trim());
      } catch {
        /* cae al texto */
      }
    }
    return limpio;
  }
}

// Registra cada petición entrante (menos el propio panel y /salud, que harían ruido). Se instala
// con app.use() antes de listen(); el cuerpo ya está parseado cuando la respuesta termina.
export function middlewarePanel(req: Request, res: Response, next: NextFunction) {
  const ruta = req.originalUrl.split('?')[0];
  if (ruta.startsWith('/panel') || ruta === '/salud') return next();

  const t0 = Date.now();
  const trozos: Buffer[] = [];
  let bytes = 0;
  const guardar = (c: unknown) => {
    if (c == null || typeof c === 'function' || bytes > 16_000) return;
    const b = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
    trozos.push(b);
    bytes += b.length;
  };
  const write = res.write.bind(res) as (...a: unknown[]) => boolean;
  const end = res.end.bind(res) as (...a: unknown[]) => Response;
  res.write = ((c: unknown, ...r: unknown[]) => { guardar(c); return write(c, ...r); }) as never;
  res.end = ((c?: unknown, ...r: unknown[]) => { guardar(c); return end(c, ...r); }) as never;

  res.on('finish', () => {
    const respuesta = intentarJson(Buffer.concat(trozos).toString('utf8'));
    registroPanel.agregar({
      direccion: 'entrante',
      canal: canalDe(ruta),
      resumen: resumenDe(req, ruta),
      metodo: req.method,
      ruta,
      estado: res.statusCode,
      ok: res.statusCode < 400,
      ms: Date.now() - t0,
      peticion: redactar(req.body),
      respuesta: redactar(respuesta),
    });
  });
  next();
}
