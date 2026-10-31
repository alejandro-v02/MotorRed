import type { MigrationInterface, QueryRunner } from 'typeorm';

// Guarda las líneas REALES por las que se cobra (lo que notificar_reparacion_terminada reportó
// como hecho/usado), para que confirmarPago liquide sobre eso y no sobre la cotización original
// — que puede pedir más repuestos de los que al final se usaron. Bug real encontrado probando
// la integración con la API del concesionario (ver tienda-buscador.service.ts): sin esto,
// confirmarPago volvía a armar las líneas desde orden_compra (cantidad cotizada, no la usada) y
// el total ya no cuadraba con pago.valor (calculado sí sobre lo realmente usado), violando
// ventas_iva_check.
export class PagosPseLineas1769700100000 implements MigrationInterface {
  name = 'PagosPseLineas1769700100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE pagos_pse ADD COLUMN lineas_cobro jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE pagos_pse DROP COLUMN lineas_cobro`);
  }
}
