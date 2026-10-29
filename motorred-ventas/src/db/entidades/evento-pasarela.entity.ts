import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Idempotencia del webhook de la pasarela (POST /webhooks/pasarela): un evento_id se procesa una
// sola vez, aunque la pasarela lo reenvíe (PASARELA_DUPLICAR=1 en el simulador lo hace a propósito).
@Entity({ name: 'eventos_pasarela' })
export class EventoPasarelaEntity {
  @PrimaryColumn({ type: 'varchar' })
  evento_id!: string;

  @Column({ type: 'varchar' })
  cobro_id!: string;

  @Column({ type: 'varchar', nullable: true })
  venta_id!: string | null;

  @Column({ type: 'varchar' })
  tipo!: string;

  @Column({ type: 'integer' })
  monto!: number;

  // procesado | duplicado | ignorado | rechazado
  @Column({ type: 'varchar' })
  resultado!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  recibido_en!: Date;
}
