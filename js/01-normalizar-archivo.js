// El PDF puede venir subido (campo "Documento") o como link (campo "URL del PDF").
// Sea cual sea, lo dejamos en el binario "data" y guardamos el nombre para citarlo.
const item = $input.first();
const key = Object.keys(item.binary || {})[0];

if (key) {
  const archivo = item.binary[key];
  return [{ json: { source: archivo.fileName }, binary: { data: archivo } }];
}

const url = (item.json['URL del PDF'] || '').trim();
if (!url) throw new Error('Subí un PDF o pegá la URL de uno.');

const pdf = await this.helpers.httpRequest({ url, encoding: 'arraybuffer' });
const nombre = decodeURIComponent(url.split('?')[0].split('/').pop()) || 'documento.pdf';
return [{
  json: { source: nombre },
  binary: { data: await this.helpers.prepareBinaryData(Buffer.from(pdf), nombre, 'application/pdf') },
}];
