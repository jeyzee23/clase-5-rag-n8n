// Chunking por estructura, genérico: sirve para cualquier PDF que LlamaParse pase a markdown.
// Corta donde empieza una sección (títulos) y guarda la "ruta" de títulos + la página como metadata.
// Si el documento no tiene títulos, corta por párrafos. Nunca parte un párrafo si no hace falta.
const MAX = 1800;      // tope de caracteres por chunk
const OVERLAP = 1;     // párrafos que se repiten al partir una sección larga
const MIN = 40;        // secciones más cortas que esto no valen un chunk (ej. un título solo)

const j = $input.first().json;
// LlamaParse v2 devuelve el markdown completo en markdown_full (páginas separadas por "---")
const markdown = j.markdown_full ?? j.markdown ?? j.job?.markdown_full ?? j.result?.markdown_full;
const source = j.source ?? $('Normalizar archivo').first().json.source;
if (!markdown) throw new Error('No llegó markdown de LlamaParse. Mirá la salida del nodo anterior.');

const limpiar = s => s.replace(/<\/?u>/g, '').replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();

// 1. Ruido. Lo detectamos sin saber de qué trata el documento:
//    - encabezados y pies de página = renglones cortos que se repiten en muchas páginas
//      (los números se ignoran: "Informe anual 3" y "Informe anual 4" cuentan como el mismo)
//    - renglones del índice ("Capítulo 2 ........ 14"), separadores y números de página sueltos
const crudas = markdown.split('\n');
const paginas = crudas.filter(l => l.trim() === '---').length + 1;
const clave = t => t.replace(/\d+/g, '#');
const veces = {};
for (const l of crudas) {
  const t = limpiar(l);
  if (t && t.length < 120 && !t.startsWith('|')) veces[clave(t)] = (veces[clave(t)] || 0) + 1;
}
const repetido = t => veces[clave(t)] >= Math.max(3, paginas * 0.3);
const esRuido = t =>
  /^-{3,}$/.test(t) ||                                  // separadores
  /(\.{5,}|…{2,}|_{5,})\s*\d*\s*$|(\.{3,}|…)\s*\d+\s*$/.test(t) || // renglones del índice
  /^(p[áa]g(ina)?\.?\s*)?\d+(\s*(de|\/)\s*\d+)?$/i.test(t) || // "12", "Página 3 de 20"
  /^[A-ZÁÉÍÓÚÑ]{2,4}([\s·|–-]+[A-ZÁÉÍÓÚÑ]{2,4}){0,2}$/.test(t) || // logos o siglas sueltas ("AFA", "AFA LPF", "OMS")
  (!t.startsWith('|') && t.length < 120 && repetido(t)); // encabezado / pie de página

// 2. ¿Este renglón es un título? ¿De qué nivel?
//    Palabras clave comunes (las de un reglamento, un contrato o un manual) mandan sobre el nivel de "#",
//    porque el parseo no es prolijo: el mismo "Artículo" puede venir como #, ## o solo en negrita.
const CLAVES = [
  [1, /^(libro|parte|t[íi]tulo|anexo|ap[ée]ndice|part|title|annex|appendix)\b/i],
  [2, /^(cap[íi]tulo|secci[óo]n|unidad|m[óo]dulo|chapter|section|unit)\b/i],
  [3, /^(art[íi]culo|art\.|cl[áa]usula|regla|article|clause|rule)\s*\d+/i],
];
function nivelDeTitulo(linea) {
  const t = linea.trim();
  const md = t.match(/^(#{1,6})\s+\S/);
  const negrita = /^\*\*[^*]{2,150}\*\*:?$/.test(t);
  if (!md && !negrita) return 0;                        // texto común
  const texto = limpiar(t);
  for (const [nivel, re] of CLAVES) if (re.test(texto)) return nivel;
  const num = texto.match(/^(\d+(?:\.\d+)*)[.)]?\s+\D/); // "2.3 Alcance" → nivel 2
  if (num) return Math.min(num[1].split('.').length, 6);
  return md ? md[1].length : 3;                          // "##" → 2 · negrita suelta → subtítulo
}

// 3. Recorrer el documento armando secciones (ruta de títulos) con sus párrafos (y la página de cada uno)
const ruta = [];                 // ruta[nivel] = título vigente en ese nivel
const secciones = [];
let pagina = 1;
let actual = { seccion: 'Inicio', parrafos: [], abierto: null };   // lo que está antes del primer título
secciones.push(actual);

for (const l of crudas) {
  if (l.trim() === '---') { pagina++; continue; }
  const t = limpiar(l);
  if (!t) { actual.abierto = null; continue; }          // renglón vacío = fin de párrafo
  if (esRuido(t)) continue;
  const nivel = nivelDeTitulo(l);
  if (nivel) {
    ruta[nivel] = t.replace(/[.:]$/, '');
    ruta.length = nivel + 1;                            // un título nuevo borra los de abajo
    actual = { seccion: ruta.filter(Boolean).join(' › '), parrafos: [], abierto: null };
    secciones.push(actual);
  } else {
    const renglon = l.replace(/\*\*/g, '').replace(/<\/?u>/g, '').trimEnd();
    if (actual.abierto) actual.abierto.t += '\n' + renglon;
    else actual.parrafos.push(actual.abierto = { t: renglon.trimStart(), p: pagina });
  }
}

// 4. Partir cada sección en chunks de hasta MAX caracteres, por párrafos
const partirGrande = p => {
  if (p.length <= MAX) return [p];
  if (p.trimStart().startsWith('|')) {                  // tabla: por filas, repitiendo el encabezado
    const filas = p.split('\n'), cab = filas.slice(0, 2), out = [];
    let buf = [...cab];
    for (const f of filas.slice(2)) {
      if (buf.join('\n').length + f.length > MAX && buf.length > 2) { out.push(buf.join('\n')); buf = [...cab]; }
      buf.push(f);
    }
    out.push(buf.join('\n'));
    return out;
  }
  const renglones = p.split('\n');                      // lista larga: por renglón
  if (renglones.length > 1) return renglones.flatMap(partirGrande);
  return p.split(/(?<=[.!?;])\s+/)                      // párrafo enorme: por oración
    .flatMap(o => o.length > MAX ? o.match(new RegExp(`.{1,${MAX}}`, 'gs')) : [o]);
};

const INDICE = /(^|› )(índice|indice|contenidos?|tabla de contenidos?|sumario|contents|table of contents)$/i;
const chunks = [];
for (const s of secciones) {
  if (INDICE.test(s.seccion)) continue;                 // el índice del PDF no responde nada
  const parrafos = s.parrafos.flatMap(({ t, p }) => partirGrande(t.trim()).map(t => ({ t, p })));
  if (parrafos.map(x => x.t).join('').length < MIN) continue;
  let buffer = [];
  const largo = () => buffer.map(x => x.t).join('\n\n').length;
  const flush = () => {
    if (buffer.length) chunks.push({ seccion: s.seccion, pagina: buffer[0].p, texto: buffer.map(x => x.t).join('\n\n') });
  };
  for (const x of parrafos) {
    if (buffer.length && largo() + x.t.length > MAX) {
      flush();
      buffer = buffer.slice(-OVERLAP).filter(b => b.t.length + x.t.length <= MAX);
    }
    buffer.push(x);
  }
  flush();
}

if (!chunks.length) throw new Error('El documento no tiene texto útil (¿es un PDF escaneado sin texto?).');

return chunks.map((c, i) => ({
  json: {
    // La ruta va dentro del texto: el embedding "sabe" de qué sección es
    text: `${c.seccion}\n\n${c.texto}`,
    source,
    seccion: c.seccion,
    pagina: c.pagina,
    chunk: i + 1,
    chars: c.texto.length,
  },
}));
