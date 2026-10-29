import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Base de conocimiento del RAG (Actividad 4.4): políticas de cobro y de conciliación, escritas
// como notas de Obsidian en docs/conocimiento/ y cargadas por src/db/seed.ts.
// La columna embedding (vector(768), pgvector) se crea en la migración y se lee/escribe con SQL
// crudo desde RagService: TypeORM no necesita entender el tipo "vector" para el resto del CRUD.
@Entity({ name: 'fragmentos_conocimiento' })
export class FragmentoConocimientoEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  titulo!: string;

  @Column({ type: 'text' })
  contenido!: string;

  @Column({ type: 'varchar' })
  fuente!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  creado_en!: Date;
}
