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
  max: 100,
  message: { output: "Too many requests, please try again later" }
});

const materials = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, 
});

function chunkText(text, size = 900, overlap = 120) {
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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const exampleConversations = [
  {
    role: "system",
    content: "Example 1:\nUser: \"My function isn't working\"\nAssistant: \"Let's debug step by step. What's the error message? Try adding `print()` statements to see what values your variables have.\""
  },
  {
    role: "system",
    content: "Example 2:\nUser: \"How do I create a list?\"\nAssistant: \"Use square brackets: `my_list = [1, 2, 3]`. For empty list: `my_list = []`. What will you store in it?\""
  },
  {
    role: "system",
    content: "Example 3:\nUser: \"My code has an error\"\nAssistant: \"Check the error message carefully. Common issues: missing colons `:`, wrong indentation, or undefined variables. What does the error say?\""
  },
  {
    role: "system",
    content: "Example 4:\nUser: \"How do I loop through a list?\"\nAssistant: \"Use `for item in my_list:` or `for i in range(len(my_list)):`. Which approach do you need - just the values or also the index?\""
  },
  {
    role: "system",
    content: "Example 5:\nUser: \"What's wrong with my if statement?\"\nAssistant: \"Check: did you add a colon `:` after the condition? Is your indentation correct? \""
  },
  {
    role: "system",
    content: "Example 6:\nUser: \"How do I read a file?\"\nAssistant: \"Use `with open('filename.txt', 'r') as file:` then `content = file.read()`. What type of file are you working with?\""
  }
];

app.post('/ai/ask', async (req, res) => {
  try {
    const { query, code, output, materialIds, userId, sessionId } = req.body;

    const simpleTestMessages = [
      'test','hello','hi','hey','cool','nice',
      'just testing','i am just testing','hello there','hi there','hallo','halo',"fuck you", "i don't care"
    ];
    const queryLower = (query || '').toLowerCase().trim();
    const isSimpleTest = simpleTestMessages.some(
      msg => queryLower === msg || (queryLower.includes(msg) && queryLower.length < 10)
    );
    if (isSimpleTest) {
      return res.json({ response: "Hi! I'm here to help with Python programming. Ask me about lists, functions, classes, loops, or any Python concepts!" });
    }


    let retrieved = [];
    if (Array.isArray(materialIds) && materialIds.length) {
      const allChunks = [];
      for (const id of materialIds) {
        const mat = materials.get(id);
        if (mat?.chunks) {
          allChunks.push(...mat.chunks.map(c => ({ ...c, _from: id, _title: mat.title })));
        }
      }
      retrieved = topKChunks(allChunks, query, 6);
    }

    const contextBlock = retrieved.length
      ? `\n\nCONTEXT (from uploaded materials):\n` +
        retrieved.map(r => `[${(r._title || r._from).slice(0,40)} #${r.idx}] ${r.text}`).join('\n---\n')
      : '';

    const systemMessage = `You are a concise Python tutor. MAXIMUM 50 words per response.

RULES:
1. ONLY Python and programming questions
2. Prefer information from CONTEXT if provided; if missing, say you don't know.
3. NO complete solutions and code - only hints
4. Use ? placeholders
5. Give a short code example
6. Do not answer non-Python topics; if off-topic, say you're focused on Python.

Current code:
\`\`\`python
${code || ''}
\`\`\`
${output ? `Output: \`\`\`${output}\`\`\`` : ''}${contextBlock}

Keep it short. Hints only.`;

    const stream = await openai.chat.completions.create({
      model: "google/gemma-3-27b-it:free",
      messages: [
        { role: "system", content: systemMessage },
        ...exampleConversations,
        { role: "user", content: query }
      ],
      stream: true,
      temperature: 0.3
    });

    let responseText = "";
    for await (const chunk of stream) {
      responseText += chunk.choices[0]?.delta?.content || "";
    }

    try {
      // Create interaction object
      const interaction = {
        type: 'ai',
        question: query || '',
        aiResponse: responseText || '',
        code: code || '',
        output: output || '',
        materialIds: Array.isArray(materialIds) ? materialIds : [],
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
      `echo "${req.body.input || ''}" | timeout 10s python3 ${tempFile}`,
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
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'my_gmail@gmail.com',
      pass: 'my_gmail_app_password',
    }
  });

  try {
    await transporter.sendMail({
      from: email,
      to: 'kantarci@em.uni-frankfurt.de',
      subject: `Contact Form Submission from ${name}`,
      text: message,
      replyTo: email
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("Email send error:", err);
    return res.status(500).json({ success: false, error: 'Failed to send email' });
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

const seenQuizHashes = new Set();
function hashQuiz(q) {
  const base = `${q.question}||${(q.choices||[]).join('|')}||${q.correctIndex}`;
  return crypto.createHash('sha1').update(base).digest('hex');
}

app.post('/api/quiz', async (req, res) => {
  const { chatHistory = [], materialIds = [] } = req.body;

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

  let systemPrompt = `
You are a Python instructor. Generate exactly one multiple-choice quiz question about Python.
Prefer facts from CONTEXT if provided; do not fabricate.
${context}

Respond WITH NO EXPLANATION—only JSON with keys:
  id (UUID string),
  question (string),
  choices (array of 4 strings),
  correctIndex (0–3).
`.trim();

  try {
    let attempts = 0;
    let quiz;

    while (attempts < 3) {
      const completion = await openai.chat.completions.create({
        model: "google/gemma-3-27b-it:free",
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(chatHistory) }
        ],
        temperature: attempts === 0 ? 0.7 : 0.9
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
        if (!seenQuizHashes.has(h)) {
          seenQuizHashes.add(h);
          break; 
        } else {
          systemPrompt += "\nAvoid repeating previous quiz wording; vary topic or phrasing.";
          attempts++;
          continue;
        }
      } else {
        attempts++;
      }
    }

    if (!quiz) throw new Error('Invalid quiz format');

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
    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ error: 'Only PDF is supported for now' });
    }

    const parsed = await pdfParse(req.file.buffer);
    const text = (parsed.text || '').trim();
    if (!text) return res.status(400).json({ error: 'PDF has no extractable text' });

    const id = uuid();
    const chunks = chunkText(text);
    materials.set(id, { title: req.file.originalname, chunks });

    return res.json({ materialId: id, title: req.file.originalname, chunks: chunks.length });
  } catch (e) {
    console.error('Upload error:', e);
    return res.status(500).json({ error: 'Failed to process PDF' });
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
      type: { type: String, enum: ['ai', 'run'], required: true },
      question: String,           // for type 'ai'
      aiResponse: String,         // for type 'ai'
      code: String,              // captured code snapshot
      output: String,            // code output or current output context
      materialIds: [String],     // attached materials on that turn
      timestamp: { type: Date, default: Date.now },
      meta: Object               // room for future fields
    }
  ]
});

const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

// === Add under your other schemas ===
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
    } else {
      // Create new session with first interaction
      const newSession = new Session({
        userId: userId || null,
        interactions: [interaction]
      });
      await newSession.save();
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Usage log (run) failed:', err);
    return res.status(500).json({ success: false });
  }
});
