import { Injectable, Logger } from '@nestjs/common';

export interface OfertaTienda {
  tienda: string;
  precio_unitario: number;
}

// SIMULADO: todavía no tenemos el contrato real de tienda (José) ni de concesionario (Emerson)
// para pedir precio por codigo_repuesto (ver docs/contratos-reales/mcp-taller.md y ADR 0003).
// Catálogo en memoria con los códigos universales que sí aparecen en el documento del taller,
// cada uno con 1-2 tiendas y precios de práctica. Reemplazar este servicio por una llamada MCP
// real en cuanto José/Emerson publiquen su propio contrato: la interfaz pública (buscar) no
// debería tener que cambiar en quien lo use.
const CATALOGO: Record<string, OfertaTienda[]> = {
  'ACE-5W30-1L': [{ tienda: 'AutoPartes La 68', precio_unitario: 38000 }, { tienda: 'Repuestos Bogotá', precio_unitario: 41500 }],
  'ALT-90A-STD': [{ tienda: 'AutoPartes La 68', precio_unitario: 310000 }],
  'AMO-DEL-GAS': [{ tienda: 'AutoPartes La 68', precio_unitario: 144150 }, { tienda: 'Repuestos Bogotá', precio_unitario: 152000 }],
  'AMO-TRA-GAS': [{ tienda: 'AutoPartes La 68', precio_unitario: 128000 }],
  'BAT-12V-60AH': [{ tienda: 'Repuestos Bogotá', precio_unitario: 395000 }],
  'BOB-ENC-STD': [{ tienda: 'AutoPartes La 68', precio_unitario: 85000 }],
  'BUJ-IRI-STD': [{ tienda: 'AutoPartes La 68', precio_unitario: 42000 }, { tienda: 'Repuestos Bogotá', precio_unitario: 39500 }],
  'DIS-DEL-VENT': [{ tienda: 'AutoPartes La 68', precio_unitario: 165000 }],
  'FIL-ACE-STD': [{ tienda: 'AutoPartes La 68', precio_unitario: 28000 }, { tienda: 'Repuestos Bogotá', precio_unitario: 26500 }],
  'FIL-AIRE-STD': [{ tienda: 'AutoPartes La 68', precio_unitario: 45000 }],
  'KIT-EMB-STD': [{ tienda: 'Repuestos Bogotá', precio_unitario: 620000 }],
  'LIQ-FRE-DOT4': [{ tienda: 'AutoPartes La 68', precio_unitario: 32000 }],
  'PAS-DEL-CER': [{ tienda: 'AutoPartes La 68', precio_unitario: 172050 }, { tienda: 'Repuestos Bogotá', precio_unitario: 168000 }],
  'PAS-TRA-CER': [{ tienda: 'AutoPartes La 68', precio_unitario: 155000 }],
  'SEN-OXI-STD': [{ tienda: 'AutoPartes La 68', precio_unitario: 210000 }],
};
// Para un código que no esté en el catálogo (repuestos "describa el repuesto" sin SKU conocido):
// precio de práctica por defecto, para que la cotización no se caiga en la demo.
const PRECIO_DESCONOCIDO = 95000;

@Injectable()
export class TiendaBuscadorService {
  private readonly logger = new Logger(TiendaBuscadorService.name);

  // La más barata disponible para ese código.
  async buscar(codigo_repuesto: string): Promise<OfertaTienda> {
    const ofertas = CATALOGO[codigo_repuesto];
    if (!ofertas?.length) {
      this.logger.warn(`SIMULADO: "${codigo_repuesto}" no está en el catálogo simulado; usando precio de práctica $${PRECIO_DESCONOCIDO}.`);
      return { tienda: 'AutoPartes La 68', precio_unitario: PRECIO_DESCONOCIDO };
    }
    return [...ofertas].sort((a, b) => a.precio_unitario - b.precio_unitario)[0];
  }
}
