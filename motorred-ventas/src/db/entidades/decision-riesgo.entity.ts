import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Bitácora de decisiones del agente de Riesgo (Concepto 3 y Trabajo 4): cada decisión queda
// registrada con el agente, la entrada, el resultado, si vino del modelo o del plan B, y el tiempo.
@Entity({ name: 'decisiones_riesgo' })
export class DecisionRiesgoEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', nullable: true })
  venta_id!: string | null;

  @Column({ type: 'varchar', nullable: true })
  orden_id!: string | null;

  @Column({ type: 'uuid', nullable: true })
  traza_id!: string | null;

  @Column({ type: 'varchar' })
  nivel_riesgo!: string;

  @Column({ type: 'jsonb' })
  motivos!: string[];

  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: true })
  confianza!: string | null;

  // modelo | plan_b
  @Column({ type: 'varchar' })
  fuente!: string;

  @Column({ type: 'varchar', nullable: true })
  modelo!: string | null;

  @Column({ type: 'integer' })
  tiempo_ms!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  creado_en!: Date;
}
