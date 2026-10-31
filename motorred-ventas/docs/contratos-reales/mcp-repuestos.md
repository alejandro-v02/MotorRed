# Integración con el agente de repuestos (`hablar_con_repuestos`)

Reemplaza las llamadas a la API REST del concesionario (`/api/repuestos`, `/api/stock/reservas`,
`/salidas`, `/reservas/liberar`), que ese grupo va a cerrar. Todo el ciclo de un pedido pasa por
UNA herramienta MCP: le escribimos en español a su agente y él decide qué consultar o hacer.

Quién decide qué mensaje enviar: el **agente de facturación** (`src/facturacion/agente-facturacion.service.ts`, ver `docs/agentes.md`); la tabla de abajo es el mensaje de referencia que usa como formato y como plan B. Transporte: `src/facturacion/tienda-buscador.service.ts`. Configuración (`.env`):
`MCP_REPUESTOS_URL`, `MCP_REPUESTOS_TOKEN`, `MCP_REPUESTOS_TIMEOUT_MS` (90 s; su agente tarda
10–25 s y ellos piden ≥ 60 s).

## Ciclo de un pedido

| Momento en facturación | Mensaje que enviamos | `id_mensaje` |
|---|---|---|
| El taller llama `crear_cotizacion` | `Cotiza 2 AMO-DEL-GAS y 1 PAS-DEL-CER para la OT-0054` (un solo mensaje con todos) | `fac-<id_mensaje_entrada>-cotizar` |
| El cliente acepta (Telegram) | `El cliente aceptó: aparta 2 AMO-DEL-GAS y 1 PAS-DEL-CER` | `fac-<cotizacion_ref>-aceptar` |
| El taller llama `notificar_reparacion_terminada` | `Terminamos: se usaron 2 AMO-DEL-GAS` (lo apartado de más lo libera su agente) | `fac-<id_mensaje_entrada>-entregar` |
| El cliente paga (PSE confirmado) | `Pagamos los repuestos, referencia PSE-123` | `fac-<referencia_pse>-pagar-repuestos` |
| (disponible, hoy sin disparador) | `Cancela el pedido` | — |

Siempre se envía `codigo_orden`. El `id_mensaje` es determinista: un reintento repite el mismo y
su agente no duplica nada.

## Respuesta (verificada contra el MCP real)

- `datos[]` (al cotizar): por repuesto `codigo_repuesto`, `precio_unitario` **sin IVA**, `tienda`,
  `unidades_disponibles`, `repuesto.sku`, `alternativas[]`. **No trae `repuesto_id`.**
- `pedido` (al apartar, entregar, pagar, cancelar): `estado` (`APARTADO`, `CANCELADO`, …),
  `lineas[]` (`cantidad_apartada`, `cantidad_entregada`), `ventas[]`,
  `total_a_cobrar_con_iva`, `total_a_cobrar_sin_iva`, `referencia_pago`.

Todo se valida con zod antes de usarlo. Cada llamada se ve en el panel (`/panel`, canal Tienda).

## Decisiones y supuestos

- Apartar, entregar y pagar son *best-effort*: si fallan se registran en el log y no bloquean el
  cobro al cliente (igual que antes con las reservas REST).
- Al entregar se compara `total_a_cobrar_con_iva` del pedido con nuestro cálculo de lo usado
  (precio sin IVA × 1,19); si difiere en más de $5 se deja un aviso en el log.
- La tienda nos vende TODO lo usado, también lo cubierto por garantía.
- Pendiente de confirmar con ese grupo: el formato exacto de `pedido` en los estados de entrega y
  pago (solo se verificó `APARTADO` y `CANCELADO`), y nuestro NIT para la venta.
