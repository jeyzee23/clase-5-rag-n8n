// Chunking por estructura: sirve para cualquier PDF que LlamaParse pase a markdown.
// Arriba están las REGLAS (qué es ruido, qué es un título). Abajo, el pipeline que las aplica.

const CONFIG = {
  MAX: 1800,     // tope de caracteres por chunk
  OVERLAP: 1,    // párrafos que se repiten al partir una sección larga
  MIN: 40,       // secciones más cortas que esto no valen un chunk (ej. un título solo)
};

// ── Reglas de ruido: renglones que se descartan ──────────────────────────────
const RUIDO = [
  { que: 'separador',            es: t => /^-{3,}$/.test(t) },
  { que: 'renglón del índice',   es: t => /(\.{5,}|…{2,}|_{5,})\s*\d*\s*$|(\.{3,}|…)\s*\d+\s*$/.test(t) },
  { que: 'número de página',     es: t => /^(p[áa]g(ina)?\.?\s*)?\d+(\s*(de|\/)\s*\d+)?$/i.test(t) },
  { que: 'logo o sigla suelta',  es: t => /^[A-ZÁÉÍÓÚÑ]{2,4}([\s·|–-]+[A-ZÁÉÍÓÚÑ]{2,4}){0,2}$/.test(t) },
  { que: 'encabezado o pie',     es: (t, repetido) => !t.startsWith('|') && t.length < 120 && repetido(t) },
];

// ── Reglas de títulos: la palabra clave manda sobre la cantidad de "#" ───────
const NIVELES = [
  { nivel: 1, re: /^(libro|parte|t[íi]tulo|anexo|ap[ée]ndice|part|title|annex|appendix)\b/i },
  { nivel: 2, re: /^(cap[íi]tulo|secci[óo]n|unidad|m[óo]dulo|chapter|section|unit)\b/i },
  { nivel: 3, re: /^(art[íi]culo|art\.|cl[áa]usula|regla|article|clause|rule)\s*\d+/i },
];

// Secciones que no responden nada (el índice del PDF)
const SIN_VALOR = /(^|› )(índice|indice|contenidos?|tabla de contenidos?|sumario|contents|table of contents)$/i;

// ── Funciones ────────────────────────────────────────────────────────────────
const limpiar = s => s.replace(/<\/?u>/g, '').replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
const esSaltoDePagina = l => l.trim() === '---';

// Un renglón corto que aparece en muchas páginas es encabezado o pie ("Informe 3", "Informe 4" = el mismo).
function detectorDeRepetidos(lineas) {
  const clave = t => t.replace(/\d+/g, '#');
  const paginas = lineas.filter(esSaltoDePagina).length + 1;
  const veces = lineas.map(limpiar)
    .filter(t => t && t.length < 120 && !t.startsWith('|'))
    .reduce((acc, t) => { acc[clave(t)] = (acc[clave(t)] || 0) + 1; return acc; }, {});
  return t => veces[clave(t)] >= Math.max(3, paginas * 0.3);
}

// 0 = texto común. 1..6 = título de ese nivel.
function nivelDeTitulo(linea) {
  const t = linea.trim();
  const numeral = t.match(/^(#{1,6})\s+\S/);
  const negrita = /^\*\*[^*]{2,150}\*\*:?$/.test(t);
  if (!numeral && !negrita) return 0;
  const texto = limpiar(t);
  const porClave = NIVELES.find(n => n.re.test(texto));
  if (porClave) return porClave.nivel;
  const numerado = texto.match(/^(\d+(?:\.\d+)*)[.)]?\s+\D/);   // "2.3 Alcance" → nivel 2
  if (numerado) return Math.min(numerado[1].split('.').length, 6);
  return numeral ? numeral[1].length : 3;                         // "##" → 2 · negrita suelta → 3
}

// Recorre el documento y arma [{ seccion: 'TÍTULO I › Artículo 2', parrafos: [{ t, p }] }]
function agruparEnSecciones(lineas, esRuido) {
  const ruta = [];
  const secciones = [{ seccion: 'Inicio', parrafos: [] }];
  let pagina = 1, abierto = null;
  for (const linea of lineas) {
    if (esSaltoDePagina(linea)) { pagina++; continue; }
    const t = limpiar(linea);
    if (!t) { abierto = null; continue; }                          // renglón vacío = fin de párrafo
    if (esRuido(t)) continue;
    const nivel = nivelDeTitulo(linea);
    if (nivel) {
      ruta[nivel] = t.replace(/[.:]$/, '');
      ruta.length = nivel + 1;                                      // un título nuevo borra los de abajo
      secciones.push({ seccion: ruta.filter(Boolean).join(' › '), parrafos: [] });
      abierto = null;
    } else {
      const renglon = linea.replace(/\*\*/g, '').replace(/<\/?u>/g, '').trimEnd();
      if (abierto) abierto.t += '\n' + renglon;
      else secciones.at(-1).parrafos.push(abierto = { t: renglon.trimStart(), p: pagina });
    }
  }
  return secciones;
}

// Un párrafo más largo que MAX se parte: tablas por filas (repitiendo encabezado), listas por renglón, texto por oración.
function partirGrande(p) {
  if (p.length <= CONFIG.MAX) return [p];
  if (p.trimStart().startsWith('|')) {
    const todas = p.split('\n'), cab = todas.slice(0, 2);
    return todas.slice(2).reduce((grupos, fila) => {
      const actual = grupos.at(-1);
      if (actual.join('\n').length + fila.length > CONFIG.MAX && actual.length > 2) grupos.push([...cab, fila]);
      else actual.push(fila);
      return grupos;
    }, [[...cab]]).map(g => g.join('\n'));
  }
  const renglones = p.split('\n');
  if (renglones.length > 1) return renglones.flatMap(partirGrande);
  return p.split(/(?<=[.!?;])\s+/)
    .flatMap(o => o.length > CONFIG.MAX ? o.match(new RegExp(`.{1,${CONFIG.MAX}}`, 'gs')) : [o]);
}

// Junta párrafos hasta MAX; al cortar, repite los últimos OVERLAP párrafos en el chunk siguiente.
function empaquetar({ seccion, parrafos }) {
  const piezas = parrafos.flatMap(({ t, p }) => partirGrande(t.trim()).map(t => ({ t, p })));
  if (piezas.map(x => x.t).join('').length < CONFIG.MIN) return [];
  const largo = grupo => grupo.map(x => x.t).join('\n\n').length;
  const grupos = piezas.reduce((gs, x) => {
    const actual = gs.at(-1);
    if (actual.length && largo(actual) + x.t.length > CONFIG.MAX) {
      gs.push([...actual.slice(-CONFIG.OVERLAP).filter(b => b.t.length + x.t.length <= CONFIG.MAX), x]);
    } else actual.push(x);
    return gs;
  }, [[]]);
  return grupos.filter(g => g.length)
    .map(g => ({ seccion, pagina: g[0].p, texto: g.map(x => x.t).join('\n\n') }));
}

// ── Pipeline ─────────────────────────────────────────────────────────────────
const j = $input.first().json;
const markdown = j.markdown_full ?? j.markdown ?? j.job?.markdown_full ?? j.result?.markdown_full;
if (!markdown) throw new Error('No llegó markdown de LlamaParse. Mirá la salida del nodo anterior.');
const source = j.source ?? $('Normalizar archivo').first().json.source;

const lineas = markdown.split('\n');
const repetido = detectorDeRepetidos(lineas);
const esRuido = t => RUIDO.some(regla => regla.es(t, repetido));

const chunks = agruparEnSecciones(lineas, esRuido)
  .filter(s => !SIN_VALOR.test(s.seccion))
  .flatMap(empaquetar);

if (!chunks.length) throw new Error('El documento no tiene texto útil (¿es un PDF escaneado sin texto?).');

return chunks.map((c, i) => ({
  json: {
    text: `${c.seccion}\n\n${c.texto}`,   // la ruta va dentro del texto: el embedding "sabe" de qué sección es
    source,
    seccion: c.seccion,
    pagina: c.pagina,
    chunk: i + 1,
    chars: c.texto.length,
  },
}));
