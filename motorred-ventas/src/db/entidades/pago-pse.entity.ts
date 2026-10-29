import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Pago PSE simulado del contrato real del taller (notificar_reparacion_terminada → registrar_pago).
// No es lo mismo que CobroEntity (esa es del contrato del kit / pasarela simulada).
@Entity({ name: 'pagos_pse' })
export class PagoPseEntity {
  @PrimaryColumn({ type: 'varchar' })
  referencia_pse!: string;

  @Column({ type: 'varchar' })
  codigo!: string;

  @Column({ type: 'varchar' })
  cotizacion_ref!: string;

  @Column({ type: 'integer' })
  valor!: number;

  // pendiente | confirmado
  @Column({ type: 'varchar', default: 'pendiente' })
  estado!: string;

  @Column({ type: 'varchar' })
  id_mensaje_entrada!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  creado_en!: Date;
}
