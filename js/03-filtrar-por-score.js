// Minimum Score: descartamos los fragmentos que se parecen poco a la pregunta.
// Lo que sale de acá es exactamente lo que "lee" el agente.
const { min_score, consulta } = $('Perillas de búsqueda').first().json;

const fragmentos = $input.all()
  .map(i => ({
    texto: i.json.document?.pageContent ?? '',
    source: i.json.document?.metadata?.source ?? 'desconocido',
    seccion: i.json.document?.metadata?.seccion ?? 's/sección',
    pagina: i.json.document?.metadata?.pagina,
    score: Number(i.json.score ?? 0),
  }))
  .filter(f => f.texto);

const aprobados = fragmentos.filter(f => f.score >= min_score);

if (!aprobados.length) {
  return [{ json: {
    resultado: `SIN_RESULTADOS: ningún fragmento superó el score mínimo (${min_score}) para "${consulta}".`,
    scores: fragmentos.map(f => f.score.toFixed(3)),
  } }];
}

return [{ json: {
  resultado: aprobados.map((f, n) =>
    `### Fragmento ${n + 1} (score ${f.score.toFixed(3)})\n${f.texto}\n[Fuente: ${f.source} › ${f.seccion}${f.pagina ? `, pág. ${f.pagina}` : ''}]`
  ).join('\n\n'),
  scores: fragmentos.map(f => f.score.toFixed(3)),
} }];
