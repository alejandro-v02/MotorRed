import { RAG } from '../config.js';

// Embeddings con Ollama local (ollama pull nomic-embed-text). Quien reemplace el modelo debe
// ajustar RAG.dimensiones en .env para que coincida con vector(N) de la migración.
export async function embeber(texto: string): Promise<number[]> {
  const r = await fetch(`${RAG.ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: RAG.modeloEmbedding, prompt: texto }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => {
    throw new Error(`Ollama no respondió en ${RAG.ollamaUrl} (¿está corriendo? ¿"ollama pull ${RAG.modeloEmbedding}"?): ${(e as Error).message}`);
  });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status} al pedir el embedding`);
  const datos = (await r.json()) as { embedding?: number[] };
  if (!Array.isArray(datos.embedding) || datos.embedding.length !== RAG.dimensiones) {
    throw new Error(`El embedding de ${RAG.modeloEmbedding} tiene ${datos.embedding?.length ?? 0} dimensiones; se esperaban ${RAG.dimensiones} (ajuste EMBED_DIMENSIONES)`);
  }
  return datos.embedding;
}

// '[0.1,0.2,...]' — la representación de texto que pgvector acepta con ::vector.
export const vectorSql = (v: number[]) => `[${v.join(',')}]`;
