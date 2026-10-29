import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { embeber, vectorSql } from './embeddings.js';

export interface FragmentoRecuperado {
  id: number;
  titulo: string;
  contenido: string;
  fuente: string;
  distancia: number;
}

// RAG por significado (vectores), no por palabras clave: a diferencia del recuperar() del kit
// (agentes/diagnostico.mjs), aquí se compara el embedding de la pregunta contra el de cada
// fragmento con distancia coseno (operador <=> de pgvector) y se usa un índice HNSW.
@Injectable()
export class RagService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  // Parte una nota de Obsidian en fragmentos por encabezado "## ", para que cada fragmento sea
  // una unidad de sentido completa y citable (fuente + título).
  partirEnFragmentos(contenidoMarkdown: string, fuente: string): { titulo: string; contenido: string }[] {
    const sinFrontmatter = contenidoMarkdown.replace(/^---[\s\S]*?---\n/, '').trim();
    const bloques = sinFrontmatter.split(/\n(?=## )/g);
    return bloques
      .map((b) => b.trim())
      .filter(Boolean)
      .map((b) => {
        const primeraLinea = b.split('\n')[0].replace(/^#+\s*/, '').trim();
        return { titulo: primeraLinea || fuente, contenido: b };
      });
  }

  async indexar(fuente: string, contenidoMarkdown: string): Promise<number> {
    const fragmentos = this.partirEnFragmentos(contenidoMarkdown, fuente);
    for (const f of fragmentos) {
      const vector = await embeber(`${f.titulo}\n${f.contenido}`);
      await this.db.query(
        `INSERT INTO fragmentos_conocimiento (titulo, contenido, fuente, embedding) VALUES ($1, $2, $3, $4::vector)`,
        [f.titulo, f.contenido, fuente, vectorSql(vector)],
      );
    }
    return fragmentos.length;
  }

  async limpiarFuente(fuente: string): Promise<void> {
    await this.db.query(`DELETE FROM fragmentos_conocimiento WHERE fuente = $1`, [fuente]);
  }

  async recuperar(consulta: string, k = 4): Promise<FragmentoRecuperado[]> {
    const vector = await embeber(consulta);
    const filas = await this.db.query(
      `SELECT id, titulo, contenido, fuente, embedding <=> $1::vector AS distancia
       FROM fragmentos_conocimiento ORDER BY embedding <=> $1::vector LIMIT $2`,
      [vectorSql(vector), k],
    );
    return filas as FragmentoRecuperado[];
  }
}
