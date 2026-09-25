// El PDF puede venir subido (campo "Documento") o como link (campo "URL del PDF").
// Salida siempre igual: json.source = nombre del archivo (para citar) · binary.data = el PDF.

const { json, binary = {} } = $input.first();
const subido = Object.values(binary)[0];
const url = (json['URL del PDF'] ?? '').trim();

const nombreDesdeUrl = u => decodeURIComponent(u.split('?')[0].split('/').pop()) || 'documento.pdf';

const desdeArchivo = archivo => ({ source: archivo.fileName, data: archivo });

const desdeUrl = async u => {
  const pdf = await this.helpers.httpRequest({ url: u, encoding: 'arraybuffer' });
  const source = nombreDesdeUrl(u);
  return { source, data: await this.helpers.prepareBinaryData(Buffer.from(pdf), source, 'application/pdf') };
};

if (!subido && !url) throw new Error('Subí un PDF o pegá la URL de uno.');

const { source, data } = subido ? desdeArchivo(subido) : await desdeUrl(url);
return [{ json: { source }, binary: { data } }];
