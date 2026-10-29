import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

// SIMULADO: no hay pasarela PSE real ni simulada definida para este contrato (ver ADR 0003).
// Genera una referencia; la confirmación se simula con
// POST /facturacion/sandbox/pse/:referencia_pse/confirmar.
@Injectable()
export class PseSimuladoService {
  private readonly logger = new Logger(PseSimuladoService.name);

  generarReferencia(): string {
    return `PSE-${Date.now()}${randomUUID().slice(0, 4)}`;
  }

  async enlacePago(referencia_pse: string, valor: number): Promise<string> {
    const url = `http://localhost:3000/facturacion/sandbox/pse/${referencia_pse}/pagina`;
    this.logger.log(`SIMULADO PSE: referencia ${referencia_pse} por $${valor.toLocaleString('es-CO')} → ${url}`);
    return url;
  }
}
