# ADR 0003 — Integración con el taller real (contrato propio, no el del kit)

**Estado:** aceptado · **Fecha:** 2026-10-29

## Contexto

El grupo de Falla (taller) no construyó su servicio sobre el contrato de referencia del kit
(`contrato/esquemas.mjs`): hicieron su propio servidor MCP con 33 herramientas y 12 estados
(`docs/contratos-reales/mcp-taller.md`). En su diseño, lo que ellos llaman **`facturacion`** somos
nosotros, y las responsabilidades cambiaron: ahora nos toca a nosotros buscar precio de repuestos
en las tiendas (antes lo hacía el taller) y hablarle directamente al cliente (Telegram) y cobrar
por PSE (antes era la pasarela simulada del kit, orquestada por nosotros pero iniciada por el
taller vía `crear_venta`).

## Decisión

1. **El contrato real del taller manda para la integración**, no el del kit. Construimos una
   capa nueva (`src/facturacion/`) que publica `crear_cotizacion` y `notificar_reparacion_terminada`
   como herramientas MCP, con autenticación por token fijo (no el OAuth client_credentials del
   kit), porque así es como el taller real ya está construido y no tiene sentido pedirles que
   rehagan su servicio para que coincida con el simulador.
2. **La lógica de dinero no se reescribe**: `DineroService`, el modelo de `ventas`/`dispersiones`/
   `asientos` y la saga de liquidación siguen siendo la contabilidad interna. Cuando el cliente
   acepta una cotización, creamos una `VentaEntity` internamente (con el cliente como único
   pagador, ya que este contrato no modela un segundo pagador por garantía como sí lo hacía el
   kit) y reutilizamos `DineroService.liquidar()` para la dispersión. El taller nunca ve esa
   estructura: solo recibe `registrar_respuesta_cliente` y `registrar_pago`.
3. **Las tres piezas que no tenemos especificadas se simulan, de forma intercambiable**:
   - `TiendaBuscadorService`: catálogo en memoria por `codigo_repuesto`, con una interfaz que se
     puede reemplazar por una llamada MCP real a tienda/concesionario en cuanto exista su contrato.
   - `PseSimuladoService`: genera una referencia y expone una ruta de laboratorio
     (`POST /facturacion/sandbox/pse/:referencia/confirmar`) para simular la confirmación del
     cliente, igual que el kit simula su pasarela.
   - `TelegramSimuladoService`: registra el mensaje que se "enviaría" y expone una ruta de
     laboratorio (`POST /facturacion/sandbox/telegram/:cotizacion_ref/responder`) para simular
     que el cliente aceptó o rechazó.
4. **El contrato del kit (`crear_venta`, `generar_cobro`, etc.) se mantiene en el código** porque
   ya está probado (58/58, 79/79) y no estorba, pero deja de ser la ruta de integración principal
   con el taller real. Si el kit se vuelve a necesitar (por ejemplo, para la entrega formal del
   Instructivo 5 si se evalúa contra los simuladores), sigue funcionando sin cambios.

## Alternativas consideradas

- **Pedirle al taller que adopte el contrato del kit.** Se descartó por ahora: ellos ya tienen un
  servidor en producción con datos reales (`OT-0053`, etc.) y rehacerlo es más costoso que
  nosotros adaptándonos, que es exactamente el trabajo de un grupo "facturación"/orquestador
  comercial en este proyecto.
- **Borrar el contrato del kit.** Se descartó: no cuesta nada mantenerlo y es la evidencia de
  conformidad-1.0 ya entregada.

## Consecuencias

- Mientras no exista el contrato real de tienda/concesionario, el precio de los repuestos es
  simulado: **cualquier cotización que generemos hoy no tiene precios reales**. Hay que
  reemplazar `TiendaBuscadorService` en cuanto el grupo de José publique su contrato.
- El pago y la notificación al cliente son simulados por la misma razón; no se debe presentar
  esto como "integración completa" en la sustentación sin aclarar qué partes son reales.
- Como el taller no modela un segundo pagador por garantía (fabricante/tienda/taller), nuestra
  liquidación interna para estas cotizaciones solo tiene un pagador (el cliente); la parte de la
  mano de obra con garantía válida simplemente no se cobra ni se dispersa, porque el taller no
  nos manda ningún pago asociado a esas líneas.
