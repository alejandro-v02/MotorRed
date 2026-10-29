import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { FACTURACION } from '../config.js';
import { BitacoraService } from '../mcp/bitacora.service.js';
import { PUERTO_TALLER, type PuertoTaller } from './puertos.js';

interface Fila {
  id: number;
  id_mensaje: string;
  tipo: string;
  traza_id: string | null;
  codigo: string | null;
  payload: Record<string, unknown>;
  intentos: number;
}

// Bandeja de salida hacia el Taller. Los mensajes (registrar_respuesta_cliente, registrar_pago) se
// guardan primero en mensajes_salida y de ahí se entregan con reintentos: si el Taller no responde,
// no se pierde la respuesta del cliente ni el pago (RG-11). Sin Taller configurado quedan pendientes.
@Injectable()
export class SalidaService implements OnModuleInit, OnModuleDestroy {
  private temporizador: NodeJS.Timeout | null = null;
  private procesando = false;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(PUERTO_TALLER) private readonly taller: PuertoTaller,
    private readonly bitacora: BitacoraService,
  ) {}

  onModuleInit(): void {
    this.temporizador = setInterval(() => void this.procesar(), 5_000);
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  // id_mensaje es único: encolar dos veces el mismo mensaje no lo duplica.
  async encolarParaTaller(m: { id_mensaje: string; tipo: 'registrar_respuesta_cliente' | 'registrar_pago'; traza_id: string; codigo: string; payload: Record<string, unknown> }): Promise<void> {
    await this.db.query(
      `INSERT INTO mensajes_salida (id_mensaje, destino, tipo, traza_id, codigo, payload) VALUES ($1,'taller',$2,$3,$4,$5) ON CONFLICT (id_mensaje) DO NOTHING`,
      [m.id_mensaje, m.tipo, m.traza_id, m.codigo, JSON.stringify(m.payload)],
    );
    this.bitacora.registrar({ traza_id: m.traza_id, evento: `encolado ${m.tipo}`, ok: true, codigo: m.codigo, id_mensaje: m.id_mensaje });
    setImmediate(() => void this.procesar());
  }

  async procesar(): Promise<number> {
    if (this.procesando || !this.taller.disponible()) return 0;
    this.procesando = true;
    let enviados = 0;
    try {
      const filas: Fila[] = await this.db.query(`SELECT id, id_mensaje, tipo, traza_id, codigo, payload, intentos FROM mensajes_salida WHERE destino = 'taller' AND estado = 'pendiente' ORDER BY id LIMIT 20`);
      for (const f of filas) {
        try {
          if (f.tipo === 'registrar_respuesta_cliente') await this.taller.registrarRespuestaCliente(f.payload as never);
          else if (f.tipo === 'registrar_pago') await this.taller.registrarPago(f.payload as never);
          else throw new Error(`tipo de mensaje desconocido: ${f.tipo}`);
          await this.db.query(`UPDATE mensajes_salida SET estado = 'enviado', intentos = intentos + 1, enviado_en = now(), ultimo_error = NULL WHERE id = $1`, [f.id]);
          this.bitacora.registrar({ traza_id: f.traza_id, evento: `enviado ${f.tipo}`, ok: true, codigo: f.codigo, id_mensaje: f.id_mensaje });
          enviados++;
        } catch (e) {
          const intentos = f.intentos + 1;
          const agotado = intentos >= FACTURACION.taller.reintentos;
          await this.db.query(`UPDATE mensajes_salida SET estado = $2, intentos = $3, ultimo_error = $4 WHERE id = $1`, [f.id, agotado ? 'fallido' : 'pendiente', intentos, (e as Error).message.slice(0, 500)]);
          this.bitacora.registrar({ traza_id: f.traza_id, evento: `fallo_envio ${f.tipo}`, ok: false, codigo: f.codigo, id_mensaje: f.id_mensaje, intentos, agotado, error: (e as Error).message });
        }
      }
    } finally {
      this.procesando = false;
    }
    return enviados;
  }

  listar(filtros: { estado?: string; destino?: string; codigo?: string }) {
    return this.db.query(
      `SELECT id, id_mensaje, destino, tipo, codigo, traza_id, payload, estado, intentos, ultimo_error, creado_en, enviado_en FROM mensajes_salida
       WHERE ($1::varchar IS NULL OR estado = $1) AND ($2::varchar IS NULL OR destino = $2) AND ($3::varchar IS NULL OR codigo = $3) ORDER BY id DESC LIMIT 200`,
      [filtros.estado ?? null, filtros.destino ?? null, filtros.codigo ?? null],
    );
  }

  // Un mensaje fallido (cinco intentos) vuelve a la cola cuando una persona lo decide.
  async reintentar(id: number): Promise<boolean> {
    const fallido = await this.db.query(`SELECT 1 FROM mensajes_salida WHERE id = $1 AND estado = 'fallido'`, [id]);
    if (!fallido.length) return false;
    await this.db.query(`UPDATE mensajes_salida SET estado = 'pendiente', intentos = 0 WHERE id = $1`, [id]);
    setImmediate(() => void this.procesar());
    return true;
  }
}
