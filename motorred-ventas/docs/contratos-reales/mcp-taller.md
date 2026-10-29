# Contrato real del taller (grupo Falla) — lo que nos toca a nosotros ("facturación")

Resumen de `MCP-Taller.pdf` (generado del servidor en marcha el 2026-10-29), **solo la parte que
nos afecta**: el taller construyó su propio servidor MCP (33 herramientas, 12 estados), distinto
del contrato de referencia del kit. En sus llamadas salientes, a nuestro grupo (Ventas y
contabilidad) lo llaman **`facturacion`**. El documento completo queda en el chat/PR que lo trajo;
aquí solo lo que necesitamos para implementar.

## Las dos herramientas que el taller nos llama (nosotros las publicamos en nuestro MCP)

### `crear_cotizacion`

Se llama cuando el concesionario ya validó la garantía (orden en `en_cotizacion`). Es asíncrona
tipo webhook: el taller la encola (reintenta hasta 5 veces si falla) y espera solo un acuse de
recibo; la respuesta real llega después, por una llamada nuestra de vuelta.

Entrada (ver el PDF para los tipos completos):
```
codigo, id_relacion, taller, sede,
cliente: { cedula, nombre, telefono },
vehiculo: { vin, placa, descripcion },
mano_obra: [{ tarea_id, sku, descripcion, precio, causa,
              garantia: { aplica, valida, pagador, motivo } }],
repuestos: [{ tarea_id, codigo_repuesto, descripcion, cantidad,
              garantia: { aplica, valida, pagador, motivo } }],   // SIN precio: lo ponemos nosotros
```

Lo que debemos hacer: buscar precio de cada `codigo_repuesto` en las tiendas, armar la cotización
(`total_mano_obra`, `total_mano_obra_cliente` = mano_obra menos las líneas con garantía válida,
`hay_repuestos`, `mensaje_garantia` para el cliente), avisarle al cliente (por Telegram, según el
documento) y, cuando responda, llamar de vuelta **`registrar_respuesta_cliente`** en el MCP del
taller:
```
{ codigo, aceptada, motivo?, referencia, orden_compra: [{ codigo_repuesto, cantidad, tienda, precio_unitario, pagador? }], id_mensaje }
```

### `notificar_reparacion_terminada`

Se llama al terminar la reparación (orden en `pendiente_facturacion`). Igual de asíncrona.

Entrada:
```
codigo, id_relacion, cotizacion_ref,
mano_obra_realizada: [...], servicios_no_realizados: [...], partes_usadas: [...],
total_mano_obra,
```

Lo que debemos hacer: enviarle el PSE al cliente y, al confirmarse el pago, llamar de vuelta
**`registrar_pago`** en el MCP del taller:
```
{ codigo, referencia_pse, valor, id_mensaje }
```

## Lo que NO cambia de nuestro lado

El cálculo de IVA/retención/comisión/dispersión/asientos contables sigue siendo nuestro, interno,
y no le interesa al taller — por eso seguimos usando `DineroService`, `ventas`, `dispersiones` y
`asientos` tal cual los construimos. Lo nuevo es la "cara" que habla con el taller real.

## Lo que todavía no sabemos (bloqueante para una integración real, no para avanzar la lógica)

1. **Contrato real de tienda (José) y concesionario (Emerson)**: no tenemos un documento como
   este para pedirles precio por `codigo_repuesto`. Mientras tanto, `TiendaBuscadorService` usa un
   catálogo simulado (`src/facturacion/tienda-buscador.service.ts`), reemplazable cuando llegue el
   contrato real.
2. **PSE**: no hay pasarela real ni simulada definida para este flujo (el PSE no es la pasarela
   simulada del kit). Se simula en `src/facturacion/pse-simulado.service.ts`, con una ruta de
   laboratorio para confirmar el pago a mano, igual que hace el kit con su pasarela.
3. **Telegram**: no hay bot configurado. `src/facturacion/telegram-simulado.service.ts` solo deja
   un registro de lo que se "enviaría" y expone una ruta de laboratorio para simular la respuesta
   del cliente (aceptar/rechazar).
4. **Autenticación taller↔facturación**: el documento menciona `POST /api/auth/entrar` y
   `/api/auth/token-mcp` para los USUARIOS del taller (mecánico, agente, administrador), y
   `MCP_<DESTINO>_URL` / `MCP_<DESTINO>_TOKEN` para las llamadas entre servicios. Asumimos un
   token fijo compartido (`MCP_FACTURACION_TOKEN` para lo que recibimos, `MCP_TALLER_TOKEN` para
   lo que llamamos) hasta que el grupo de Falla confirme el mecanismo exacto.
