/* eslint-env node */
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';

import multer from 'multer';
import pdfParseCjs from 'pdf-parse/lib/pdf-parse.js';
const pdfParse = pdfParseCjs.default || pdfParseCjs;

dotenv.config();
const execPromise = util.promisify(exec);
const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH'], credentials: false }));
app.use(express.json());

const executionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { output: "Too many requests, please try again later" }
});

const materials = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (increase from 10MB)
});

function chunkText(text, size = 256, overlap = 64) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += (size - overlap)) {
    const slice = words.slice(i, i + size).join(' ');
    if (slice.trim()) out.push(slice);
  }
  return out.map((t, i) => ({ idx: i + 1, text: t }));
}

function topKChunks(chunks, query, k = 6) {
  const qWords = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
  const scored = chunks.map(c => {
    const t = c.text.toLowerCase();
    let s = 0; qWords.forEach(w => { if (t.includes(w)) s += 1; });
    return { ...c, score: s };
  });
  return scored.sort((a,b) => b.score - a.score).slice(0, k).filter(c => c.score > 0);
}

// OpenRouter client for text generation (chat completions)
const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// OpenAI client for embeddings (must use real OpenAI API)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Your actual OpenAI API key
});

const exampleConversations = [
  {
    role: "system",
    content: `Example 1:
User: "Why do 0.1 and 0.2 not add up cleanly?"
Assistant: "Floating-point stores decimals in binary, so some values are only approximated. What output do you expect if you format the sum with many digits? 
\`\`\`python
value = 0.1 + 0.2
print(f"{value:.17f}")
# TODO: import Decimal and compare
\`\`\`
Run this in the editor and tell me what pattern you notice."`
  },
  {
    role: "system",
    content: `Example 2:
User: "My if statement never runs."
Assistant: "An if executes when its condition is True. Which expression are you checking, and could indentation prevent the block from executing? 
\`\`\`python
age = 15  # TODO: change test value
if age >= 18:
    print("Ticket easy")
else:
    print("Need guardian")
\`\`\`
Try tweaking the condition and see when the message flips."`
  },
  {
    role: "system",
    content: `Example 3:
User: "How do I decompose a problem into functions?"
Assistant: "Break the task into named steps—each function does one thing. Which subtasks do you see? Maybe input, compute, and report. 
\`\`\`python
def read_value():
    # TODO: ask the user for data
    return 0

def process(value):
    # TODO: implement the algorithm
    return value

def main():
    v = read_value()
    print(process(v))

main()
\`\`\`
Sketch the TODOs first, then fill them in one at a time."`
  },
  {
    role: "system",
    content: `Example 4:
User: "Lists vs tuples vs sets confuse me."
Assistant: "Lists are mutable sequences, tuples are fixed, sets store unique items. Which property do you need for your problem? 
\`\`\`python
items = ["A", "B", "B"]
unique_items = set(items)
# TODO: convert back to list if order matters
print(unique_items)
\`\`\`
Experiment in the editor and note how each structure behaves."`
  },
  {
    role: "system",
    content: `Example 5:
User: "When should I use classes?"
Assistant: "Use classes when you bundle data with behaviors. Imagine a simple bank account—what attributes and methods belong together? 
\`\`\`python
class Account:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance
    def deposit(self, amount):
        # TODO: update balance safely
        return self.balance

acct = Account("Ada")
\`\`\`
Add a withdraw method and test it in the editor."`
  },
  {
    role: "system",
    content: `Example 6:
User: "My loop never stops."
Assistant: "A loop must change state each iteration so the condition becomes False. Where does your counter or data change? 
\`\`\`python
count = 0
while count < 5:
    print(count)
    # TODO: increment or break when done
\`\`\`
Run this and modify the TODO. Does the loop now finish as expected?"`
  }
];

function summarizeRecentQuizzes(sessionDoc, max = 2) {
  if (!sessionDoc?.interactions?.length) return '';

  const quizEntries = sessionDoc.interactions
    .filter((it) => it.type === 'quiz')
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, max);

  if (!quizEntries.length) return '';

  const lines = quizEntries.map((quiz, idx) => {
    const dateLabel = quiz.timestamp
      ? new Date(quiz.timestamp).toISOString().split('T')[0]
      : `Quiz ${idx + 1}`;

    const questionPreview = (quiz.quizQuestion || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);

    const label = (n) =>
      typeof n === 'number' && n >= 0 ? String.fromCharCode(65 + n) : '?';
    const choice = (n) =>
      typeof n === 'number' && quiz.quizChoices?.[n]
        ? quiz.quizChoices[n]
        : '';

    const student = label(quiz.selectedAnswer);
    const studentChoice = choice(quiz.selectedAnswer);
    const correct = label(quiz.correctAnswer);
    const correctChoice = choice(quiz.correctAnswer);

    return `[${dateLabel}] ${quiz.isCorrect ? 'Correct' : 'Incorrect'} • `
      + `Q: "${questionPreview}${questionPreview.length === 100 ? '…' : ''}" `
      + `• Student: ${student}${studentChoice ? ` ${studentChoice}` : ''}`
      + (quiz.isCorrect
        ? ''
        : ` • Correct: ${correct}${correctChoice ? ` ${correctChoice}` : ''}`);
  });

  return `QUIZ HISTORY (last ${lines.length})\n${lines.join('\n')}`;
}

app.post('/ai/ask', async (req, res) => {
  try {
    const { query, code, output, sessionId, userId } = req.body;

    const simpleTestMessages = [
      'test','hello','hi','hey','cool','nice',
      'just testing','i am just testing','hello there','hi there','hallo','halo',"fuck you", "i don't care"
    ];
    const queryLower = (query || '').toLowerCase().trim();
    const isSimpleTest = simpleTestMessages.some(
      msg => queryLower === msg || (queryLower.includes(msg) && queryLower.length < 5)
    );
    if (isSimpleTest) {
      return res.json({ response: "Hi! I'm here to help with Python programming. Ask me about lists, functions, classes, loops, or any Python concepts!" });
    }


    let retrieved = [];
    if (sessionId) {
      retrieved = await retrieveRelevantChunks(query, sessionId, 6);
      console.log(`Retrieved ${retrieved.length} chunks for AI context`);
    } else {
      console.warn('⚠️  No sessionId provided, RAG disabled');
    }

    let quizHistorySummary = '';
    if (sessionId && mongoose.connection.readyState === 1) {
      try {
        const sessionDoc = await Session.findById(sessionId).lean();
        quizHistorySummary = summarizeRecentQuizzes(sessionDoc, 2);
      } catch (err) {
        console.warn('Unable to load quiz history:', err?.message || err);
      }
    }

    const contextSections = [];
    if (retrieved.length) {
      contextSections.push(
        `CONTEXT (from materials)\n` +
        `You have access to ${retrieved.length} relevant document chunks. Use them to answer.\n\n` +
        retrieved.map((r, i) => 
          `[Chunk ${i+1}] Source: ${r.source === 'system' ? 'Course Material' : 'Student Upload'} - "${r.title.slice(0,40)}"\n${r.text.slice(0, 1000)}\n`
        ).join('\n---\n')
      );
    }
    if (quizHistorySummary) {
      contextSections.push(quizHistorySummary);
    }

    const contextBlock = contextSections.length
      ? `\n\n${contextSections.join('\n\n---\n\n')}`
      : '';

    if (contextBlock) {
      console.log(`✓ Adding ${retrieved.length} chunks (${retrieved.reduce((sum, r) => sum + r.text.length, 0)} chars) to AI context`);
    }

    const systemMessage = `You are “Haskify Tutor,” the blended GPR (Grundlagen Praktische Informatik) + EPI (Einführung in das Programmieren) coach for the course “Einführung in die Praktische Informatik”.  
PRIMARY MISSION  
- Guide first-semester students through the WHY (GPR theory) and the HOW (EPI programming practice) of Python.  
- Show how programming, as a craft, supports larger problem-solving tasks.  
- Keep the focus on Python (interpreter, dynamic typing, procedural, OO, and small functional elements). If a question strays outside Python/intro CS, steer the learner back to the module scope.

SEMESTER CONTEXT  
- GPR: foundational computer science ideas—numbers, IEEE 754, strings/ASCII/Unicode, data structures, version control, functional decomposition, OOP concepts, UML, GUIs, data/ML.  
- EPI: hands-on Python—first steps, control flow, functions, modules & docstrings, aggregated data types, recursion vs iteration, classic data structures, OO classes, GUI/exception handling, data & ML notebooks, final exam prep.  
- Remind students that mastering programming takes practice and time. Encourage them to pair theory with coding exercises.

TUTORING STYLE  
1. Start with a plain-language summary of the concept. If student's asking small questions and follow ups be direct.  
2. Say how the concept supports the module's overall programming as a method for problem solving goal.  
3. Ask one diagnostic or reflective question (“What do you think…?”) to draw out the learner's understanding.  
4. Offer a short Python snippet with comments or TODOs—never a full solution. Mention they can run it in the editor.  
5. Suggest an experiment or next step (trace, debug, compare theory vs practice, link GPR → EPI).  
6. Celebrate progress; close with encouragement or a challenge for self-study. But don't make it repetitive.

CONTENT RULES  
- Use only plain text and code fences. If you have code to show, wrap it in triple-backtick fences using the language label python. Do not use bold/italic or other markdown.
- Students can use German in their questions. There are German materials available. Please answer in English. Keep it in English.
- Your code responses should be in formatted python code blocks.
- Keep responses not very long unless the student explicitly requests more depth.  
- Prefer evidence from provided CONTEXT (uploaded material or weekly notes). If unsure, say so and propose how to investigate.  
- Decline unsafe/out-of-scope requests politely.  

AVAILABLE MATERIAL  
${retrieved.length > 0 ? `• You can reference: ${retrieved.map(r => r.title).join(', ')}.` : '• No extra material attached for this question.'}

CURRENT WORKSPACE  
\`\`\`python
${code || '# Student has not written code yet.'}
\`\`\`
${output ? `Most recent output:\n\`\`\`\n${output}\n\`\`\`` : ''}
${contextBlock}
Always connect answers back to the semester goals and keep the student actively learning.`;

    const stream = await openrouter.chat.completions.create({
      model: "google/gemma-3-27b-it:free",
      messages: [
        { role: "system", content: systemMessage },
        ...exampleConversations,
        { role: "user", content: query }
      ],
      stream: true,
      temperature: 0.35
    });

    let responseText = "";
    for await (const chunk of stream) {
      responseText += chunk.choices[0]?.delta?.content || "";
    }

    // Clean up response artifacts
    responseText = responseText
      .trim()
      .replace(/^[:;,\.\-\s]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Fallback for empty responses
    if (!responseText || responseText.length < 3) {
      responseText = "I'm here to help with Python. What would you like to know?";
    }

    try {
      // Create interaction object
      const interaction = {
        type: 'ai',
        question: query || '',
        aiResponse: responseText || '',
        code: code || '',
        output: output || '',
        materialIds: Array.isArray(retrieved) ? retrieved.map(r => r.source === 'system' ? r.title : r.title) : [],
        timestamp: new Date()
      };

      if (sessionId) {
        // Update existing session with new interaction
        await Session.findByIdAndUpdate(
          sessionId,
          { 
            $push: { interactions: interaction },
            $set: { 
              lastActivity: new Date(),
              ...(userId && { userId: userId })
            }
          },
          { new: true }
        );
      } else {
        // Create new session with first interaction
        const newSession = new Session({
          userId: userId || null,
          interactions: [interaction]
        });
        const savedSession = await newSession.save();
        
        // Return the sessionId to frontend
        return res.json({ 
          response: responseText,
          sessionId: savedSession._id 
        });
      }
    } catch (logErr) {
      console.warn('Session update failed:', logErr?.message);
    }

    return res.json({ response: responseText });
  } catch (error) {
    console.error("OpenAI Error:", error);
    return res.status(500).json({ response: "⚠️ AI couldn't respond" });
  }
});

app.post('/run-python', executionLimiter, async (req, res) => {
  try {
    const code = req.body.code;
    if (!code || typeof code !== 'string' || code.length > 10000) {
      return res.status(400).json({ output: "Invalid code: Must be <10KB" });
    }
    if (code.includes('System.IO.Unsafe') || code.includes('unsafePerformIO')) {
      return res.status(400).json({ output: "Unsafe operations not allowed" });
    }

    const tempFile = `/tmp/python-${Date.now()}.py`;
    fs.writeFileSync(tempFile, code);

    const { stderr: compileError } = await execPromise(
      `python3 ${tempFile}`,
      { maxBuffer: 1024 * 1024 }
    );
    if (compileError) {
      return res.status(400).json({ output: compileError });
    }

    // Run
    const { stdout, stderr } = await execPromise(
      `echo "${req.body.input || ''}" | timeout 30s python3 ${tempFile}`,
      { maxBuffer: 1024 * 1024 }
    );
    return res.json({ output: stdout || stderr || "> Program executed (no output)" });
  } catch (runError) {
    console.error("Execution error:", runError);
    return res.status(500).json({ output: runError.stderr || "Execution timed out or crashed" });
  }
});

app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  
  // Validation
  if (!name || !email || !message) {
    return res.status(400).json({ 
      success: false, 
      error: 'Name, email, and message are required' 
    });
  }
  
  if (message.length < 10) {
    return res.status(400).json({ 
      success: false, 
      error: 'Message must be at least 10 characters' 
    });
  }

  try {
    // Save to database
    const contactMessage = new ContactMessage({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      message: message.trim(),
      userAgent: req.headers['user-agent']
    });
    
    await contactMessage.save();
    console.log(`✓ Contact message saved from ${email} (ID: ${contactMessage._id})`);
    return res.json({ success: true, message: 'Message sent successfully' });

  } catch (err) {
    console.error("Contact form error:", err);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to submit message. Please try again.' 
    });
  }
  
});

app.post('/api/save-session', async (req, res) => {
  try {
    const { session } = req.body;
    if (!Array.isArray(session) || session.length === 0) {
      return res.status(400).json({ success: false, error: 'Session data required' });
    }
    const saved = await Session.create({ session });
    return res.json({ success: true, id: saved._id });
  } catch (err) {
    console.error("Save session error:", err);
    return res.status(500).json({ success: false, error: 'Failed to save session' });
  }
});

app.patch('/api/save-session/:id', async (req, res) => {
  try {
    const { session } = req.body;
    const { id } = req.params;
    if (!Array.isArray(session) || session.length === 0) {
      return res.status(400).json({ success: false, error: 'Session data required' });
    }
    const updated = await Session.findByIdAndUpdate(id, { session }, { new: true });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Update session error:", err);
    return res.status(500).json({ success: false, error: 'Failed to update session' });
  }
});

/**
 * @typedef {object} QuizPayload
 * @property {string}   id
 * @property {string}   question
 * @property {string[]} choices
 * @property {number}   correctIndex
 */

// Store quiz hashes per session with expiration
const sessionQuizHashes = new Map(); // sessionId -> Set of hashes

function hashQuiz(q) {
  const base = `${q.question}`;  // Include choices
  const hash = crypto.createHash('sha1').update(base).digest('hex');
  console.log(`  Hash: ${hash.substring(0, 8)}... for: "${q.question.substring(0, 40)}..."`);
  return hash;
}

// Clean up old session hashes (run periodically)
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, data] of sessionQuizHashes.entries()) {
    // Remove sessions older than 2 hours
    if (now - data.timestamp > 2 * 60 * 60 * 1000) {
      sessionQuizHashes.delete(sessionId);
    }
  }
}, 15 * 60 * 1000); // Clean every 15 minutes

app.post('/api/quiz', async (req, res) => {
  const { chatHistory = [], materialIds = [], sessionId } = req.body;
  
  console.log(`\nQuiz request:`);
  console.log(`  SessionId: ${sessionId ? sessionId.substring(0, 12) + '...' : 'MISSING!'}`);
  console.log(`  Current sessions tracked: ${sessionQuizHashes.size}`);
  
  // Get or create quiz hash set for this session
  if (sessionId && !sessionQuizHashes.has(sessionId)) {
    sessionQuizHashes.set(sessionId, { 
      hashes: new Set(), 
      timestamp: Date.now() 
    });
  }
  const sessionHashes = sessionId ? sessionQuizHashes.get(sessionId).hashes : new Set();

  let context = '';
  try {
    if (Array.isArray(materialIds) && materialIds.length) {
      const all = [];
      for (const id of materialIds) {
        const mat = materials.get(id);
        if (mat?.chunks) for (const c of mat.chunks) all.push({ ...c, _from: id, _title: mat.title });
      }
      const pseudoQuery = JSON.stringify(chatHistory.slice(-8));
      const top = topKChunks(all, pseudoQuery, 6);
      if (top.length) {
        context = '\nCONTEXT:\n' + top.map(r => `[${(r._title||'Material')} #${r.idx}] ${r.text}`).join('\n---\n');
      }
    }
  } catch {}

  // Add variety instructions based on previous quizzes
  const previousTopics = sessionId && sessionHashes.size > 0 
    ? `\nYou have already generated ${sessionHashes.size} quiz(zes) in this session. Generate a question about a DIFFERENT Python topic or concept.`
    : '';

  const systemPrompt = `
You are “Haskify Tutor – Quiz Mode.” Create exactly ONE multiple-choice question for first-year students in “Einführung in die Praktische Informatik” (GPR + EPI). Keep it aligned with the weekly curriculum (numbers, IEEE 754, strings/ASCII, control flow, functions, data structures, OOP, UML, GUIs, data/ML, etc.) and emphasise practical problem-solving with Python.

CONTEXT (use when present, never invent facts):
${context || '• No extra material provided for this quiz.'}
${previousTopics}

QUIZ REQUIREMENTS
- Difficulty: “introductory”, “reinforcement” or "advanced".
- Structure: one question stem, four concise answer choices labeled A–D, exactly ONE correct choice.
- Blend theory and practice—for example link a GPR concept (why) to an EPI skill (how).
- Ask for reasoning or prediction (e.g. “What output…?”, “Which statement best explains…?”).
- Encourage experimentation (mention running a quick snippet) where relevant.
- Avoid trivia, gotchas, and topics outside the module scope.

OUTPUT FORMAT
Return a single JSON object with keys, NO EXPLANATION:
  "id": UUID string,
  "topic": short topic label (e.g. "Loops – while"),
  "question": the question text,
  "choices": array of 4 strings in the form "A) …", "B) …", "C) …", "D) …",
  "correctIndex": integer 0–3,
  "hint": one-sentence hint encouraging students to try or inspect code,
  "explanation": 1–2 sentences explaining the correct answer (reference CONTEXT if used).

Return ONLY that JSON (no markdown fences, no prose).`.trim();

  try {
    let attempts = 0;
    let quiz;

    while (attempts < 5) { // Increased from 3 to 5 attempts
      const completion = await openrouter.chat.completions.create({
        model: "google/gemma-3-27b-it:free",
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate the JSON quiz object described above. Recent chat: ${JSON.stringify(chatHistory.slice(-3))}` }
        ],
        temperature: 1.2 + (attempts * 0.1) // Increase temperature with each attempt
      });

      let text = completion.choices[0].message.content.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
      }

      quiz = JSON.parse(text);

      if (
        typeof quiz.id === 'string' &&
        typeof quiz.question === 'string' &&
        Array.isArray(quiz.choices) &&
        typeof quiz.correctIndex === 'number'
      ) {
        const h = hashQuiz(quiz);
        
        // Check if this quiz was already generated in THIS session
        if (!sessionHashes.has(h)) {
          sessionHashes.add(h);
          console.log(`✓ Generated unique quiz (${sessionHashes.size} total for session)`);
          break; 
        } else {
          console.log(`  Duplicate quiz detected, retrying (attempt ${attempts + 1})...`);
          systemPrompt += `\n\nIMPORTANT: The previous question was a duplicate. Generate a question about a COMPLETELY DIFFERENT topic like: ${['error handling', 'file operations', 'dictionary methods', 'string formatting', 'lambda functions', 'decorators'][attempts % 6]}.`;
          attempts++;
          continue;
        }
      } else {
        attempts++;
      }
    }

    if (!quiz) throw new Error('Invalid quiz format after maximum attempts');

    return res.json(quiz);
  } catch (err) {
    console.error('Quiz generation error:', err);
    return res.status(500).json({ error: 'Failed to generate quiz. Please try again later.' });
  }
});

// === Upload material (PDF) ===
// For MVP, PDF only. (To extend later: accept text/plain, text/markdown, docx, etc.)
app.post('/api/upload-material', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const { sessionId } = req.body; // Must provide sessionId
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    
    let chunks;
    let fileType;
    
    // Process based on file type
    if (req.file.mimetype === 'application/pdf' || req.file.originalname.endsWith('.pdf')) {
      const parsed = await pdfParse(req.file.buffer);
      const text = (parsed.text || '').trim();
      if (!text) return res.status(400).json({ error: 'PDF has no extractable text' });
      chunks = chunkText(text, 500, 50); // smaller chunks for better retrieval
      fileType = 'pdf';
    } else if (req.file.originalname.endsWith('.py')) {
      chunks = extractPythonContent(req.file.buffer);
      fileType = 'python';
    } else {
      return res.status(400).json({ error: 'Only PDF and Python files supported' });
    }
    
    if (!chunks.length) {
      return res.status(400).json({ error: 'No content extracted' });
    }
    
    // Generate embeddings for all chunks
    console.log(`Generating embeddings for ${chunks.length} chunks...`);
    const embeddedChunks = await generateEmbeddings(chunks);
    
    // Save to MongoDB with expiration (e.g., 24 hours)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const sessionMaterial = new SessionMaterial({
      sessionId,
      userId: req.body.userId || null,
      title: req.file.originalname,
      fileType,
      chunks: embeddedChunks,
      expiresAt
    });
    
    await sessionMaterial.save();
    
    // Return materialId (use MongoDB _id as string)
    const materialId = sessionMaterial._id.toString();
    
    return res.json({ 
      materialId, 
      title: req.file.originalname, 
      chunks: embeddedChunks.length 
    });
  } catch (e) {
    console.error('Upload error:', e);
    return res.status(500).json({ error: 'Failed to process file' });
  }
});

app.get('/api/materials/:id', (req, res) => {
  const m = materials.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json({ title: m.title, chunks: m.chunks.length });
});

app.get('/health', (req, res) => {
  res.send('OK');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

const mongoUri = process.env.MONGODB_URI;
if (mongoUri) {
  mongoose.connect(mongoUri)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));
} else {
  console.warn('No MONGODB_URI found in .env, MongoDB not connected');
}

// Update your sessionSchema to include interaction objects
const sessionSchema = new mongoose.Schema({
  userId: { type: String, index: true }, // Add userId to sessions
  createdAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now },
  interactions: [
    {
      type: { type: String, enum: ['ai', 'run', 'quiz'], required: true }, // Added 'quiz'
      question: String,           // for type 'ai' or 'quiz'
      aiResponse: String,         // for type 'ai'
      code: String,              // captured code snapshot
      output: String,            // code output or current output context
      materialIds: [String],     // attached materials on that turn
      
      // Quiz-specific fields
      quizQuestion: String,      // The quiz question text
      quizChoices: [String],     // Array of answer choices
      correctAnswer: Number,     // Index of correct answer
      selectedAnswer: Number,    // Index of student's answer
      isCorrect: Boolean,        // Whether student answered correctly
      
      timestamp: { type: Date, default: Date.now },
      meta: Object               // room for future fields
    }
  ]
});

const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

const interactionSchema = new mongoose.Schema({
  userId: { type: String, index: true },
  sessionId: { type: String, index: true, sparse: true },
  type: { type: String, enum: ['ai', 'run'], required: true }, // 'ai' = AI Q/A, 'run' = code execution
  question: String,           // for type 'ai'
  aiResponse: String,         // for type 'ai'
  code: String,               // captured code snapshot
  output: String,             // code output or current output context
  materialIds: [String],      // attached materials on that turn
  meta: Object,               // room for future fields
  createdAt: { type: Date, default: Date.now }
});
interactionSchema.index({ userId: 1, createdAt: -1 });
const Interaction = mongoose.models.Interaction || mongoose.model('Interaction', interactionSchema);

// User Schema
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

// System Materials (Persistent) - admin-uploaded, hidden from users
const systemMaterialSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  fileType: { type: String, enum: ['pdf', 'python', 'text'], required: true },
  chunks: [{
    idx: Number,
    text: String,
    embedding: [Number], // 1536-dimensional vector for OpenAI embeddings
    metadata: {
      page: Number,      // for PDFs
      lineStart: Number, // for code files
      lineEnd: Number
    }
  }],
  tags: [String], // e.g., ['loops', 'functions', 'data-structures']
  isActive: { type: Boolean, default: true }, // toggle visibility
  createdAt: { type: Date, default: Date.now },
  createdBy: String // admin userId
});
systemMaterialSchema.index({ 'chunks.embedding': '2dsphere' }); // for vector search

// Session Materials (Temporary) - user-uploaded
const sessionMaterialSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  userId: String,
  title: { type: String, required: true },
  fileType: { type: String, enum: ['pdf', 'python'], required: true },
  chunks: [{
    idx: Number,
    text: String,
    embedding: [Number],
    metadata: Object
  }],
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true } // auto-delete after X hours
});
sessionMaterialSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
sessionMaterialSchema.index({ sessionId: 1, createdAt: -1 });

// Material reference tracking (for UI)
const materialReferenceSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  materialId: String, // UUID sent to frontend
  type: { type: String, enum: ['system', 'session'], required: true },
  dbId: { type: mongoose.Schema.Types.ObjectId }, // actual MongoDB _id
  title: String,
  attachedAt: { type: Date, default: Date.now }
});

// Create Mongoose Models from Schemas
const SystemMaterial = mongoose.models.SystemMaterial || 
  mongoose.model('SystemMaterial', systemMaterialSchema);

const SessionMaterial = mongoose.models.SessionMaterial || 
  mongoose.model('SessionMaterial', sessionMaterialSchema);

const MaterialReference = mongoose.models.MaterialReference || 
  mongoose.model('MaterialReference', materialReferenceSchema);

// Contact Message Schema
const contactMessageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  message: { type: String, required: true },
  submittedAt: { type: Date, default: Date.now },
  userAgent: String
});

const ContactMessage = mongoose.models.ContactMessage || 
  mongoose.model('ContactMessage', contactMessageSchema);

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { userId } = req.body;
    
    console.log('Login attempt for userId:', userId); // Debug log
    
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const trimmedUserId = userId.trim();
    console.log('Trimmed userId:', trimmedUserId); // Debug log
    
    // Check if user exists
    let user = await User.findOne({ userId: trimmedUserId });
    console.log('Found user:', user); // Debug log
    
    if (!user) {
      console.log('No user found for userId:', trimmedUserId); // Debug log
      return res.status(404).json({ success: false, error: 'Invalid User ID' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    return res.json({ 
      success: true, 
      user: { userId: user.userId, lastLogin: user.lastLogin }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// Create user endpoint 
app.post('/api/create-user', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const trimmedUserId = userId.trim();
    
    // Check if user already exists
    const existingUser = await User.findOne({ userId: trimmedUserId });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'User already exists' });
    }

    const user = new User({ userId: trimmedUserId });
    await user.save();

    return res.json({ 
      success: true, 
      user: { userId: user.userId, createdAt: user.createdAt }
    });
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

// Verify session endpoint
app.get('/api/verify-session', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID required' });
    }

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Invalid session' });
    }

    return res.json({ success: true, user: { userId: user.userId } });
  } catch (err) {
    console.error('Session verification error:', err);
    return res.status(500).json({ success: false, error: 'Session verification failed' });
  }
});

// Initialize or get active session for user
app.post('/api/session/init', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID required' });
    }

    // Check if user has an active session (within last 2 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const activeSession = await Session.findOne({
      userId: userId,
      lastActivity: { $gte: thirtyMinutesAgo }
    }).sort({ lastActivity: -1 });

    if (activeSession) {
      // Return existing active session
      return res.json({ 
        success: true, 
        sessionId: activeSession._id.toString(),
        isNew: false
      });
    }

    // Create new session
    const newSession = new Session({
      userId: userId,
      interactions: [],
      createdAt: new Date(),
      lastActivity: new Date()
    });
    
    await newSession.save();
    
    return res.json({ 
      success: true, 
      sessionId: newSession._id.toString(),
      isNew: true
    });
  } catch (err) {
    console.error('Session initialization error:', err);
    return res.status(500).json({ success: false, error: 'Failed to initialize session' });
  }
});

// Add this debug endpoint
app.get('/api/debug-collection', async (req, res) => {
  try {
    const collectionName = User.collection.name;
    const dbName = User.db.name;
    console.log('Collection name:', collectionName);
    console.log('Database name:', dbName);
    
    // Try to find the admin user
    const adminUser = await User.findOne({ userId: 'admin' });
    console.log('Admin user found:', adminUser);
    
    return res.json({ 
      collectionName, 
      dbName, 
      adminUser,
      totalUsers: await User.countDocuments()
    });
  } catch (err) {
    console.error('Debug error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/log/run', async (req, res) => {
  try {
    const { userId, sessionId, code, output } = req.body;
    
    // Create interaction object
    const interaction = {
      type: 'run',
      code: code || '',
      output: output || '',
      timestamp: new Date()
    };

    if (sessionId) {
      // Update existing session with new interaction
      await Session.findByIdAndUpdate(
        sessionId,
        { 
          $push: { interactions: interaction },
          $set: { lastActivity: new Date() }
        },
        { new: true }
      );
      return res.json({ success: true, sessionId }); // Return existing sessionId
    } else {
      // Create new session with first interaction
      const newSession = new Session({
        userId: userId || null,
        interactions: [interaction]
      });
      await newSession.save();
      console.log(`✓ Created new session from code run: ${newSession._id}`);
      
      // Return the new sessionId so frontend can use it
      return res.json({ success: true, sessionId: newSession._id.toString() });
    }
  } catch (err) {
    console.error('Usage log (run) failed:', err);
    return res.status(500).json({ success: false });
  }
});

// Log quiz answer
app.post('/api/log/quiz', async (req, res) => {
  try {
    const { 
      userId, 
      sessionId, 
      quizQuestion, 
      quizChoices, 
      correctAnswer, 
      selectedAnswer 
    } = req.body;
    
    // Calculate if answer is correct
    const isCorrect = selectedAnswer === correctAnswer;
    
    // Create interaction object
    const interaction = {
      type: 'quiz',
      quizQuestion: quizQuestion || '',
      quizChoices: quizChoices || [],
      correctAnswer: correctAnswer,
      selectedAnswer: selectedAnswer,
      isCorrect: isCorrect,
      timestamp: new Date()
    };

    if (sessionId) {
      // Update existing session with new interaction
      await Session.findByIdAndUpdate(
        sessionId,
        { 
          $push: { interactions: interaction },
          $set: { lastActivity: new Date() }
        },
        { new: true }
      );
      
      console.log(`Quiz answer logged: ${isCorrect ? 'Correct' : 'Incorrect'} (Session: ${sessionId})`);
    } else {
      // Create new session with first interaction
      const newSession = new Session({
        userId: userId || null,
        interactions: [interaction]
      });
      await newSession.save();
      
      return res.json({ success: true, sessionId: newSession._id });
    }

    return res.json({ success: true, isCorrect });
  } catch (err) {
    console.error('Quiz logging failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Generate embeddings using OpenAI
async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.substring(0, 8000), // limit to 8k chars
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Embedding generation failed:', error);
    throw error;
  }
}

// Generate embeddings for all chunks
async function generateEmbeddings(chunks) {
  const embeddedChunks = [];
  for (const chunk of chunks) {
    const embedding = await generateEmbedding(chunk.text);
    embeddedChunks.push({
      ...chunk,
      embedding
    });
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return embeddedChunks;
}

// Cosine similarity
function cosineSimilarity(vec1, vec2) {
  let dot = 0, mag1 = 0, mag2 = 0;
  for (let i = 0; i < vec1.length; i++) {
    dot += vec1[i] * vec2[i];
    mag1 += vec1[i] * vec1[i];
    mag2 += vec2[i] * vec2[i];
  }
  return dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

// Retrieve relevant chunks using vector similarity
async function retrieveRelevantChunks(query, sessionId, k = 6) {
  try {
    console.log(`\n🔍 RAG Retrieval for query: "${query.substring(0, 50)}..."`);
    console.log(`   SessionId: ${sessionId}`);
    
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);
    console.log(`   ✓ Query embedding generated (${queryEmbedding.length}D)`);
    
    // Get all relevant materials
    const [systemMaterials, sessionMaterials] = await Promise.all([
      SystemMaterial.find({ isActive: true }),
      SessionMaterial.find({ sessionId })
    ]);
    
    console.log(`   Found ${systemMaterials.length} system materials, ${sessionMaterials.length} session materials`);
    
    // Collect all chunks with similarity scores
    const scoredChunks = [];
    
    // Process system materials
    for (const mat of systemMaterials) {
      console.log(`   Processing system material: ${mat.title} (${mat.chunks?.length || 0} chunks)`);
      for (const chunk of mat.chunks || []) {
        if (!chunk.embedding || chunk.embedding.length === 0) {
          console.warn(`   ⚠️  Chunk ${chunk.idx} missing embedding!`);
          continue;
        }
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        scoredChunks.push({
          text: chunk.text,
          idx: chunk.idx,
          similarity,
          source: 'system',
          title: mat.title,
          metadata: chunk.metadata
        });
      }
    }
    
    // Process session materials
    for (const mat of sessionMaterials) {
      console.log(`   Processing session material: ${mat.title} `);
      for (const chunk of mat.chunks || []) {
        if (!chunk.embedding || chunk.embedding.length === 0) {
          console.warn(`   ⚠️  Chunk ${chunk.idx} missing embedding!`);
          continue;
        }
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        scoredChunks.push({
          text: chunk.text,
          idx: chunk.idx,
          similarity,
          source: 'session',
          title: mat.title,
          metadata: chunk.metadata
        });
      }
    }
    
    console.log(`   Total chunks scored: ${scoredChunks.length}`);
    
    if (scoredChunks.length > 0) {
      // Show top 3 similarities
      const sorted = scoredChunks.sort((a, b) => b.similarity - a.similarity);
      console.log(`   Top similarities: ${sorted.slice(0, 3).map(c => c.similarity.toFixed(3)).join(', ')}`);
    }
    

    const results = scoredChunks
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k)
      .filter(c => c.similarity > 0.4); 
    
    console.log(`Returning ${results.length} relevant chunks (threshold: 0.4)`);
    
    return results;
  } catch (error) {
    console.error('Retrieval error:', error);
    return [];
  }
}

// Extract text from Python files
function extractPythonContent(buffer) {
  const code = buffer.toString('utf-8');
  const lines = code.split('\n');
  
  // Chunk by logical sections (functions, classes)
  const chunks = [];
  let currentChunk = [];
  let chunkStart = 1;
  
  lines.forEach((line, idx) => {
    currentChunk.push(line);
    
    // Chunk boundaries: function/class definitions or every ~50 lines
    const isDefinition = /^(def |class |async def )/.test(line);
    const shouldBreak = currentChunk.length >= 50 || 
                        (isDefinition && currentChunk.length > 10 && idx > 0);
    
    if (shouldBreak) {
      const text = currentChunk.join('\n').trim();
      if (text) {
        chunks.push({
          idx: chunks.length + 1,
          text,
          metadata: { lineStart: chunkStart, lineEnd: idx + 1 }
        });
      }
      currentChunk = [line];
      chunkStart = idx + 1;
    }
  });
  
  // Add remaining chunk
  if (currentChunk.length > 0) {
    const text = currentChunk.join('\n').trim();
    if (text) {
      chunks.push({
        idx: chunks.length + 1,
        text,
        metadata: { lineStart: chunkStart, lineEnd: lines.length }
      });
    }
  }
  
  return chunks;
}

// Clean up expired session materials (run periodically)
async function cleanupExpiredMaterials() {
  try {
    const result = await SessionMaterial.deleteMany({
      expiresAt: { $lt: new Date() }
    });
    console.log(`Cleaned up ${result.deletedCount} expired materials`);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredMaterials, 60 * 60 * 1000);

// Manual cleanup endpoint (optional)
app.post('/api/cleanup-session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await SessionMaterial.deleteMany({ sessionId });
    return res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    return res.status(500).json({ error: 'Cleanup failed' });
  }
});

// Admin-only endpoint to upload system materials
app.post('/api/admin/upload-system-material', upload.single('file'), async (req, res) => {
  try {
    // Add authentication check here
    const { adminKey, title, description, tags } = req.body;
    
    // Simple admin key check (replace with proper auth)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    let chunks, fileType;
    
    if (req.file.mimetype === 'application/pdf' || req.file.originalname.endsWith('.pdf')) {
      const parsed = await pdfParse(req.file.buffer);
      const text = (parsed.text || '').trim();
      if (!text) return res.status(400).json({ error: 'PDF has no extractable text' });
      chunks = chunkText(text, 500, 50);
      fileType = 'pdf';
    } else if (req.file.originalname.endsWith('.py')) {
      chunks = extractPythonContent(req.file.buffer);
      fileType = 'python';
    } else {
      return res.status(400).json({ error: 'Only PDF and Python files supported' });
    }
    
    console.log(`Generating embeddings for ${chunks.length} chunks...`);
    const embeddedChunks = await generateEmbeddings(chunks);
    
    const systemMaterial = new SystemMaterial({
      title: title || req.file.originalname,
      description: description || '',
      fileType,
      chunks: embeddedChunks,
      tags: tags ? JSON.parse(tags) : [],
      createdBy: 'admin'
    });
    
    await systemMaterial.save();
    
    return res.json({ 
      success: true,
      materialId: systemMaterial._id.toString(),
      title: systemMaterial.title,
      chunks: embeddedChunks.length 
    });
  } catch (e) {
    console.error('❌ System material upload error:', e);
    
    // Better error message for file size
    if (e.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ 
        error: `File too large. Maximum size is ${50}MB` 
      });
    }
    
    return res.status(500).json({ error: 'Failed to process file: ' + e.message });
  }
});

// List system materials (admin only)
app.get('/api/admin/system-materials', async (req, res) => {
  try {
    const { adminKey } = req.query;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const materials = await SystemMaterial.find({}, { chunks: 0 }); // exclude chunks from list
    return res.json({ materials });
  } catch (error) {
    console.error('List error:', error);
    return res.status(500).json({ error: 'Failed to list materials' });
  }
});
