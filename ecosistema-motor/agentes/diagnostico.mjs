// Agente de diagnóstico del taller (referencia para el grupo Falla).
// 1) Recupera de la base de conocimiento las fallas parecidas (aquí por palabras; en el proyecto, con
//    pgvector). 2) Pide al modelo un diagnóstico que cumpla el esquema del contrato. 3) Aplica barandas
//    y lo compara con las reglas: si no coinciden o la confianza es baja, pide revisión humana.
//   node agentes/diagnostico.mjs "El carro tiembla y se apaga" P0302
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Diagnostico } from '../contrato/esquemas.mjs';
import { decidir, modeloDesdeEntorno } from '../lib/agente.mjs';
import { sinTildes } from '../lib/dinero.mjs';
import { diagnosticarPorReglas } from '../simuladores/taller.mjs';

const BASE = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'datos', 'base-fallas.json'), 'utf8'));

// Recuperación: puntaje por códigos y palabras compartidas. Devuelve las 3 reglas más parecidas.
export function recuperar(orden, k = 3) {
  const texto = sinTildes(orden.sintomas);
  return BASE.reglas
    .map((r) => ({ r, puntos: orden.codigos_dtc.filter((c) => r.dtc.includes(c)).length * 3 + r.palabras.filter((p) => texto.includes(p)).length }))
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, k)
    .map((x) => x.r);
}

// limiteMs: lo máximo que el taller espera al modelo; después usa las reglas (plan B) y pide revisión.
export async function diagnosticarConIA(orden, { modelo = modeloDesdeEntorno(), limiteMs = 120_000 } = {}) {
  const conocimiento = recuperar(orden);
  const mensajes = [
    {
      role: 'system',
      content:
        'Eres el jefe de taller de una red de mecánica automotriz en Colombia. Diagnosticas a partir de ' +
        'síntomas y códigos OBD-II. Usa SOLO las categorías de repuestos del esquema. Si la información no ' +
        'alcanza, baja la confianza y marca requiere_revision_humana. Responde únicamente el JSON pedido.\n' +
        'Casos de referencia de la base de conocimiento del taller:\n' +
        (conocimiento.length ? conocimiento.map((r) => `- ${r.hallazgo}. Repuestos: ${r.requerimientos.map((q) => `${q.cantidad} ${q.categoria}`).join(', ')}. Horas: ${r.horas}.`).join('\n') : '- (ningún caso parecido)'),
    },
    {
      role: 'user',
      content: `Vehículo: ${orden.vehiculo.marca} ${orden.vehiculo.linea} ${orden.vehiculo.modelo_anio}, motor ${orden.vehiculo.motor}, ${orden.vehiculo.kilometraje} km.\nSíntomas: ${orden.sintomas}\nCódigos de falla: ${orden.codigos_dtc.join(', ') || 'ninguno'}`,
    },
  ];
  const alertas = [];
  let diagnostico;
  try {
    ({ datos: diagnostico } = await decidir(modelo, Diagnostico, mensajes, { nombre: 'diagnostico', limiteMs }));
  } catch (e) {
    alertas.push(`El modelo falló (${e.message}); se usan las reglas del taller`);
    return { diagnostico: { ...diagnosticarPorReglas(orden), requiere_revision_humana: true }, fuente: 'reglas', alertas };
  }
  // Barandas de negocio sobre lo que propuso el modelo.
  for (const q of diagnostico.requerimientos) {
    if (q.cantidad > 8) { alertas.push(`Cantidad sospechosa: ${q.cantidad} ${q.categoria}`); diagnostico.requiere_revision_humana = true; }
  }
  if (diagnostico.mano_obra_horas > 12) { alertas.push('Más de 12 horas de mano de obra'); diagnostico.requiere_revision_humana = true; }
  const reglas = diagnosticarPorReglas(orden);
  const a = diagnostico.requerimientos.map((q) => q.categoria).sort().join();
  const b = reglas.requerimientos.map((q) => q.categoria).sort().join();
  if (reglas.requerimientos.length && a !== b) {
    alertas.push(`El modelo propone [${a}] y las reglas [${b}]`);
    diagnostico.requiere_revision_humana = true;
  }
  if (diagnostico.confianza < 0.7) {
    alertas.push(`Confianza del modelo ${diagnostico.confianza} (menor que 0.7)`);
    diagnostico.requiere_revision_humana = true;
  }
  return { diagnostico, fuente: 'ia', alertas };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sintomas = 'El carro tiembla en ralentí y se apaga', ...dtc] = process.argv.slice(2);
  const orden = { sintomas, codigos_dtc: dtc, vehiculo: { marca: 'Chevrolet', linea: 'Spark GT', modelo_anio: 2016, motor: '1.2L gasolina', kilometraje: 128400 } };
  const m = modeloDesdeEntorno();
  console.log(`Modelo: ${m.modelo} en ${m.url}`);
  const inicio = Date.now();
  const r = await diagnosticarConIA(orden, { modelo: m });
  console.log(JSON.stringify(r, null, 2));
  console.log(`(${Date.now() - inicio} ms)`);
}
