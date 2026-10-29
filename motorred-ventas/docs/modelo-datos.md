# Modelo de datos — Ventas y contabilidad (grupo Zaidy)

Trabajo 2, Paso 2. Una base de datos PostgreSQL propia de este servicio; nadie más la lee
directamente, todo pasa por el contrato MCP.

## Tablas

| Tabla | Para qué | Columnas clave |
|---|---|---|
| `ventas` | Una fila por venta del contrato. | `venta_id` (PK, `V-000001`…), `traza_id`, `orden_id`, `estado` (`ESTADOS_VENTA`), `pagador` (jsonb), montos en enteros, `url_pago`, `url_notificacion`, `cobro_id`/`motivo` (internos, no se publican), `liquidada` |
| `lineas_venta` | Las líneas de cada venta. | `venta_id` (FK), `beneficiario`, `concepto`, `referencia`, `cantidad`, `precio_unitario`, `iva_porcentaje`, `reserva_id` |
| `cobros` | Un registro por cada cobro pedido a la pasarela (`generar_cobro` crea uno nuevo tras un rechazo). | `cobro_id` (PK), `venta_id`, `monto`, `estado`, `url_pago` |
| `eventos_pasarela` | Idempotencia del webhook: un `evento_id` se procesa una sola vez. | `evento_id` (PK), `cobro_id`, `tipo`, `monto`, `resultado` |
| `dispersiones` | Cuánto le toca a cada beneficiario de una venta liquidada. | `venta_id` (FK), `beneficiario`, `base`, `iva`, `retencion`, `comision`, `iva_comision`, `neto` |
| `asientos` | Partida doble de cada venta liquidada (PUC ilustrativo). | `venta_id` (FK), `cuenta`, `nombre_cuenta`, `tercero`, `debito`, `credito` |
| `parametros_tributarios` | Tarifas y bases **con vigencia** (nunca en el código). | `concepto`, `tarifa`, `base_uvt`, `valor`, `vigente_desde`, `vigente_hasta` |
| `claves_idempotencia` | Idempotencia de `crear_venta`: misma clave + misma huella = mismo resultado. | `cliente`, `clave` (PK compuesta), `huella`, `venta_id` |
| `reservas_venta_activas` | Qué venta es dueña de cada `reserva_id` mientras sigue viva. | `reserva_id` (PK), `venta_id` |
| `fragmentos_conocimiento` | Base de conocimiento del RAG (Actividad 4.4): política de cobro y de conciliación. | `titulo`, `contenido`, `fuente`, `embedding vector(768)` |
| `decisiones_riesgo` | Bitácora de cada decisión del agente de Riesgo. | `venta_id`, `nivel_riesgo`, `motivos` (jsonb), `fuente` (`modelo`/`plan_b`), `tiempo_ms` |

Ver la migración completa en [`src/db/migraciones/0001_inicial.ts`](../src/db/migraciones/0001_inicial.ts).

### Facturación (migración `0002_cotizaciones`)

Tablas para el flujo del Taller real (cotizar antes de vender). Ver el contrato en
[`src/contrato/facturacion.ts`](../src/contrato/facturacion.ts) y los pendientes en
[`pendientes-contratos.md`](pendientes-contratos.md).

| Tabla | Para qué | Columnas clave |
|---|---|---|
| `cotizaciones` | Una por orden del Taller. | `cotizacion_ref` (PK, `FAC-OT-0054`), `codigo` (único, la orden), `traza_id`, `estado` (`ESTADOS_COTIZACION`), `cliente`/`vehiculo` (jsonb), `subtotal`, `iva`, `total`, `total_cliente`, `total_cubierto_garantia`, `vence_en`, `huella` (idempotencia), `venta_id`, `pago_ref` |
| `lineas_cotizacion` | Mano de obra y repuestos de cada cotización. | `cotizacion_ref` (FK), `tipo` (`mano_obra`/`repuesto`), `referencia` (SKU o código universal), `precio_unitario` (nulo hasta cotizar), `pagador` (`cliente`/`fabricante`/`tienda`/`taller`), `proveedor`, `tienda`, `oferta_ref`, `compra_ref`, `estado` |
| `mensajes_salida` | Bandeja de salida: lo que Facturación entrega al Taller (`registrar_respuesta_cliente`, `registrar_pago`) y los avisos al cliente. | `id_mensaje` (único, el mismo en cada reintento), `destino` (`taller`/`cliente`), `tipo`, `payload` (jsonb), `estado` (`pendiente`/`enviado`/`fallido`), `intentos` |
| `ventas.cotizacion_ref` | Enlaza la venta final con su cotización (nulo en las ventas del contrato 1.0). | — |

Una venta que nace de una cotización reutiliza todo lo anterior (cobro, saga, liquidación, dispersión y
asientos): Facturación crea la venta cuando el Taller informa la reparación terminada, con lo realmente
hecho y usado.


## Por qué `reservas_venta_activas` en vez de un campo en `lineas_venta`

El simulador de referencia (`ventas.mjs`) usa un `Map<reserva_id, venta_id>` en memoria para saber
si una reserva ya pertenece a otra venta, y evitar que dos ventas se queden con la misma reserva
si llegan casi al mismo tiempo. Una tabla aparte con `reserva_id` como llave primaria logra lo
mismo mejor que un `Map`: la restricción `UNIQUE` la aplica PostgreSQL, así que dos `crear_venta`
simultáneas para la misma reserva no pueden ganar las dos, aunque corrieran en procesos distintos.
Ver [ADR 0001](adr/0001-modelo-de-datos.md).

## `pagador` como `jsonb` en vez de una tabla aparte

`pagador` no se normalizó en una tabla `pagadores` porque el contrato lo trata como un objeto
embebido en cada venta (no hay un `pagador_id` en ningún otro lado del contrato), y porque el
agente de Riesgo solo necesita consultarlo por `documento` dentro de la misma venta
(`pagador ->> 'documento'`, con un índice GIN si el volumen lo exige más adelante). Si en el futuro
se necesita un perfil de cliente con más historial que el que cabe en `ventas`, esa sería una
buena razón para extraerlo a su propia tabla.
