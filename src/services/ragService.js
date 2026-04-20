const pdfParse = require('pdf-parse');
const fs = require('fs');
const { ChromaClient } = require('chromadb');
const { generateEmbedding} = require('../config/gemini');
const { cacheGet, cacheSet } = require('../config/redis');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let chromaClient = null;
const getChromaClient = () => {
  if (!chromaClient) {
    chromaClient = new ChromaClient({
      path: `http://${process.env.CHROMA_HOST || 'localhost'}:${process.env.CHROMA_PORT || 8000}`
    });
  }
  return chromaClient;
};

const splitTextIntoChunks = (text, chunkSize = 1000, overlap = 200) => {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) chunks.push({ text: chunk, startIdx: start });
    start += chunkSize - overlap;
  }
  return chunks;
};

const parsePDF = async (filePath) => {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return { text: data.text, pages: data.numpages };
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error.message}`);
  }
};

// const cosineSimilarity = (a, b) => {
//   let dot = 0, normA = 0, normB = 0;
//   for (let i = 0; i < a.length; i++) {
//     dot += a[i] * b[i];
//     normA += a[i] * a[i];
//     normB += b[i] * b[i];
//   }
//   return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
// };

const processDocument = async (documentId, filePath, fileType = 'pdf') => {
  try {
    let text = '';
    let pages = 1;

    if (fileType === 'pdf') {
      const parsed = await parsePDF(filePath);
      text = parsed.text;
      pages = parsed.pages;
    } else {
      text = fs.readFileSync(filePath, 'utf-8');
    }

    const chunks = splitTextIntoChunks(text);
    const collectionName = `doc_${documentId}`;

    const client = getChromaClient();

    try {
      await client.deleteCollection({ name: collectionName });
    } catch {}

    const collection = await client.createCollection({ name: collectionName });

    const ids = [];
    const embeddings = [];
    const documents = [];
    const metadatas = [];

    const BATCH_SIZE = 5;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      try {
        const results = await Promise.all(
          batch.map(chunk => generateEmbedding(chunk.text))
        );

        results.forEach((embedding, index) => {
          const chunkIndex = i + index;

          ids.push(`chunk_${chunkIndex}`);
          embeddings.push(embedding);
          documents.push(batch[index].text);
          metadatas.push({ chunkIndex });
        });

        await sleep(2000); // cool down

      } catch (err) {
        console.error(`Batch ${i} embedding failed: ${err.message}`);
      }
    }

    if (ids.length > 0) {
      await collection.add({ ids, embeddings, documents, metadatas });
    }
    console.log("Chunks stored:", ids.length); // ✅ ADD HERE
    return { totalChunks: ids.length, totalPages: pages, collectionName };

  } catch (error) {
    throw new Error(`Document processing failed: ${error.message}`);
  }
};

const searchSimilarChunks = async (collectionName, query, topK = 5) => {
  console.log("🔥 QUERY EMBEDDING RUN"); 
  try {
    console.log("Searching in collection:", collectionName);
    const cacheKey = `search:${collectionName}:${query.substring(0, 40)}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const client = getChromaClient();
    let collection;
    try {
      collection = await client.getCollection({ name: collectionName });
    } catch {
      return [];
    }

    const queryEmbedding = await generateEmbedding(query);
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
    });

    if (!results.documents || results.documents.length === 0) {
      console.log("No documents found in vector DB");
      return [];
    }

    const chunks = (results.documents[0] || []).map((doc, idx) => ({
      text: doc,
      similarity: 1 - (results.distances?.[0]?.[idx] || 0),
    }));

    await cacheSet(cacheKey, chunks, 300);
    return chunks;
  } catch (error) {
    console.error('Search error:', error.message);
    return [];
  }
};

const generateRAGAnswer = async (question, collectionName, chatHistory = []) => {
  try {
    const relevantChunks = await searchSimilarChunks(collectionName, question);

    if (relevantChunks.length === 0) {
      console.log("No relevant chunks found");
    
      return {
        prompt: `No relevant context found. Answer normally: ${question}`,
        relevantChunks: []
      };
    }

    const context = relevantChunks
      .map((c, i) => `[Source ${i + 1}]: ${c.text}`)
      .join('\n\n');

    const historyText = chatHistory
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const prompt = `
You are an expert AI assistant.

Strict Rules:
- Answer ONLY from the provided document context
- If answer not found → say "Not found in document"
- Do not hallucinate

Document Context:
${context}

${historyText ? `Chat History:\n${historyText}\n` : ''}

Question: ${question}

Answer:
`;
return { prompt, relevantChunks };
  } catch (error) {
    throw new Error(`RAG failed: ${error.message}`);
  }
};

const deleteDocumentVectors = async (collectionName) => {
  try {
    const client = getChromaClient();
    await client.deleteCollection({ name: collectionName });
  } catch { }
};

const testCollection = async () => {
  try {
    const client = getChromaClient();

    const col = await client.getCollection({ name: "doc_69ce19ca3c6807c247c5691c" }); // 🔁 REAL ID

    const count = await col.count();

    console.log("✅ Total vectors:", count);

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
};


if (process.env.DEBUG_VECTOR === "true") {
  testCollection();
}


module.exports = {
  parsePDF,
  processDocument,
  searchSimilarChunks,
  generateRAGAnswer,
  deleteDocumentVectors,
  splitTextIntoChunks,
};