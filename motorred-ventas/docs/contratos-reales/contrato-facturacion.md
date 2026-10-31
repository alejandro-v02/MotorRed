# Contrato MCP de Ventas y contabilidad (grupo Zaidy) — guía para los agentes

En el ecosistema nos conocen como **"facturación"** (así nos llama el taller en su propio
contrato). Este documento describe nuestro servidor MCP: cómo conectarse, qué herramientas
publicamos, qué les pedimos de vuelta, y qué necesitamos de tienda y concesionario. Generado del
servicio real en marcha (`motorred-ventas`), no de un borrador.

**Convención:** nombres de herramientas y campos tal cual (minúscula y guion bajo). Montos en
pesos colombianos (COP), enteros. `id_mensaje` identifica cada intención para reintentos seguros
(misma clave = mismo resultado, nunca se duplica).

---

## 1. Cómo conectarse

- **Endpoint:** `POST/GET /mcp-facturacion` (protocolo MCP estándar, igual que el resto del
  ecosistema).
- **Autenticación:** token fijo compartido, `Authorization: Bearer <token>`. No es OAuth
  `client_credentials`: es el mismo patrón `MCP_<DESTINO>_TOKEN` que el taller ya usa para sus
  propias llamadas salientes. El token se acuerda por canal privado entre los dos grupos.
- Las dos herramientas que publicamos son **asíncronas tipo webhook**: devolvemos un acuse de
  recibo inmediato (`{ "recibido": true }`) y la respuesta real llega después, con una llamada
  nuestra de vuelta al MCP de quien nos llamó.

---

## 2. Lo que publicamos (nos llaman a nosotros)

### `crear_cotizacion`

Para cuando ya se sabe qué hay que hacerle al vehículo y cuánto cubre la garantía, y hace falta
cotizar repuestos y mano de obra.

**Entrada:**

```
codigo            texto   — código de la orden (ej. "OT-0054")
id_relacion       texto   — relación cliente–vehículo
taller            texto
sede              texto
cliente           { cedula, nombre, telefono }
vehiculo          { vin (17 car.), placa, descripcion }
mano_obra[]       { tarea_id, sku, descripcion, precio, causa (o null),
                     garantia: { aplica, valida, pagador, motivo } }
repuestos[]       { tarea_id, codigo_repuesto, descripcion, cantidad,
                     garantia: { aplica, valida, pagador, motivo } }   // SIN precio: lo ponemos nosotros
id_mensaje        texto   — para reintentos seguros
```

**Lo que hacemos:** buscamos el precio de cada `codigo_repuesto` con los proveedores, calculamos
cuánto le toca pagar al cliente (lo cubierto por garantía no se cuenta), le avisamos al cliente, y
cuando responde, llamamos de vuelta:

### `notificar_reparacion_terminada`

Para cuando ya se hizo el trabajo y toca cobrar.

**Entrada:**

```
codigo                      texto
id_relacion                 texto
cotizacion_ref              texto   — la referencia que les dimos en registrar_respuesta_cliente
mano_obra_realizada[]       { tarea_id, sku, descripcion, precio, pagador }
servicios_no_realizados[]   { tarea_id, sku, descripcion }
partes_usadas[]             { codigo_repuesto, descripcion, cantidad, compra_id, tienda }
total_mano_obra             número
id_mensaje                  texto
```

**Lo que hacemos:** calculamos el total a cobrar (solo lo que paga el cliente, según `pagador` de
cada línea), generamos el cobro y, cuando se confirma el pago, llamamos de vuelta:

---

## 3. Lo que llamamos nosotros (ustedes lo reciben)

### `registrar_respuesta_cliente`

```json
{
  "codigo": "OT-0054",
  "aceptada": true,
  "motivo": "solo si aceptada es false",
  "referencia": "FAC-OT-0054-mvwfujjl",
  "orden_compra": [
    { "codigo_repuesto": "AMO-DEL-GAS", "cantidad": 2, "tienda": "AutoPartes La 68", "precio_unitario": 144150, "pagador": "cliente" }
  ],
  "id_mensaje": "fac-FAC-OT-0054-mvwfujjl-respuesta"
}
```

### `registrar_pago`

```json
{
  "codigo": "OT-0054",
  "referencia_pse": "PSE-1793306026830f5e2",
  "valor": 592977,
  "id_mensaje": "fac-PSE-1793306026830f5e2-pago"
}
```

---

## 4. Errores

Igual que el resto del ecosistema: `isError: true` con el mensaje en `content[0].text`. No
reintentamos una llamada que ya falló por datos inválidos; sí reintentamos (hasta 3 veces, con
espera creciente) si no hay respuesta o el servidor no está disponible.

---

## 5. Lo que necesitamos de ustedes (tienda y concesionario)

Esta es la pieza que de verdad nos falta. Hoy, cuando cotizamos un repuesto, el precio sale de un
**catálogo de práctica inventado por nosotros**, no de ustedes. Necesitamos algo como:

**Propuesta** — una herramienta de solo lectura, por ejemplo `consultar_precio_repuesto`:

```
Entrada:  { codigo_repuesto: texto, cantidad: entero }
Salida:   { tienda: texto, precio_unitario: entero, disponible: booleano }
```

No tiene que ser exactamente así — si ya tienen algo parecido (aunque se llame distinto o venga
con más campos), mándennos su propio documento como este y lo adaptamos de nuestro lado. Lo único
que de verdad necesitamos es: dado un `codigo_repuesto` (el código universal que usa el taller,
ej. `PAS-DEL-CER`), poder saber el precio antes de armar la cotización.

---

## 6. Qué es real y qué es simulado hoy de nuestro lado

| Pieza | Estado |
|---|---|
| Cálculo de cotización, IVA, retención, comisión, dispersión, asientos contables | **Real**, probado |
| Llamadas de vuelta (`registrar_respuesta_cliente`, `registrar_pago`) | **Real**, probado contra un taller de prueba |
| Precio de repuestos (tienda/concesionario) | Simulado — bloqueado por este documento |
| Pago (PSE) | Simulado, con una ruta de laboratorio para confirmar a mano |
| Aviso al cliente (Telegram) | Simulado por defecto; ya tenemos armada la automatización real con n8n, falta solo configurar el bot |

---

## 7. Ejemplo completo (los mismos datos que usamos para probar)

Orden `OT-0054`, Marta Gil, Renault Duster, revisión general + cambio de amortiguadores (sin
garantía vigente): cotización de $498.300 (mano de obra $210.000 + repuestos $288.300), pago final
de $592.977 con IVA. Liquidación interna verificada cuadrando centavo a centavo (débitos =
créditos).
