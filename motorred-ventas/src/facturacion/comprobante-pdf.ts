// Generador mínimo de PDF (una página A4, texto Helvetica) para el comprobante de pago. Evita agregar
// una librería solo para esto. Solo admite caracteres Latin-1 (tildes y ñ sí); lo demás se reemplaza por "?".

export interface DatosComprobante {
  referencia_pse: string;
  codigo: string;
  cliente: string;
  fecha: Date;
  servicios: number; // base sin IVA de lo que se paga al taller
  repuestos: number; // base sin IVA de lo que se paga a la tienda
  subtotal: number;
  iva: number;
  total: number;
  venta_id: string | null;
}

const cop = (v: number) => '$' + v.toLocaleString('es-CO');
const latin1 = (t: string) => t.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const esc = (t: string) => latin1(t).replace(/([\\()])/g, '\\$1');

export function comprobantePdf(d: DatosComprobante): Buffer {
  const fecha = d.fecha.toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });
  const ops: string[] = [];
  const texto = (x: number, y: number, t: string, tam = 11, negrita = false) =>
    ops.push(`BT /${negrita ? 'F2' : 'F1'} ${tam} Tf ${x} ${y} Td (${esc(t)}) Tj ET`);
  const alDerecha = (xFin: number, y: number, t: string, tam = 11, negrita = false) => {
    // Helvetica ~0.5 em de ancho medio: estimación suficiente para alinear cifras.
    const ancho = latin1(t).length * tam * (negrita ? 0.56 : 0.52);
    texto(Math.round(xFin - ancho), y, t, tam, negrita);
  };
  const linea = (y: number) => ops.push(`0.8 G 50 ${y} m 545 ${y} l S`);

  // Encabezado
  ops.push('0.12 0.16 0.35 rg 0 770 595 72 re f'); // barra azul
  ops.push('1 g');
  texto(50, 806, 'MotorRed', 20, true);
  texto(50, 786, 'Comprobante de pago', 12);
  ops.push('0 g');

  texto(50, 735, 'Pago aprobado', 16, true);
  texto(50, 717, fecha, 10);
  alDerecha(545, 735, cop(d.total), 20, true);
  alDerecha(545, 717, 'COP · IVA incluido', 9);
  linea(700);

  const filas: Array<[string, string]> = [
    ['Cliente', d.cliente],
    ['Orden de trabajo', d.codigo],
    ['Referencia PSE', d.referencia_pse],
    ['Medio de pago', 'PSE (pasarela simulada)'],
  ];
  if (d.venta_id) filas.push(['Registro interno', d.venta_id]);
  let y = 678;
  for (const [k, v] of filas) {
    texto(50, y, k, 10);
    texto(190, y, v, 11, true);
    y -= 20;
  }

  y -= 6;
  linea(y + 14);
  texto(50, y - 4, 'Detalle', 12, true);
  y -= 26;
  if (d.servicios > 0) { texto(50, y, 'Servicios del taller (base)', 11); alDerecha(545, y, cop(d.servicios)); y -= 18; }
  if (d.repuestos > 0) { texto(50, y, 'Repuestos (base)', 11); alDerecha(545, y, cop(d.repuestos)); y -= 18; }
  texto(50, y, 'Subtotal', 11); alDerecha(545, y, cop(d.subtotal)); y -= 18;
  texto(50, y, 'IVA 19 %', 11); alDerecha(545, y, cop(d.iva)); y -= 10;
  linea(y);
  y -= 20;
  texto(50, y, 'Total pagado', 13, true); alDerecha(545, y, cop(d.total), 13, true);

  texto(50, 90, 'Documento de prueba generado por la pasarela simulada de MotorRed. No mueve dinero real', 8);
  texto(50, 78, 'ni tiene validez fiscal. Conserva la referencia PSE para cualquier reclamo.', 8);

  const contenido = ops.join('\n');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(contenido, 'latin1')} >>\nstream\n${contenido}\nendstream`,
  ];

  let salida = '%PDF-1.4\n';
  const posiciones: number[] = [];
  objetos.forEach((o, i) => {
    posiciones.push(Buffer.byteLength(salida, 'latin1'));
    salida += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const inicioXref = Buffer.byteLength(salida, 'latin1');
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const p of posiciones) salida += `${String(p).padStart(10, '0')} 00000 n \n`;
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(salida, 'latin1');
}
