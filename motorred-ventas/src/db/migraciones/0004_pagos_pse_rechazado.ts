import type { MigrationInterface, QueryRunner } from 'typeorm';

// La pasarela de pago simulada (/pagos/<referencia>) tiene el botón "Simular pago rechazado", que
// deja el pago en estado 'rechazado'. La restricción original solo admitía 'pendiente' y
// 'confirmado', así que ese botón terminaba en un error 500 de la base de datos.
export class PagosPseRechazado1769700200000 implements MigrationInterface {
  name = 'PagosPseRechazado1769700200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE pagos_pse DROP CONSTRAINT pagos_pse_estado_check`);
    await q.query(`ALTER TABLE pagos_pse ADD CONSTRAINT pagos_pse_estado_check CHECK (estado IN ('pendiente','confirmado','rechazado'))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Un pago rechazado no cabe en la restricción anterior: vuelve a 'pendiente' para poder revertir.
    await q.query(`UPDATE pagos_pse SET estado = 'pendiente' WHERE estado = 'rechazado'`);
    await q.query(`ALTER TABLE pagos_pse DROP CONSTRAINT pagos_pse_estado_check`);
    await q.query(`ALTER TABLE pagos_pse ADD CONSTRAINT pagos_pse_estado_check CHECK (estado IN ('pendiente','confirmado'))`);
  }
}
