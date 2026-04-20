


let lastCall = 0;

const rateLimit = async () => {
  const now = Date.now();
  const diff = now - lastCall;

  if (diff < 1500) {
    await sleep(1500 - diff);
  }

  lastCall = Date.now();
};

const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

const getGenAI = () => {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set in .env file');
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
};

const getGeminiModel = () => {
  return getGenAI().getGenerativeModel({model: 'gemini-2.5-flash' });
};

const generateText = async (prompt, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      await rateLimit();
      const model = getGeminiModel();

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      if (!text) throw new Error('Empty response from Gemini');

      return text;

    } catch (error) {
      // 🔥 Rate limit handle
      if (error.message.includes('429') || error.message.toLowerCase().includes('quota')) {
        console.log(`Rate limit hit, retrying... (${i + 1})`);
        await sleep(3000 * (i + 1)); // exponential delay
        continue;
      }

      // ❌ other error → direct throw
      throw new Error(`Gemini generateText failed: ${error.message}`);
    }
  }

  throw new Error('Gemini failed after retries');
};



// const generateStreamingText = async (prompt, onChunk) => {
//   try {
//     const model = getGeminiModel();
//     const result = await model.generateContentStream(prompt);
//     let fullText = '';
//     for await (const chunk of result.stream) {
//       const chunkText = chunk.text();
//       if (chunkText) {
//         fullText += chunkText;
//         if (onChunk) onChunk(chunkText);
//       }
//     }
//     if (!fullText) {
//       // Fallback to non-streaming
//       const fallback = await generateText(prompt);
//       if (onChunk) onChunk(fallback);
//       return fallback;
//     }
//     return fullText;
//   } catch (error) {
//     throw new Error(`Gemini streaming failed: ${error.message}`);
//   }
// };


const generateStreamingText = async (prompt, onChunk, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const model = getGeminiModel();
      await rateLimit();
      const result = await model.generateContentStream(prompt);

      let fullText = '';

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          fullText += chunkText;
          if (onChunk) onChunk(chunkText);
        }
      }

      if (!fullText) {
        return await generateText(prompt);
      }

      return fullText;

    } catch (error) {
      if (error.message.includes('429') || error.message.includes('streaming')) {
        console.log(`Streaming retry... (${i + 1})`);
        await sleep(3000 * (i + 1));
        continue;
      }

      throw new Error(`Gemini streaming failed: ${error.message}`);
    }
  }

  throw new Error('Streaming failed after retries');
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// const generateEmbedding = async (text, retries = 3) => {
//   for (let i = 0; i < retries; i++) {
//     try {
//       const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`;
      

     

//       const res = await fetch(url, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           model: 'models/text-embedding-004',
//           content: { parts: [{ text }] }
//         })
//       });

//       const data = await res.json();

//       if (res.status === 429) {
//         await sleep(3000 * (i + 1));
//         continue;
//       }

//       if (!res.ok) {
//         throw new Error(data.error?.message || 'Embedding failed');
//       }

//       return data.embedding.values;

//     } catch (error) {
//       if (i < retries - 1) {
//         await sleep(2000);
//         continue;
//       }
//       throw new Error(`Embedding failed: ${error.message}`);
//     }
//   }
// };


// const generateEmbedding = async (text, retries = 3) => {
//   for (let i = 0; i < retries; i++) {
//     try {

//       console.log("✅ NEW EMBEDDING FUNCTION RUNNING");
//       const genAI = getGenAI();

//       const model = genAI.getGenerativeModel({
//         model: "text-embedding-004"
//       });

//       const result = await model.embedContent({
//         content: {
//           parts: [{ text }]
//         }
//       });

//       return result.embedding.values;

//     } catch (error) {
//       if (error.message.includes('429')) {
//         await sleep(3000 * (i + 1));
//         continue;
//       }

//       if (i < retries - 1) {
//         await sleep(2000);
//         continue;
//       }

//       throw new Error(`Embedding failed: ${error.message}`);
//     }
//   }
// };

const generateEmbedding = async (text, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      console.log("✅ FINAL EMBEDDING API RUN");

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: {
              parts: [{ text }],
            },
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Embedding failed");
      }

      return data.embedding.values;

    } catch (error) {
      console.error("Embedding error:", error.message);

      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      throw new Error(`Embedding failed: ${error.message}`);
    }
  }
};

const generateAI = async (prompt) => {
  try {
    return await generateText(prompt);
  } catch (err) {
    console.log("Gemini failed",err.message);

    throw new Error("AI service failed");
  }
};

module.exports = {
  getGenAI,
  getGeminiModel,
  generateText,
  generateStreamingText,
  generateEmbedding,
  generateAI
};

