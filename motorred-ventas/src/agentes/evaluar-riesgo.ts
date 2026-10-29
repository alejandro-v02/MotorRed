import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ } from '../config.js';
import { clasificar, planB, type EntradaRiesgo, type HistorialPagador } from './agente-riesgo.service.js';

// node dist/agentes/evaluar-riesgo.js [--reglas] [--limite=120000]
// Igual en espíritu a pruebas/evaluar-diagnostico.mjs del kit: compara contra la línea base (las
// reglas, sin modelo) y contra el modelo, con los casos propios de docs/casos-riesgo.json.
interface Caso {
  id: string;
  descripcion: string;
  entrada: Omit<EntradaRiesgo, 'venta_id' | 'orden_id' | 'traza_id'>;
  historial: HistorialPagador;
  esperado: 'bajo' | 'medio' | 'alto';
}

const soloReglas = process.argv.includes('--reglas');
const orden = { bajo: 0, medio: 1, alto: 2 } as const;

const casos: Caso[] = JSON.parse(readFileSync(join(RAIZ, 'docs', 'casos-riesgo.json'), 'utf8'));
console.log(`Evaluación del agente de Riesgo: ${soloReglas ? 'línea base (reglas, sin modelo)' : 'con modelo'}\n`);

let aciertos = 0;
let peligrosos = 0;
let conservadores = 0;
let planBusado = 0;
const latencias: number[] = [];

for (const c of casos) {
  const entrada: EntradaRiesgo = { venta_id: null, orden_id: `OT-EVAL-${c.id}`, traza_id: '00000000-0000-0000-0000-000000000000', ...c.entrada };
  const inicio = Date.now();
  const resultado = soloReglas ? { ...planB(entrada, c.historial), fuente: 'plan_b' as const, tiempo_ms: 0 } : await clasificar(entrada, c.historial);
  const ms = soloReglas ? Date.now() - inicio : resultado.tiempo_ms;
  latencias.push(ms);
  if (resultado.fuente === 'plan_b' && !soloReglas) planBusado++;

  let etiqueta: string;
  if (resultado.nivel_riesgo === c.esperado) {
    etiqueta = 'ACIERTO';
    aciertos++;
  } else if (orden[resultado.nivel_riesgo] < orden[c.esperado]) {
    etiqueta = 'PELIGROSO'; // clasificó MENOS riesgo del que debía: se saltaría una revisión necesaria
    peligrosos++;
  } else {
    etiqueta = 'conservador'; // clasificó MÁS riesgo del que debía: cuesta una revisión de más, no es peligroso
    conservadores++;
  }
  console.log(`${c.id} ${etiqueta.padEnd(10)} ${ms.toString().padStart(5)} ms  obtenido ${resultado.nivel_riesgo.padEnd(5)} esperado ${c.esperado.padEnd(5)}  ${c.descripcion}`);
}

const p50 = [...latencias].sort((a, b) => a - b)[Math.floor(latencias.length / 2)];
console.log(`\nAcierto: ${aciertos}/${casos.length} | Peligrosos (clasificó menos riesgo del real): ${peligrosos} | Conservadores (de más): ${conservadores}${soloReglas ? '' : ` | Plan B usado: ${planBusado}`}`);
console.log(`Latencia p50 ${p50} ms, máxima ${Math.max(...latencias)} ms`);
if (peligrosos > 0) process.exitCode = 1;
