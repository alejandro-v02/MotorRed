import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { embeber, vectorSql } from '../agentes/embeddings.js';
import { RAIZ } from '../config.js';
import { dataSource } from './datasource.js';

// npm run seed
// Parámetros de PRÁCTICA vigentes desde el inicio del proyecto. Confírmelos con un contador: ver
// Concepto 5 e Instituto Nacional de Contadores Públicos (2025) en los referentes del Instructivo 5.
const VIGENTE_DESDE = '2026-01-01';
const PARAMETROS = [
  { concepto: 'iva_general', tarifa: 19, base_uvt: null, valor: null },
  { concepto: 'comision_plataforma', tarifa: 3, base_uvt: null, valor: null },
  { concepto: 'uvt', tarifa: null, base_uvt: null, valor: 52374 },
  { concepto: 'retefuente_servicio', tarifa: 4, base_uvt: 2, valor: null },
  { concepto: 'retefuente_repuesto', tarifa: 2.5, base_uvt: 10, valor: null },
];

function partirEnFragmentos(contenidoMarkdown: string, fuente: string) {
  const sinFrontmatter = contenidoMarkdown.replace(/^---[\s\S]*?---\n/, '').trim();
  const bloques = sinFrontmatter.split(/\n(?=## )/g);
  return bloques
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => ({ titulo: b.split('\n')[0].replace(/^#+\s*/, '').trim() || fuente, contenido: b }));
}

await dataSource.initialize();

const yaTiene = await dataSource.query(`SELECT count(*)::int AS n FROM parametros_tributarios`);
if (yaTiene[0].n === 0) {
  for (const p of PARAMETROS) {
    await dataSource.query(
      `INSERT INTO parametros_tributarios (concepto, tarifa, base_uvt, valor, vigente_desde) VALUES ($1, $2, $3, $4, $5)`,
      [p.concepto, p.tarifa, p.base_uvt, p.valor, VIGENTE_DESDE],
    );
  }
  console.log(`parametros_tributarios: ${PARAMETROS.length} filas insertadas (vigentes desde ${VIGENTE_DESDE}).`);
} else {
  console.log('parametros_tributarios ya tiene datos; no se reinsertaron.');
}

const carpeta = join(RAIZ, 'docs', 'conocimiento');
const archivos = readdirSync(carpeta).filter((f) => f.endsWith('.md'));
let total = 0;
for (const archivo of archivos) {
  await dataSource.query(`DELETE FROM fragmentos_conocimiento WHERE fuente = $1`, [archivo]);
  const contenido = readFileSync(join(carpeta, archivo), 'utf8');
  const fragmentos = partirEnFragmentos(contenido, archivo);
  for (const f of fragmentos) {
    const vector = await embeber(`${f.titulo}\n${f.contenido}`);
    await dataSource.query(
      `INSERT INTO fragmentos_conocimiento (titulo, contenido, fuente, embedding) VALUES ($1, $2, $3, $4::vector)`,
      [f.titulo, f.contenido, archivo, vectorSql(vector)],
    );
    total++;
  }
  console.log(`${archivo}: ${fragmentos.length} fragmentos indexados.`);
}
console.log(`RAG: ${total} fragmentos en total.`);

await dataSource.destroy();
