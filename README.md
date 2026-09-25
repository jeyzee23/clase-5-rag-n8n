# Clase 5: Cerebro Documental (RAG con LlamaCloud + Pinecone)

**Coderhouse · AI Automation Avanzado (V2) · Semana 5**

Un PDF entra por un formulario, por archivo o por URL. **LlamaParse** lo pasa a markdown y un Code lo corta por títulos (sirve para **cualquier PDF**, no solo el reglamento). **Cohere** convierte cada pedazo en 1024 números (embeddings) y se guarda en **Pinecone**. Un agente con **Groq** busca ahí antes de responder, **cita archivo, sección y página**, y si no encuentra el dato dice **"No sé"**.

**Stack del programa:** el `program-summary.pdf` pide **LlamaCloud** para el parseo y usa **Pinecone** como base vectorial. El LLM lo nombra como OpenAI o Claude, sin exigir uno. **Groq y Cohere no aparecen** en el programa, pero tampoco se prohíben: son la opción gratis.

---

## 🎬 Replay de la clase (1:20)

La ingesta en Pinecone no salió en vivo. Acá está el replay: la grabación real, acelerada donde había esperas, con una **barra arriba que marca en qué nodo está el workflow** en cada momento.

[![Replay clase 5: ingesta de un PDF en Pinecone](workflow/replay-poster.jpg)](workflow/replay-clase-5-ingesta-pinecone.mp4)

> ▶️ Clic en la imagen para abrir el video ([`workflow/replay-clase-5-ingesta-pinecone.mp4`](workflow/replay-clase-5-ingesta-pinecone.mp4)).

<!-- REPLAY-VIDEO: para que se vea el reproductor adentro del README, editá este archivo en GitHub, arrastrá el .mp4 en esta línea y dejá el link https://github.com/user-attachments/assets/... que genera, solo en su renglón. -->

| Minuto | Qué se ve |
|---|---|
| 0:00 | Qué falló en la clase |
| 0:09 | **Parte 1 · Pinecone:** índices existentes (ojo con los que usan modelo integrado) |
| 0:13 | Create index: nombre y **Custom settings** |
| 0:19 | Dense · **1024** · cosine |
| 0:23 | Serverless · AWS · us-east-1 → Create → índice listo con 0 records |
| 0:32 | **Parte 2 · n8n:** "Guardar en Pinecone" → elegir el índice nuevo |
| 0:41 | El **formulario es el nodo "Subir PDF"** (Form Trigger): subir el PDF y elegir *Reemplazar* |
| 0:48 | Normalizar archivo → LlamaParse: subir PDF → Esperar 10 s |
| 0:53 | ¿terminó? → ¿Estado del parseo? → Chunking (42 pedazos), en cámara lenta |
| 0:57 | Guardar en Pinecone + Embeddings → *Workflow executed successfully* |
| 1:01 | Metadata de cada pedazo (source, seccion, pagina) |
| 1:05 | Embeddings: 1024 números por pedazo |
| 1:12 | Cómo verificarlo en Pinecone + checklist |


---

## Importar

1. n8n → *Import from File* → [`workflow/clase-5-rag.json`](workflow/clase-5-rag.json) (o [`clase-5-rag-memoria.json`](workflow/clase-5-rag-memoria.json) si no querés usar Pinecone).
2. Conectá **tus** credenciales: LlamaCloud (*Bearer Auth*, en los **dos** nodos de LlamaParse), Cohere, Pinecone y Groq. No hay keys en este repo.
3. Creá tu índice en Pinecone (**1024 · cosine · Custom settings**, ver sección 1.1) y elegilo en los 3 nodos de Pinecone.
4. *Execute workflow* → formulario → pegá la URL de un PDF → *Open chat* y preguntá.

---

## 0. Qué falló en la clase

| Nodo | Qué pasó | Error |
|---|---|---|
| **LlamaParse: subir PDF** | El campo `file` quedó como **Form Data** (texto) con el valor `data`, en vez de **n8n Binary File**. LlamaCloud recibía la palabra "data" y no el PDF | `The 'file' field must be a file upload, not a string` |
| **LlamaParse: ¿terminó?** (en el workflow armado en vivo) | Authentication quedó en **None**. LlamaCloud no te deja consultar el turno sin la key | Error en el GET |

**Moraleja:** los dos nodos de LlamaParse llevan **la misma credencial Bearer**, y el `file` es **n8n Binary File**. Son los dos casilleros que se escapan. El workflow de este repo ya viene corregido.

**Probado después de la clase** (24/09, en n8n cloud):

| Prueba | Resultado |
|---|---|
| Ingesta del **Reglamento LPF** por URL, modo *Reemplazar* | ✅ 42 pedazos, los 29 artículos, con página |
| Ingesta de **otro PDF distinto** (una especificación de requisitos, SRS) por URL, modo *Agregar* | ✅ 8 pedazos: "1. Descripción…", "2. Requerimientos… › Fase 1…" |
| Ingesta en un **índice nuevo creado a mano** (`coderhouse-index-prueba`, el del video) | ✅ 42 pedazos, *Workflow executed successfully* |
| Loop de LlamaParse | ✅ 3 consultas con el reglamento, 2 con el SRS; 1 sola si el PDF ya estaba en caché |
| Chat: requisitos para el Comité Ejecutivo | ✅ Art. 14, pág. 14 |
| Chat: formato de salida del orquestador de triage (el **otro** PDF) | ✅ "exclusivamente en JSON", SRS › Fase 1, pág. 1 |
| Chat: qué pasa si el auditor no responde | ✅ SRS › Fase 4, pág. 2 |
| Chat: quién ganó el último torneo | ✅ "No sé" |
| Chat: plata de la tele en partes iguales | ✅ Art. 26: 50%, pág. 25 |
| 4 preguntas seguidas (~15 s entre una y otra) | ✅ sin rate limit |
| Laboratorio de scores | ✅ anda (con la pregunta de ejemplo, que es vaga, da 0.55 y el filtro de 0.6 la descarta: sirve para mostrarlo) |

> **Ojo con el índice:** un índice creado con un **modelo integrado de Pinecone** (llama-text-embed-v2, multilingual-e5…) o con otra dimensión no sirve para los vectores de Cohere. Puede aparecer en la lista de n8n y aun así fallar al insertar (*"Index … not found"*). Crealo como en la sección 1.1 o como en el video.

---

## 1. Ingesta en Pinecone, paso a paso

**La idea en criollo:** Pinecone **no lee PDFs y no conoce a Cohere**. Es un depósito de vectores. El trabajo lo hace n8n: LlamaParse saca el texto, el Code lo corta, Cohere convierte cada pedazo en 1024 números, y **recién ahí** n8n se los manda a Pinecone. Por eso el índice tiene que estar preparado para recibir **listas de 1024 números**.

```
PDF ──► LlamaParse ──► Chunking ──► Cohere (1024 números por pedazo) ──► Pinecone guarda
                                                                          (índice de 1024)
```

### 1.1 En la consola de Pinecone (app.pinecone.io): crear el índice

1. **Indexes → Create index**.
2. **Name:** `clase5-rag` (o el que quieras, en minúsculas y con guiones).
3. **Configuration:** Pinecone te ofrece elegir un **modelo de embeddings suyo** (llama-text-embed-v2, multilingual-e5-large…). **No elijas ninguno.** Andá a la opción **manual / custom** ("Bring your own vectors"), porque los vectores los hace Cohere desde n8n. El nombre exacto del botón cambia según la versión de la consola.
4. **Dimension: 1024**, el número de valores que devuelve Cohere `embed-multilingual-v3.0`. Si no coincide, Pinecone rechaza la carga.

   | Modelo de embeddings | Dimensiones |
   |---|---|
   | Cohere `embed-multilingual-v3.0` ← el nuestro | **1024** |
   | Cohere `embed-multilingual-light-v3.0` | 384 |
   | OpenAI `text-embedding-3-small` | 1536 |
   | OpenAI `text-embedding-3-large` | 3072 |
   | Gemini `gemini-embedding-001` | 3072 |

5. **Metric: cosine**. Mide si dos textos "apuntan para el mismo lado". Es la que se usa para texto.
6. **Capacity: Serverless · AWS · us-east-1** (plan gratis) → **Create index**. Esperá a que diga **Ready**.
7. **API Keys → Create API key** → en n8n, *Credentials → Pinecone API* → pegás la key.

> Si un índice aparece en la lista de n8n pero al insertar dice *"not found"*, entrá al índice en la consola y fijate: **1024 · cosine · sin modelo integrado · Ready**. Si algo no coincide, borralo y crealo de nuevo con los pasos de arriba.

### 1.2 En n8n: dónde se configura

Todo está en el nodo **Guardar en Pinecone**:
- **Credential:** Pinecone account.
- **Operation:** Insert Documents.
- **Pinecone Index:** elegís de la lista el índice que creaste (en el video, `coderhouse-index-prueba`).
- **Pinecone Namespace:** `documentos`. Es una **carpeta dentro del índice**: separa esta clase de lo que ya tenías.
- **Clear Namespace:** `{{ $('Subir PDF').first().json['Modo de carga'].startsWith('Reemplazar') }}`. Si en el formulario elegís **Reemplazar**, vacía la carpeta antes de cargar, así queda una sola versión vigente. Si elegís **Agregar**, suma el PDF a lo que ya hay.
- Colgados: **Embeddings (ingesta)** (Cohere) y **Cargar chunk + metadata**.

### 1.3 Correr la ingesta

1. **Execute workflow** (el botón naranja, "from Subir PDF"). Se abre el formulario.
2. Pegá una **URL de un PDF** o subí el archivo. Elegí **Modo de carga**.
3. **Submit** y mirá el canvas: se ve la vuelta del loop de LlamaParse y después la carga.
4. En el nodo **Guardar en Pinecone** tiene que salir **Success** con N items.

### 1.4 Verlo en Pinecone (para mostrar en clase)

1. app.pinecone.io → **Indexes →** tu índice.
2. Pestaña **Browser** (según la versión, puede llamarse *Records* o estar en *Namespaces*) → elegí el namespace **`documentos`**.
3. Vas a ver los **registros**: cada uno tiene un `id`, los **1024 valores** y la **metadata** (`text`, `source`, `seccion`, `pagina`, `chunk`). El contador tiene que dar lo mismo que salió en n8n (con el reglamento: 42).
4. Para mostrar el Clear Namespace: cargá el mismo PDF en modo **Reemplazar**. El contador no sube: se reemplaza.

---

## 2. Preguntas

### ¿Por qué vuelve la flecha? (el loop Esperar ⇄ ¿terminó?)

LlamaParse **no contesta en el momento**. Le mandás el PDF y te da un **número de turno** (`id`), como en la carnicería. Entonces:

1. **Esperar 10 s**.
2. **LlamaParse: ¿terminó?** pregunta por el turno.
3. **¿Estado del parseo?** mira `job.status`:
   - `COMPLETED` → sale por **Listo** y va al chunking.
   - `FAILED` → sale por **Falló** y corta.
   - Cualquier otro (`PENDING`, `RUNNING`) → sale por **Sigue procesando** y **vuelve a Esperar** (esa es la flecha).

Se llama **polling**: "¿ya está? no → espero → ¿ya está? sí → sigo". Hoy preguntó 3 veces con el reglamento y 2 con el SRS.

### ¿Cómo decidimos dónde cortar un chunk?

El agente **no lee el PDF entero**: lee los 3 pedazos más parecidos a la pregunta. Por eso **cada pedazo tiene que entenderse solo**. Si una regla queda partida en dos, el agente ve media regla: es la **referencia huérfana**.

| Estrategia | Cómo corta | Problema | Cuándo |
|---|---|---|---|
| **Tamaño fijo** | Cada N caracteres, con overlap | Parte frases y reglas al medio | Texto corrido (transcripciones, chats) |
| **Por estructura** ← la nuestra | En los **títulos** | Si no hay títulos, no sirve sola | Reglamentos, contratos, manuales, informes |
| **Semántica** | Donde cambia el tema | Más lenta y cara | Documentos largos sin títulos |

**Qué hace el Code "Chunking por títulos"** (genérico, para cualquier PDF):
1. **Saca la basura sin saber de qué trata el documento:**
   - **Encabezados y pies de página**: renglones cortos que se repiten en muchas páginas. Los números se ignoran, así "Informe 3" e "Informe 4" cuentan como el mismo renglón.
   - **Renglones del índice** (`Capítulo 2 ...... 14`) y la sección "Índice" o "Contenido" entera.
   - **Números de página** y **logos o siglas sueltas** ("AFA", "AFA LPF").
2. **Detecta títulos** (renglones con `#` o todo en negrita) y les pone **nivel**:
   - **Palabras clave**, que mandan sobre la cantidad de `#`: Título, Parte o Anexo → nivel 1. Capítulo o Sección → nivel 2. Artículo, Cláusula o Regla → nivel 3. Pasa porque LlamaParse no es prolijo: el mismo "Artículo" viene como `#`, `##` o en negrita.
   - **Numeración**: "2.3 Alcance" es nivel 2.
   - Si no hay ninguna de las dos, cuenta la cantidad de `#`.
3. **Arma la ruta** (`TÍTULO III › Capítulo II › Artículo 14`) y **anota la página**. Las dos cosas van a la metadata para citar. La ruta va también **dentro del texto**, para que el embedding sepa de qué sección es.
4. **Si una sección pasa de 1.800 caracteres, la parte por párrafos** y repite el último párrafo en el pedazo siguiente (overlap = 1). Las tablas se parten por filas y repiten el encabezado.
5. **Si el PDF no tiene títulos**, corta todo por párrafos. Nunca se queda en cero.

**Regla para enseñar:** "cortá como se lo explicarías a otra persona: por tema, sin partir una regla al medio".

### ¿Qué es un embedding?

1. Cohere `embed-multilingual-v3.0` recibe un texto y devuelve **1024 números**: la "huella" del significado.
2. **Textos que dicen lo mismo tienen números parecidos**, aunque usen otras palabras.
3. **Ingesta:** cada pedazo → 1024 números → Pinecone, junto con el texto y la metadata.
4. **Chat:** la pregunta → 1024 números con **el mismo modelo** → Pinecone devuelve los más parecidos (coseno, de 0 a 1). Ese número es el **score**.
5. **Regla de oro:** misma cantidad de dimensiones en el índice y **el mismo modelo** en la ingesta y en la búsqueda.

En n8n, **Embeddings Cohere** es un **sub-nodo**: se cuelga del conector *Embedding* del nodo Pinecone. Hay 3 (ingesta, chat y laboratorio), todos con el mismo modelo.

### Top-K, Min score y Reranker

- **Top-K** (10): cuántos pedazos trae la búsqueda.
- **Reranker** (Cohere `rerank-v3.5`, Top N 3): **relee esos 10 junto con la pregunta** y deja los 3 mejores.
- **Min score**: el nodo nativo no lo tiene, por eso está el **laboratorio**. Una pregunta concreta saca más de ~0.65 y una vaga ("¿qué requisitos pide el documento?") saca ~0.55.

### Rate limit ("The service is receiving too many requests from you")

Groq gratis deja **8.000 tokens por minuto por modelo**, y cada pregunta llama 2 veces al modelo. Lo que hicimos: **memoria de 4 mensajes**, **reranker con Top N 3** y **modelo de respaldo** (`gpt-oss-20b`, con su propio cupo). *Para la clase:* "Top-K y memoria son perillas de **costo**, no solo de calidad".

---

## 3. Grilla del workflow (28 nodos)

| # | Nodo | Tipo | Para qué |
|---|---|---|---|
| **Carril 1: Ingesta** | | | *(una vez por documento)* |
| 1 | Subir PDF | Form Trigger | PDF (archivo **o** URL) + **Modo de carga** (Reemplazar / Agregar) |
| 2 | Normalizar archivo | Code | Deja el PDF en `data`. Si vino URL, lo descarga |
| 3 | LlamaParse: subir PDF | HTTP Request (POST) | Manda el PDF. Devuelve el turno (`id`) |
| 4 | Esperar 10 s | Wait | Pausa del loop |
| 5 | LlamaParse: ¿terminó? | HTTP Request (GET) | Pregunta por el turno y trae `markdown_full` |
| 6 | ¿Estado del parseo? | Switch | Listo → sigue · Falló → corta · Otro → vuelve a 4 |
| 7 | Parseo falló | Stop and Error | Corta con el mensaje de LlamaParse |
| 8 | Chunking por títulos | Code | Limpia y corta por títulos (genérico) + sección + página |
| 9 | Guardar en Pinecone | Pinecone Vector Store (Insert) | Namespace `documentos`. Clear según el modo |
| 10 | Cargar chunk + metadata | Default Data Loader | Colgado de 9. `source`, `seccion`, `pagina`, `chunk` |
| 11 | No volver a cortar | Recursive Character Text Splitter | Colgado de 10. 4000, para no re-cortar |
| 12 | Embeddings (ingesta) | Embeddings Cohere | Colgado de 9. Texto → 1024 números |
| **Carril 2: Chat** | | | |
| 13 | Chat | Chat Trigger | Entra la pregunta |
| 14 | Agente de documentos | AI Agent | Busca, cita (archivo › sección, pág.), "No sé" |
| 15 | Groq | Groq Chat Model | `openai/gpt-oss-120b`. Colgado de 14 |
| 15b | Groq (respaldo) | Groq Chat Model | `openai/gpt-oss-20b`. Conector *Fallback Model* de 14 |
| 16 | Memoria | Simple Memory | 4 mensajes. Colgado de 14 |
| 17 | buscar_documentos | Pinecone Vector Store (Retrieve as Tool) | La herramienta. Top-K 10, namespace `documentos` |
| 18 | Embeddings (chat) | Embeddings Cohere | **Mismo modelo que 12**. Colgado de 17 |
| 19 | Reranker | Reranker Cohere | Deja los 3 mejores. Colgado de 17 |
| **Carril 3: Laboratorio** | | | *(a mano)* |
| 20 | Probar búsqueda | Manual Trigger | Arranca la prueba |
| 21 | Perillas de búsqueda | Edit Fields | `consulta`, `top_k`, `min_score` |
| 22 | Buscar en Pinecone | Pinecone Vector Store (Get Many) | Trae fragmentos **con score** |
| 23 | Embeddings (laboratorio) | Embeddings Cohere | Colgado de 22 |
| 24 | Filtrar por score | Code | Aplica el Min score y muestra los scores |

---

## 4. Armarlo en vivo: rol y configuración de cada nodo

> Antes de empezar: **Credenciales** → LlamaCloud (*Bearer Auth*, key de cloud.llamaindex.ai), Cohere, Pinecone y Groq.

### Carril 1: Ingesta

**1. Subir PDF: Form Trigger.** *Rol:* la puerta de entrada.
- Form Title: `Cerebro Documental — Ingesta`.
- Tres campos:
  - **File** `Documento`, de tipo `.pdf` y no requerido.
  - **Text** `URL del PDF`.
  - **Dropdown** `Modo de carga`, requerido, con las opciones `Reemplazar todo lo cargado` y `Agregar a lo que ya hay`.

**2. Normalizar archivo: Code.** Pegar [`js/01-normalizar-archivo.js`](js/01-normalizar-archivo.js). Sale con `source` (el nombre del PDF) y `binary.data`.

**3. LlamaParse: subir PDF: HTTP Request.** ⚠️ Es el nodo que falló en clase.
- `POST` a `https://api.cloud.llamaindex.ai/api/v2/parse/upload`.
- Authentication: **Generic Credential Type → Bearer Auth → la de LlamaCloud**.
- Send Body ✅, **Form-Data**:
  - `file`: tipo **n8n Binary File** (¡no *Form Data*!), Input Data Field Name `data`.
  - `configuration`: Form Data, `{"tier": "cost_effective", "version": "latest"}`.

**4. Esperar 10 s: Wait.** After Time Interval, 10 seconds.

**5. LlamaParse: ¿terminó?: HTTP Request.** ⚠️ En clase quedó sin autenticación.
- `GET` a `https://api.cloud.llamaindex.ai/api/v2/parse/{{ $('LlamaParse: subir PDF').first().json.id }}`.
- **La misma credencial Bearer**.
- Query parameter `expand` = `markdown_full`.

**6. ¿Estado del parseo?: Switch.**
- `{{ $json.job.status }}` = `COMPLETED` → **Listo**.
- `{{ $json.job.status }}` = `FAILED` → **Falló**.
- Fallback Output **Extra Output** → **Sigue procesando**, **conectada de vuelta a Esperar 10 s**.

**7. Parseo falló: Stop and Error.** Mensaje: `{{ 'LlamaParse no pudo parsear el documento: ' + $json.job.error_message }}`.

**8. Chunking por títulos: Code.** Pegar [`js/02-chunking-por-titulos.js`](js/02-chunking-por-titulos.js). *Mostrar:* cada item trae `text`, `source`, `seccion`, `pagina`, `chunk`.

**9. Guardar en Pinecone.** Insert Documents · Index · Namespace `documentos` · Clear Namespace con la expresión de la sección 1.2.

**10. Cargar chunk + metadata: Default Data Loader** ("+" Document de 9).
- JSON, *Load Specific Data*, Data `{{ $json.text }}`, Text Splitting **Custom**.
- Metadata: `source`, `seccion`, `pagina` y `chunk`, cada uno igual a `{{ $json.<campo> }}`.

**11. No volver a cortar: Recursive Character Text Splitter** ("+" de 10). 4000 / 0.

**12. Embeddings (ingesta): Embeddings Cohere** ("+" Embedding de 9). `embed-multilingual-v3.0`.

### Carril 2: Chat

**13. Chat: Chat Trigger.**

**14. Agente de documentos: AI Agent.** Max Iterations 5 · **Enable Fallback Model ✅**. System Message (está en el JSON) con 7 reglas:
1. **Una pregunta por vez**: responder solo el último mensaje y no volver a responder una pregunta anterior.
2. Buscar siempre con `buscar_documentos`.
3. Solo fuentes.
4. "No sé: eso no figura en los documentos cargados."
5. Citar `[Fuente: archivo › sección, pág. N]`.
6. Saludos sin buscar.
7. Máximo 5 líneas.

**15. Groq** (Chat Model): `openai/gpt-oss-120b`, temperatura 0.1.

**15b. Groq (respaldo)** (Fallback Model): `openai/gpt-oss-20b`, temperatura 0.1.

**16. Memoria: Simple Memory.** Context Window **4**.

**17. buscar_documentos: Pinecone Vector Store** ("+" Tool del agente). Retrieve Documents (As Tool for AI Agent). Description genérica (está en el JSON). Mismo Index · Limit 10 · Include Metadata ✅ · Rerank ✅ · Namespace `documentos`.

**18. Embeddings (chat)** (de 17): el mismo modelo.

**19. Reranker Cohere** (de 17): `rerank-v3.5`, Top N 3.

### Carril 3: Laboratorio

**20–24:**
- Manual Trigger → **Perillas** (`consulta`, `top_k` 4, `min_score` 0.6).
- → **Buscar en Pinecone** (Get Many, Prompt `{{ $json.consulta }}`, Limit `{{ $json.top_k }}`, mismo Index y Namespace) → **Filtrar por score** ([`js/03-filtrar-por-score.js`](js/03-filtrar-por-score.js)).

---

## 5. Probar en clase con cualquier PDF

1. **Execute workflow** → formulario → URL o archivo → **Modo de carga** → Submit.
2. **Open chat** y preguntá. Dejá ~15 s entre preguntas.

PDFs públicos probados:

```
Reglamento LPF (28 págs, Título › Capítulo › Artículo):
https://raw.githubusercontent.com/Carolina053Peke/AI-Automation-Avanzado/main/clase%205/Reglamento-General-LPF-2025.pdf

Especificación de requisitos SRS (3 págs, "1." "2." y "Fase N"):
https://raw.githubusercontent.com/leanaraque/ai-automation-avanzada/main/Semana%204%20Intervenci%C3%B3n%20humana/Clase%208/Especificaci%C3%B3n%20de%20Requisitos%20(SRS).pdf
```

```
¿qué tiene que cumplir alguien para representar a un club en el comité ejecutivo?   → Art. 14, pág. 14
¿en qué formato tiene que salir la respuesta del modelo en el orquestador de triage? → JSON (SRS, Fase 1)
¿qué pasa si el auditor médico no responde la alerta?                               → SRS, Fase 4
¿quién ganó el último torneo?                                                       → "No sé"
```

Para usar **tu propio PDF**: una URL directa al `.pdf` (en GitHub, el botón **Raw**) o subirlo. Con **Reemplazar** el agente solo sabe de ese PDF. Con **Agregar** sabe de todos y cita de cuál sacó cada cosa.

## 6. Casos reales para el Hallucination Courtroom (todos salieron probando esto)

1. **"No sé [Fuente: … › ÍNDICE]"**: el chunker viejo guardó el índice como chunk. Culpable: el **chunking**, no el LLM.
2. **Siempre los mismos 4 chunks**: embeddings rotos (créditos gratis de n8n). Culpable: los **embeddings**. El paso 3 del triage da *no*.
3. **El Art. 15 desaparecido**: su título venía en negrita y no con `#`. Culpable: el **chunking**.
4. **El logo "AFA LPF" como título**: LlamaParse lo puso con `#` en la página 9 y cortó el Art. 5 en dos. Culpable: el **parseo** más el chunking. Lo arreglamos con la regla de siglas sueltas.
5. **Contestó la pregunta anterior**: a "¿quién ganó el último torneo?" respondió lo del auditor, que era la pregunta de antes. La búsqueda no trajo nada, el modelo miró el **historial** y volvió a contestar lo viejo. Culpable: la **memoria** más el **prompt**. Se arregló con la regla 1: "una pregunta por vez".

## 7. Tropiezos

| Síntoma | Causa y arreglo |
|---|---|
| `The 'file' field must be a file upload, not a string` | En *LlamaParse: subir PDF*, el campo `file` tiene que ser **n8n Binary File** |
| Error en *LlamaParse: ¿terminó?* | Le falta la **credencial Bearer**, que es la misma que la del POST |
| `Credentials not found` | Abrí el nodo y elegí la credencial |
| `Index … not found` (aunque aparezca en la lista) | Revisá el índice en la consola (sección 1.1): 1024 · cosine · sin modelo integrado |
| Error de dimensión al insertar | El índice no es de 1024 o cambiaste el modelo de embeddings |
| "The service is receiving too many requests" | Tope por minuto de Groq. Esperá 30 s (ya tiene respaldo y menos tokens) |
| Responde la pregunta anterior | Falta la regla 1 del prompt ("una pregunta por vez") |
| `El documento no tiene texto útil` | El PDF no tiene texto que LlamaParse pueda leer |
| `model llama-3.3-70b-versatile does not exist` | Usá `openai/gpt-oss-120b` |

## Archivos

- `workflow/clase-5-rag.json`: **versión Pinecone** (la del programa, genérica). Trae el índice `clase5-rag`: cambialo en los 3 nodos de Pinecone por el tuyo.
- `workflow/replay-clase-5-ingesta-pinecone.mp4` y `workflow/replay-poster.jpg`: el replay de la clase.
- `workflow/clase-5-rag-memoria.json`: la misma, con **base en memoria** (sin Pinecone; se borra si n8n se reinicia).
- `js/`: los 3 Code.
- `Reglamento-General-LPF-2025.pdf`: el documento de ejemplo.
- `test/build_workflow.py`: genera los dos JSON.
