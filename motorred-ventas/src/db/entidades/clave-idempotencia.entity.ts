import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Idempotencia de crear_venta: misma clave del mismo cliente + misma huella de los datos =
// mismo resultado; misma clave con otros datos = IDEMPOTENCIA_CONFLICTO (regla del contrato).
@Entity({ name: 'claves_idempotencia' })
export class ClaveIdempotenciaEntity {
  @PrimaryColumn({ type: 'varchar' })
  cliente!: string;

  @PrimaryColumn({ type: 'varchar' })
  clave!: string;

  @Column({ type: 'varchar' })
  huella!: string;

  @Column({ type: 'varchar' })
  operacion!: string;

  @Column({ type: 'varchar', nullable: true })
  venta_id!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creado_en!: Date;
}
