import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AGENTE_LLM } from '../config.js';
import { redactar, registroPanel } from '../panel/registro.js';
import { ClienteTallerReal } from './cliente-taller.js';
import {
  listaTexto, TiendaBuscadorService,
  type LineaPedido, type OfertaDatosT, type PedidoT, type RespuestaAgenteT,
} from './tienda-buscador.service.js';

// Agente de Facturación. Recibe un EVENTO del negocio (cotizar, el cliente aceptó, la reparación
// terminó, el cliente pagó) y DECIDE qué herramienta usar y a qué servicio llamar:
//   - hablar_con_repuestos: le escribe (en español, redactado por el agente) al agente de repuestos.
//   - avisar_taller: informa al taller (registrar_respuesta_cliente / registrar_pago).
//   - terminar: cuando considera que ya hizo todo.
// El modelo devuelve JSON validado con zod (no exige herramientas nativas: gemma3:4b no las tiene).
//
// Barandas (el agente decide el CÓMO y el orden; el código decide el QUÉ y cuida el dinero):
//  - Cifras: precios, cantidades y totales NUNCA salen del modelo. Los precios vienen de datos[] de
//    repuestos y los argumentos de avisar_taller los pone el código desde la base de datos.
//  - Intención permitida: el mensaje a repuestos debe corresponder al evento (no se puede "pagar"
//    mientras se cotiza), nombrar cada repuesto con su cantidad, y la referencia PSE si es un pago.
//  - id_mensaje lo genera el código: reintentar nunca duplica un apartado, entrega ni pago.
//  - Máximo de pasos, tiempo por decisión y una sola llamada por intención que compromete stock.
//  - Plan B: si el modelo no responde, se equivoca o se queda corto, el código ejecuta lo que
//    faltaba con mensajes de plantilla (el flujo de siempre). Queda marcado en el panel.

export type TipoEvento = 'cotizar' | 'aceptada' | 'terminada' | 'pagada';

export interface EventoFacturacion {
  tipo: TipoEvento;
  codigo_orden: string;
  hechos: Record<string, unknown>; // lo que ve el modelo (sin secretos)
  repuestos: LineaPedido[]; // repuestos que el mensaje debe nombrar (puede ir vacío)
  hablar: boolean; // ¿hay que hablar con repuestos en este evento?
  referencia_pse?: string;
  id_repuestos: string; // id_mensaje de la intención principal hacia repuestos
  repuestos_critico?: boolean; // si hablar falla, relanzar (cotizar necesita los precios)
  taller?: { herramienta: string; args: Record<string, unknown> }; // aviso obligatorio al taller
}

export interface ResultadoAgente {
  datos: Map<string, OfertaDatosT>; // por codigo_repuesto (lo último que dijo repuestos)
  respuestas: RespuestaAgenteT[];
  pedido: PedidoT | null;
  plan_b: string[]; // acciones que ejecutó el código porque el agente no las hizo
  pasos: number;
}

const Decision = z.object({
  razon: z.string().max(500),
  accion: z.enum(['hablar_con_repuestos', 'avisar_taller', 'terminar']),
  mensaje: z.string().max(700).optional(),
});
type DecisionT = z.infer<typeof Decision>;

const INTENCION: Record<TipoEvento, { descripcion: string; debe: RegExp; prohibido: RegExp; ejemplo: (e: EventoFacturacion) => string }> = {
  cotizar: {
    descripcion: 'Pedir precio y disponibilidad (NO apartar nada).',
    debe: /cotiz|precio|disponib/i,
    prohibido: /apart|entreg|pagamos|cancela|usaron/i,
    ejemplo: (e) => `Cotiza ${listaTexto(e.repuestos)} para la ${e.codigo_orden}`,
  },
  aceptada: {
    descripcion: 'El cliente aceptó la cotización: pedir que aparten los repuestos.',
    debe: /apart/i,
    prohibido: /cancela|pagamos|entreg|usaron|cotiza/i,
    ejemplo: (e) => `El cliente aceptó: aparta ${listaTexto(e.repuestos)}`,
  },
  terminada: {
    descripcion: 'El taller terminó: informar qué repuestos se usaron (lo no usado lo libera repuestos).',
    debe: /usaron|no se us/i,
    prohibido: /apart|cancela|pagamos|cotiza/i,
    ejemplo: (e) => (e.repuestos.length ? `Terminamos: se usaron ${listaTexto(e.repuestos)}` : 'Terminamos: no se usó ningún repuesto, libera todo lo apartado'),
  },
  pagada: {
    descripcion: 'El cliente pagó: informar que pagamos los repuestos, con la referencia PSE.',
    debe: /pagamos/i,
    prohibido: /apart|cancela|entreg|usaron|cotiza/i,
    ejemplo: (e) => `Pagamos los repuestos, referencia ${e.referencia_pse}`,
  },
};

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class AgenteFacturacionService {
  private readonly logger = new Logger(AgenteFacturacionService.name);

  constructor(
    private readonly tiendas: TiendaBuscadorService,
    private readonly taller: ClienteTallerReal,
  ) {}

  // -------------------------------------------------------------------------- barandas ----

  // null = válido; si no, el motivo (se le devuelve al modelo para que corrija).
  private validarMensaje(ev: EventoFacturacion, mensaje: string | undefined): string | null {
    const m = (mensaje ?? '').trim();
    if (!m) return 'Falta el campo "mensaje".';
    const reglas = INTENCION[ev.tipo];
    if (!reglas.debe.test(m)) return `Este evento es "${ev.tipo}": ${reglas.descripcion} Ejemplo: "${reglas.ejemplo(ev)}".`;
    if (reglas.prohibido.test(m)) return `El mensaje pide algo que no corresponde a este evento. ${reglas.descripcion} Ejemplo: "${reglas.ejemplo(ev)}".`;
    for (const l of ev.repuestos) {
      const c = escapar(l.codigo_repuesto);
      // Acepta "2 AMO", "2x AMO", "2 unidades de AMO", "AMO x 2", "AMO (nombre) x 2", "AMO, cantidad 2".
      const cantidad = new RegExp(
        `\\b${l.cantidad}\\s*(?:x|×|unidades?\\s+(?:de\\s+)?)?\\s*${c}|${c}(?:\\s*\\([^)]*\\))?\\s*(?:x|×|,?\\s*cantidad:?)\\s*${l.cantidad}\\b`,
        'i',
      );
      if (!cantidad.test(m)) return `Debes nombrar ${l.cantidad} unidad(es) de ${l.codigo_repuesto} (por ejemplo "${l.cantidad} ${l.codigo_repuesto}"), con el código exacto.`;
    }
    if (ev.tipo === 'pagada' && ev.referencia_pse && !m.includes(ev.referencia_pse)) return `Debes incluir la referencia exacta ${ev.referencia_pse}.`;
    return null;
  }

  // Revisa lo que repuestos dice haber hecho. Solo avisa: el negocio no se detiene por esto.
  private verificar(ev: EventoFacturacion, r: RespuestaAgenteT) {
    if (ev.tipo === 'aceptada') {
      for (const l of ev.repuestos) {
        const apartada = r.pedido?.lineas.find((x) => x.codigo_repuesto === l.codigo_repuesto)?.cantidad_apartada ?? 0;
        if (apartada < l.cantidad) {
          this.logger.error(`Orden ${ev.codigo_orden}: se pidió apartar ${l.cantidad} de ${l.codigo_repuesto} y quedaron ${apartada}. Respuesta: ${r.respuesta.slice(0, 200)}`);
        }
      }
    }
    if (ev.tipo === 'pagada' && r.pedido && r.pedido.referencia_pago !== ev.referencia_pse) {
      this.logger.warn(`Orden ${ev.codigo_orden}: pagamos con ${ev.referencia_pse} pero el pedido quedó con referencia_pago=${r.pedido.referencia_pago}`);
    }
  }

  // ------------------------------------------------------------------------------ modelo ----

  private prompt(ev: EventoFacturacion, historial: string[], pendientes: string[]) {
    const reglas = INTENCION[ev.tipo];
    const sistema = [
      'Eres el agente de Facturación de MotorRed (grupo Ventas). Coordinas con el agente de repuestos y con el taller.',
      'En cada turno eliges UNA acción y respondes SOLO un JSON: {"razon": "...", "accion": "...", "mensaje": "..."}.',
      'Acciones:',
      '- "hablar_con_repuestos": le escribes en español al agente de repuestos (campo "mensaje"). Usa los códigos de repuesto exactos.',
      '- "avisar_taller": el sistema informa al taller con los datos que ya tiene (no escribas "mensaje").',
      '- "terminar": solo cuando ya no queda nada pendiente.',
      'Reglas: nunca inventes precios, cantidades ni referencias; usa solo los hechos dados. No repitas una acción ya hecha.',
      `Evento actual: "${ev.tipo}". ${reglas.descripcion}`,
      `El mensaje a repuestos debe ser breve, con los códigos y cantidades EXACTOS, sin pedir nada más. Formato de referencia: "${reglas.ejemplo(ev)}"`,
    ].join('\n');
    const usuario = [
      `Orden: ${ev.codigo_orden}`,
      `Hechos: ${JSON.stringify(ev.hechos)}`,
      `Pendiente por hacer: ${pendientes.length ? pendientes.join('; ') : 'nada'}`,
      historial.length ? `Lo que ya hiciste y sus resultados:\n${historial.map((h, i) => `${i + 1}. ${h}`).join('\n')}` : 'Aún no has hecho nada.',
      'Elige tu siguiente acción.',
    ].join('\n');
    return [{ role: 'system', content: sistema }, { role: 'user', content: usuario }];
  }

  private async preguntarAlModelo(mensajes: { role: string; content: string }[]): Promise<DecisionT> {
    const esquema = z.toJSONSchema(Decision, { target: 'draft-7' });
    const historial = [...mensajes];
    let ultimo = '';
    for (let intento = 0; intento < 2; intento++) {
      const r = await fetch(`${AGENTE_LLM.url}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AGENTE_LLM.llave}` },
        body: JSON.stringify({
          model: AGENTE_LLM.modelo, temperature: 0, max_tokens: 500, messages: historial,
          response_format: { type: 'json_schema', json_schema: { name: 'decision', strict: false, schema: esquema } },
        }),
        signal: AbortSignal.timeout(AGENTE_LLM.tiempoMs),
      });
      if (!r.ok) throw new Error(`El modelo ${AGENTE_LLM.modelo} respondió HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const cuerpo = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      const texto = String(cuerpo.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      let json: unknown;
      try {
        json = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
      } catch {
        json = undefined;
      }
      const v = Decision.safeParse(json);
      if (v.success) return v.data;
      ultimo = v.error.issues.slice(0, 4).map((x) => `${x.path.join('.') || '(raíz)'}: ${x.message}`).join('; ');
      historial.push({ role: 'assistant', content: texto }, { role: 'user', content: `Tu respuesta no cumple el formato: ${ultimo}. Responde solo el JSON corregido.` });
    }
    throw new Error(`El modelo no produjo una decisión válida: ${ultimo}`);
  }

  private traza(ev: EventoFacturacion, resumen: string, ok: boolean, extra: { ms?: number; peticion?: unknown; respuesta?: unknown; error?: string } = {}) {
    registroPanel.agregar({
      direccion: 'saliente', canal: 'agente', resumen: `[${ev.tipo} · ${ev.codigo_orden}] ${resumen}`, ok,
      ms: extra.ms, peticion: redactar(extra.peticion), respuesta: redactar(extra.respuesta), error: extra.error,
    });
  }

  // ------------------------------------------------------------------------------ ejecutar ----

  async ejecutar(ev: EventoFacturacion): Promise<ResultadoAgente> {
    const res: ResultadoAgente = { datos: new Map(), respuestas: [], pedido: null, plan_b: [], pasos: 0 };
    const estado = { hablarHecho: !ev.hablar, tallerHecho: !ev.taller, hablarLlamadas: 0, hablarAbandonado: false, rechazosHablar: 0 };
    let errorRepuestos: Error | null = null;
    let errorTaller: Error | null = null;

    const registrarRespuesta = (r: RespuestaAgenteT) => {
      res.respuestas.push(r);
      for (const d of r.datos) res.datos.set(d.codigo_repuesto, d);
      if (r.pedido) res.pedido = r.pedido;
      this.verificar(ev, r);
    };

    const maxHablar = ev.tipo === 'cotizar' ? 2 : 1; // consultar dos veces es inocuo; comprometer stock, una sola
    const idHablar = (n: number) => (n === 1 ? ev.id_repuestos : `${ev.id_repuestos}-${n}`);

    // ------------------------------------------------------------ bucle del agente ----
    if (AGENTE_LLM.activo && (ev.hablar || ev.taller)) {
      const historial: string[] = [];
      let rechazos = 0;
      try {
        for (let paso = 1; paso <= AGENTE_LLM.maxPasos; paso++) {
          const pendientes = [
            ...(estado.hablarHecho || estado.hablarAbandonado ? [] : ['hablar con repuestos']),
            ...(estado.tallerHecho ? [] : ['avisar al taller']),
          ];
          if (!pendientes.length) break;
          res.pasos = paso;

          const t0 = Date.now();
          const d = await this.preguntarAlModelo(this.prompt(ev, historial, pendientes));
          this.traza(ev, `Decide: ${d.accion}`, true, { ms: Date.now() - t0, peticion: { paso, pendientes, modelo: AGENTE_LLM.modelo }, respuesta: d });

          if (d.accion === 'terminar') {
            historial.push('Dijiste "terminar" pero aún hay pendientes. Hazlos.');
            if (++rechazos >= 2) break;
            continue;
          }

          if (d.accion === 'avisar_taller') {
            if (!ev.taller || estado.tallerHecho) { historial.push('avisar_taller ya está hecho o no aplica a este evento.'); if (++rechazos >= 2) break; continue; }
            try {
              await this.taller.llamar(ev.taller.herramienta, ev.taller.args);
              estado.tallerHecho = true;
              historial.push(`avisar_taller: el taller recibió ${ev.taller.herramienta}.`);
            } catch (e) {
              errorTaller = e as Error;
              estado.tallerHecho = true; // ya se intentó con reintentos; se relanza al final
              historial.push(`avisar_taller falló: ${errorTaller.message.slice(0, 160)}`);
            }
            continue;
          }

          // hablar_con_repuestos
          if (!ev.hablar || estado.hablarHecho) { historial.push('Con repuestos ya hablaste; no repitas.'); if (++rechazos >= 2) break; continue; }
          if (estado.hablarLlamadas >= maxHablar) { historial.push('Ya llegaste al máximo de mensajes a repuestos.'); break; }
          const motivo = this.validarMensaje(ev, d.mensaje);
          if (motivo) {
            this.traza(ev, 'Mensaje rechazado por las barandas', false, { respuesta: { mensaje: d.mensaje, motivo } });
            historial.push(`Tu mensaje fue RECHAZADO por el sistema: ${motivo}`);
            // Tras dos mensajes inválidos ese asunto queda para el plan B, pero el agente sigue con lo demás.
            if (++estado.rechazosHablar >= 2) estado.hablarAbandonado = true;
            continue;
          }
          const n = ++estado.hablarLlamadas;
          try {
            const r = await this.tiendas.hablarConRepuestos(d.mensaje!.trim(), ev.codigo_orden, idHablar(n));
            registrarRespuesta(r);
            estado.hablarHecho = true;
            historial.push(`hablar_con_repuestos → respuesta: "${r.respuesta.replace(/\s+/g, ' ').slice(0, 300)}"${r.pedido ? ` (pedido: ${r.pedido.estado})` : ''}`);
          } catch (e) {
            errorRepuestos = e as Error;
            historial.push(`hablar_con_repuestos falló: ${errorRepuestos.message.slice(0, 160)}`);
            break; // el plan B lo reintenta con el MISMO id_mensaje
          }
        }
      } catch (e) {
        this.logger.warn(`Agente de facturación (${ev.tipo}, ${ev.codigo_orden}) no pudo decidir: ${(e as Error).message}. Sigue el plan B.`);
        this.traza(ev, 'El modelo no pudo decidir', false, { error: (e as Error).message });
      }
    }

    // ----------------------------------------------------------------------- plan B ----
    // Lo que el agente no alcanzó a hacer lo hace el código, con el mismo id_mensaje.
    if (!estado.hablarHecho) {
      res.plan_b.push('hablar_con_repuestos');
      const mensaje = INTENCION[ev.tipo].ejemplo(ev);
      this.traza(ev, 'PLAN B: mensaje de plantilla a repuestos', true, { respuesta: { mensaje } });
      try {
        registrarRespuesta(await this.tiendas.hablarConRepuestos(mensaje, ev.codigo_orden, ev.id_repuestos));
        errorRepuestos = null;
      } catch (e) {
        errorRepuestos = e as Error;
      }
    }
    if (!estado.tallerHecho && ev.taller) {
      res.plan_b.push('avisar_taller');
      this.traza(ev, `PLAN B: aviso al taller (${ev.taller.herramienta})`, true);
      try {
        await this.taller.llamar(ev.taller.herramienta, ev.taller.args);
      } catch (e) {
        errorTaller = e as Error;
      }
    }

    if (errorRepuestos) {
      if (ev.repuestos_critico) throw errorRepuestos;
      this.logger.error(`Repuestos (${ev.tipo}, orden ${ev.codigo_orden}): ${errorRepuestos.message}`);
    }
    if (errorTaller) throw errorTaller; // igual que antes: si el taller no recibe, quien llama debe saberlo
    return res;
  }
}
