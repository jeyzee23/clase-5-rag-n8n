import json, uuid, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
js = lambda f: (ROOT / 'js' / f).read_text()
uid = lambda: str(uuid.uuid4())
PC_INDEX = {"__rl": True, "mode": "list", "value": "clase5-rag", "cachedResultName": "clase5-rag"}
NS = "documentos"
LLAMA = "https://api.cloud.llamaindex.ai/api/v2/parse"

SYSTEM = """Sos un asistente que responde preguntas usando SOLO los documentos cargados en la base (PDFs).

REGLAS
1. Una pregunta por vez: respondé SOLO el último mensaje del usuario. El historial sirve para entender repreguntas ("¿y eso cuándo?"), pero NUNCA vuelvas a responder una pregunta anterior.
2. Buscar antes de responder: ante cualquier pregunta sobre el contenido de los documentos, usá SIEMPRE la herramienta buscar_documentos con la pregunta actual. Podés reformularla con las palabras formales que usaría el documento (ej. "me echan" → "rescisión", "vacaciones" → "licencia").
3. Solo fuentes: respondé únicamente con lo que dicen los fragmentos que devuelve la herramienta. PROHIBIDO completar con conocimiento propio.
4. Regla "No sé": si los fragmentos no responden la pregunta actual, respondé exactamente: "No sé: eso no figura en los documentos cargados."
5. Citar: terminá cada respuesta con la fuente tomada de la metadata del fragmento, formato [Fuente: archivo › sección, pág. N]. Nunca inventes una sección ni una página. Si respondés "No sé", no pongas fuente.
6. Saludos y charla: respondé corto y sin usar la herramienta.
7. Máximo 5 líneas. Tono claro, en español rioplatense."""

TOOL_DESC = ("Busca fragmentos en los documentos PDF cargados en la base (reglamentos, manuales, informes, "
             "contratos, especificaciones, etc.). Usala SIEMPRE antes de responder una pregunta sobre su contenido. "
             "Cada fragmento trae en su metadata 'source' (archivo), 'seccion' (ruta de títulos) y 'pagina' para citar.")
MODO = "Modo de carga"

nodes, conns = [], {}
def node(name, type_, ver, params, pos, **extra):
    n = {"parameters": params, "id": uid(), "name": name, "type": type_, "typeVersion": ver, "position": pos}
    n.update(extra); nodes.append(n); return name
def link(a, b, kind="main", out=0, inp=0):
    lst = conns.setdefault(a, {}).setdefault(kind, [])
    while len(lst) <= out: lst.append([])
    lst[out].append({"node": b, "type": kind, "index": inp})
def sticky(name, content, pos, w, h, color):
    nodes.append({"parameters": {"content": content, "height": h, "width": w, "color": color},
                  "id": uid(), "name": name, "type": "n8n-nodes-base.stickyNote", "typeVersion": 1, "position": pos})

# ---------------- CARRIL 1: INGESTA ----------------
Y = 0
node("Subir PDF", "n8n-nodes-base.formTrigger", 2.2, {
    "formTitle": "Cerebro Documental — Ingesta",
    "formDescription": "Subí el PDF que el agente va a usar como fuente de verdad, o pegá la URL de uno.",
    "formFields": {"values": [
        {"fieldLabel": "Documento", "fieldType": "file", "multipleFiles": False, "acceptFileTypes": ".pdf"},
        {"fieldLabel": "URL del PDF", "placeholder": "https://…/documento.pdf"},
        {"fieldLabel": MODO, "fieldType": "dropdown", "requiredField": True,
         "fieldOptions": {"values": [{"option": "Reemplazar todo lo cargado"}, {"option": "Agregar a lo que ya hay"}]}}]},
    "options": {}}, [0, Y], webhookId=uid())
node("Normalizar archivo", "n8n-nodes-base.code", 2, {"jsCode": js("01-normalizar-archivo.js")}, [220, Y])
node("LlamaParse: subir PDF", "n8n-nodes-base.httpRequest", 4.2, {
    "method": "POST", "url": f"{LLAMA}/upload",
    "authentication": "genericCredentialType", "genericAuthType": "httpBearerAuth",
    "sendBody": True, "contentType": "multipart-form-data",
    "bodyParameters": {"parameters": [
        {"parameterType": "formBinaryData", "name": "file", "inputDataFieldName": "data"},
        {"name": "configuration", "value": "{\"tier\": \"cost_effective\", \"version\": \"latest\"}"}]},
    "options": {}}, [440, Y])
node("Esperar 10 s", "n8n-nodes-base.wait", 1.1, {"amount": 10}, [660, Y], webhookId=uid())
node("LlamaParse: ¿terminó?", "n8n-nodes-base.httpRequest", 4.2, {
    "url": f"={LLAMA}/{{{{ $('LlamaParse: subir PDF').first().json.id }}}}",
    "authentication": "genericCredentialType", "genericAuthType": "httpBearerAuth",
    "sendQuery": True, "queryParameters": {"parameters": [{"name": "expand", "value": "markdown_full"}]},
    "options": {}}, [880, Y])
def rule(value, key):
    return {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
            "conditions": [{"id": uid(), "leftValue": "={{ $json.job.status }}", "rightValue": value,
                            "operator": {"type": "string", "operation": "equals"}}], "combinator": "and"},
            "renameOutput": True, "outputKey": key}
node("¿Estado del parseo?", "n8n-nodes-base.switch", 3.2, {
    "rules": {"values": [rule("COMPLETED", "Listo"), rule("FAILED", "Falló")]},
    "options": {"fallbackOutput": "extra", "renameFallbackOutput": "Sigue procesando"}}, [1100, Y])
node("Parseo falló", "n8n-nodes-base.stopAndError", 1, {
    "errorMessage": "={{ 'LlamaParse no pudo parsear el documento: ' + ($json.job.error_message || 'sin detalle') }}"}, [1320, Y + 120])
node("Chunking por títulos", "n8n-nodes-base.code", 2, {"jsCode": js("02-chunking-por-titulos.js")}, [1320, Y - 120])
node("Guardar en Pinecone", "@n8n/n8n-nodes-langchain.vectorStorePinecone", 1.3, {
    "mode": "insert", "pineconeIndex": PC_INDEX,
    "options": {"pineconeNamespace": NS,
                "clearNamespace": f"={{{{ $('Subir PDF').first().json['{MODO}'].startsWith('Reemplazar') }}}}"}}, [1560, Y - 120])
node("Cargar chunk + metadata", "@n8n/n8n-nodes-langchain.documentDefaultDataLoader", 1.1, {
    "jsonMode": "expressionData", "jsonData": "={{ $json.text }}", "textSplittingMode": "custom",
    "options": {"metadata": {"metadataValues": [
        {"name": "source", "value": "={{ $json.source }}"},
        {"name": "seccion", "value": "={{ $json.seccion }}"},
        {"name": "pagina", "value": "={{ $json.pagina }}"},
        {"name": "chunk", "value": "={{ $json.chunk }}"}]}}}, [1640, Y + 100])
node("No volver a cortar", "@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter", 1, {
    "chunkSize": 4000, "chunkOverlap": 0, "options": {}}, [1740, Y + 260])
node("Embeddings (ingesta)", "@n8n/n8n-nodes-langchain.embeddingsCohere", 1, {
    "modelName": "embed-multilingual-v3.0"}, [1480, Y + 100])

link("Subir PDF", "Normalizar archivo"); link("Normalizar archivo", "LlamaParse: subir PDF")
link("LlamaParse: subir PDF", "Esperar 10 s"); link("Esperar 10 s", "LlamaParse: ¿terminó?")
link("LlamaParse: ¿terminó?", "¿Estado del parseo?")
link("¿Estado del parseo?", "Chunking por títulos", out=0)
link("¿Estado del parseo?", "Parseo falló", out=1)
link("¿Estado del parseo?", "Esperar 10 s", out=2)
link("Chunking por títulos", "Guardar en Pinecone")
link("Cargar chunk + metadata", "Guardar en Pinecone", "ai_document")
link("No volver a cortar", "Cargar chunk + metadata", "ai_textSplitter")
link("Embeddings (ingesta)", "Guardar en Pinecone", "ai_embedding")

# ---------------- CARRIL 2: CHAT ----------------
Y2 = 620
node("Chat", "@n8n/n8n-nodes-langchain.chatTrigger", 1.1, {"options": {}}, [0, Y2], webhookId=uid())
node("Agente de documentos", "@n8n/n8n-nodes-langchain.agent", 2.2, {
    "needsFallback": True, "options": {"systemMessage": SYSTEM, "maxIterations": 5}}, [300, Y2])
node("Groq", "@n8n/n8n-nodes-langchain.lmChatGroq", 1, {
    "model": "openai/gpt-oss-120b", "options": {"temperature": 0.1}}, [180, Y2 + 220])
node("Memoria", "@n8n/n8n-nodes-langchain.memoryBufferWindow", 1.3, {"contextWindowLength": 4}, [340, Y2 + 220])
# Respaldo: si gpt-oss-120b llega al tope por minuto (free: 8.000 TPM), contesta este (tiene su propio cupo)
node("Groq (respaldo)", "@n8n/n8n-nodes-langchain.lmChatGroq", 1, {
    "model": "openai/gpt-oss-20b", "options": {"temperature": 0.1}}, [180, Y2 + 400])
node("buscar_documentos", "@n8n/n8n-nodes-langchain.vectorStorePinecone", 1.3, {
    "mode": "retrieve-as-tool", "toolDescription": TOOL_DESC, "pineconeIndex": PC_INDEX,
    "topK": 10, "includeDocumentMetadata": True, "useReranker": True,
    "options": {"pineconeNamespace": NS}}, [520, Y2 + 220])
node("Reranker", "@n8n/n8n-nodes-langchain.rerankerCohere", 1, {
    "modelName": "rerank-v3.5", "topN": 3}, [700, Y2 + 400])
link("Reranker", "buscar_documentos", "ai_reranker")
node("Embeddings (chat)", "@n8n/n8n-nodes-langchain.embeddingsCohere", 1, {
    "modelName": "embed-multilingual-v3.0"}, [520, Y2 + 400])
link("Embeddings (chat)", "buscar_documentos", "ai_embedding")
link("Chat", "Agente de documentos")
link("Groq", "Agente de documentos", "ai_languageModel")
link("Groq (respaldo)", "Agente de documentos", "ai_languageModel", inp=1)
link("Memoria", "Agente de documentos", "ai_memory")
link("buscar_documentos", "Agente de documentos", "ai_tool")

# ---------------- CARRIL 3: LABORATORIO DE SCORES (manual) ----------------
Y3 = 1320
node("Probar búsqueda", "n8n-nodes-base.manualTrigger", 1, {}, [0, Y3])
node("Perillas de búsqueda", "n8n-nodes-base.set", 3.4, {
    "assignments": {"assignments": [
        {"id": uid(), "name": "consulta", "type": "string", "value": "¿qué requisitos pide el documento?"},
        {"id": uid(), "name": "top_k", "type": "number", "value": 4},
        {"id": uid(), "name": "min_score", "type": "number", "value": 0.6}]},
    "options": {}}, [220, Y3])
node("Buscar en Pinecone", "@n8n/n8n-nodes-langchain.vectorStorePinecone", 1.3, {
    "mode": "load", "pineconeIndex": PC_INDEX, "prompt": "={{ $json.consulta }}",
    "topK": "={{ $json.top_k }}", "includeDocumentMetadata": True,
    "options": {"pineconeNamespace": NS}}, [440, Y3], alwaysOutputData=True)
node("Embeddings (laboratorio)", "@n8n/n8n-nodes-langchain.embeddingsCohere", 1, {
    "modelName": "embed-multilingual-v3.0"}, [440, Y3 + 200])
node("Filtrar por score", "n8n-nodes-base.code", 2, {"jsCode": js("03-filtrar-por-score.js")}, [680, Y3])
link("Probar búsqueda", "Perillas de búsqueda"); link("Perillas de búsqueda", "Buscar en Pinecone")
link("Buscar en Pinecone", "Filtrar por score")
link("Embeddings (laboratorio)", "Buscar en Pinecone", "ai_embedding")

# ---------------- NOTAS ----------------
sticky("Nota · Carril 1", "## 1 · INGESTA (se corre una vez por documento)\nForm → **LlamaParse** (PDF → markdown con títulos y tablas) → espera hasta `COMPLETED` → **chunking por títulos** con metadata → embeddings (Cohere, 1024 dim) → **Pinecone** (namespace `documentos`).\n\nSirve para **cualquier PDF**. En el form elegís **Reemplazar** (borra lo cargado: una sola versión vigente) o **Agregar** (suma el PDF a los que ya hay).",
       [-40, -320], 760, 240, 4)
sticky("Nota · Carril 2", "## 2 · CHAT\nEl agente decide cuándo buscar. System prompt: **buscar antes de responder**, **citar la fuente** y la regla **\"No sé\"**.",
       [-40, Y2 - 220], 760, 160, 5)
sticky("Nota · Carril 3", "## 3 · LABORATORIO DE SCORES (se corre a mano)\nEscribí una pregunta en **Perillas**, ejecutá y mirá los **scores**: así se calibra **Top-K** y **Min score** y se responde el paso 3 del triage (\"¿la búsqueda lo encontró?\").\nEl agente (nodo *buscar_documentos*) trae 10 y el **Reranker** de Cohere se queda con los 3 mejores.",
       [-40, Y3 - 220], 760, 170, 6)

wf = {"name": "Clase 5 · Cerebro Documental (RAG con LlamaCloud)", "nodes": nodes, "connections": conns,
      "pinData": {}, "active": False,
      "settings": {"executionOrder": "v1"}, "tags": []}
out = ROOT / "workflow" / "clase-5-rag.json"
out.write_text(json.dumps(wf, ensure_ascii=False, indent=2))
print("ok", out, len(nodes), "nodes")

# ---------------- VARIANTE SIN PINECONE (base en memoria de n8n) ----------------
# Mismo flujo, pero los 3 nodos de Pinecone pasan a "Simple Vector Store". Cero setup; se borra si n8n se reinicia.
import copy
mem = copy.deepcopy(wf)
renombre = {"Guardar en Pinecone": "Guardar en base vectorial", "Buscar en Pinecone": "Buscar en base vectorial"}
KEY = {"__rl": True, "mode": "list", "value": NS, "cachedResultName": NS}
for n in mem["nodes"]:
    if n["type"].endswith("vectorStorePinecone"):
        n["type"] = "@n8n/n8n-nodes-langchain.vectorStoreInMemory"; n["typeVersion"] = 1.3
        p = n["parameters"]; p.pop("pineconeIndex", None); opts = p.pop("options", {})
        p["memoryKey"] = KEY
        if p["mode"] == "insert": p["clearStore"] = opts.get("clearNamespace", True)
    n["name"] = renombre.get(n["name"], n["name"])
    if n["type"].endswith("stickyNote"):
        n["parameters"]["content"] = n["parameters"]["content"].replace("**Pinecone** (namespace `documentos`)", "**base en memoria** (clave `documentos`)")
mem["connections"] = {renombre.get(a, a): {k: [[{**c, "node": renombre.get(c["node"], c["node"])} for c in out] for out in v]
                                           for k, v in outs.items()} for a, outs in mem["connections"].items()}
mem["name"] = "Clase 5 · Cerebro Documental (RAG en memoria)"
out2 = ROOT / "workflow" / "clase-5-rag-memoria.json"
out2.write_text(json.dumps(mem, ensure_ascii=False, indent=2))
print("ok", out2)
