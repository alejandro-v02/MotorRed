// Oyente mínimo para verificar qué le mandamos a n8n, sin necesitar n8n corriendo.
//   node pruebas/n8n-falso.mjs [puerto]
import { createServer } from 'node:http';
const PUERTO = Number(process.argv[2] ?? 5679);
createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    console.log(`[n8n-falso] ${req.method} ${req.url}\n`, cuerpo);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
}).listen(PUERTO, () => console.log(`n8n-falso en el puerto ${PUERTO}`));
