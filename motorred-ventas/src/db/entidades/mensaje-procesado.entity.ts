import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Idempotencia de las llamadas asíncronas del taller real (crear_cotizacion,
// notificar_reparacion_terminada): "en un reintento envíe el mismo id_mensaje: el taller
// devuelve la respuesta de la primera vez sin repetir el cambio" — aplicamos la misma regla
// de nuestro lado para los mensajes que RECIBIMOS.
@Entity({ name: 'mensajes_procesados' })
export class MensajeProcesadoEntity {
  @PrimaryColumn({ type: 'varchar' })
  id_mensaje!: string;

  @Column({ type: 'varchar' })
  herramienta!: string;

  @Column({ type: 'varchar', nullable: true })
  codigo!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  recibido_en!: Date;
}
