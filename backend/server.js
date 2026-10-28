/* eslint-env node */
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';

import multer from 'multer';
import { RAG, MATERIAL_KINDS, COURSES } from './rag/config.js';
import { RagChunk, RagMaterial } from './rag/models.js';
import { IngestError, deleteMaterial, hashBuffer, ingestFile, previewChunks, setMaterialActive } from './rag/ingest.js';
import { buildRetrievalQuery, describeExcerpt, formatExcerptsForPrompt, retrieveContext } from './rag/retrieval.js';
import { ensureVectorIndex, getVectorIndexState, vectorIndexDefinition } from './rag/indexes.js';
import { detectFileType } from './rag/extract.js';

dotenv.config();
const execPromise = util.promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5001;

// Render terminates TLS at a proxy; without this every client shares the proxy IP and
// per-IP rate limits would lock out the whole class at once.
const trustProxy = process.env.TRUST_PROXY ?? (process.env.RENDER ? '1' : '');
if (trustProxy !== '') {
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
}

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH'], credentials: false }));
app.use(express.json({ limit: '2mb' }));

// Only failed user ID lookups count, so students logging in from the same campus network
// are not blocked by each other's successful logins.
const failedLoginMessage = {
  success: false,
  error: 'Too many failed login attempts from this network. Please wait and try again later.'
};
const loginFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: failedLoginMessage
});
const loginDailyFailureLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 150,
  skipSuccessfulRequests: true,
  standardHeaders: false,
  legacyHeaders: false,
  message: failedLoginMessage
});
const userLookupLimiters = [loginFailureLimiter, loginDailyFailureLimiter];

const executionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { output: "Too many requests, please try again later" }
});

const studentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RAG.uploadMaxBytes, files: 1 }
});

const adminUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RAG.adminUploadMaxBytes, files: 1 }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Too many uploads, please try again later' }
});

function runUpload(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, (error) => (error ? reject(error) : resolve()));
  });
}

function uploadErrorMessage(error, maxBytes) {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, error: `File too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB` };
  }
  if (error instanceof multer.MulterError) {
    return { status: 400, error: error.message };
  }
  return null;
}

// LiteLLM client for text generation (chat completions)
const chatClient = new OpenAI({
  apiKey: process.env.GOETHE_API_KEY,
  baseURL: "https://litellm.s.studiumdigitale.uni-frankfurt.de/v1/",
});

const MAIN_MODEL = "gwdg/gemma-4-31b-it";
const FALLBACK_MODEL = "gemma3:12b";

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

function cleanResponseText(text) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/^[:;,\.\-\s]+/, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function persistAiInteraction({ sessionId, userId, query, responseText, code, output, retrieved }) {
  const interaction = {
    type: 'ai',
    question: query || '',
    aiResponse: responseText || '',
    code: code || '',
    output: output || '',
    materialIds: Array.isArray(retrieved) ? retrieved.map(describeExcerpt) : [],
    timestamp: new Date()
  };

  if (sessionId) {
    await Session.findByIdAndUpdate(
      sessionId,
      {
        $push: { interactions: interaction },
        $set: {
          lastActivity: new Date(),
          ...(userId && { userId })
        }
      },
      { new: true }
    );
    return { sessionId };
  }

  const newSession = new Session({
    userId: userId || null,
    interactions: [interaction]
  });
  const savedSession = await newSession.save();
  return { sessionId: savedSession._id.toString() };
}

app.post('/ai/ask', async (req, res) => {
  try {
    const { query, code, output, sessionId, userId, materialIds, stream: useStream = true } = req.body;

    const simpleTestMessages = [
      'test','hello','hi','hey','cool','nice',
      'just testing','i am just testing','hello there','hi there','hallo','halo',"fuck you", "i don't care"
    ];
    const queryLower = (query || '').toLowerCase().trim();
    const isSimpleTest = simpleTestMessages.some(
      msg => queryLower === msg || (queryLower.includes(msg) && queryLower.length < 5)
    );
    if (isSimpleTest) {
      const quickResponse = "Hi! I'm here to help with Python programming. Ask me about lists, functions, classes, loops, or any Python concepts!";
      if (useStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        writeSse(res, { delta: quickResponse });
        writeSse(res, { done: true });
        return res.end();
      }
      return res.json({ response: quickResponse });
    }


    let quizHistorySummary = '';
    let previousQuestion = '';
    if (sessionId && mongoose.connection.readyState === 1) {
      try {
        const sessionDoc = await Session.findById(sessionId, { interactions: { $slice: -60 } }).lean();
        quizHistorySummary = summarizeRecentQuizzes(sessionDoc, 2);
        const lastAi = (sessionDoc?.interactions || []).filter((it) => it.type === 'ai' && it.question).pop();
        previousQuestion = lastAi?.question || '';
      } catch (err) {
        console.warn('Unable to load session history:', err?.message || err);
      }
    }

    const retrieved = mongoose.connection.readyState === 1
      ? await retrieveContext({
        query: buildRetrievalQuery({ question: query, output, previousQuestion }),
        sessionId,
        uploadIds: Array.isArray(materialIds) ? materialIds : undefined
      })
      : [];

    const contextSections = [];
    if (retrieved.length) {
      contextSections.push(
        'CONTEXT FROM COURSE SOURCES\n'
        + 'These excerpts were retrieved for this question. Use them when they are relevant, follow each Role line, '
        + 'and name the source briefly when it helps the student review it (for example "see EPI week 3 slides, p. 4"). '
        + 'If they do not cover the question, answer from general Python knowledge and say the material does not cover it.\n\n'
        + formatExcerptsForPrompt(retrieved)
      );
    }
    if (quizHistorySummary) {
      contextSections.push(quizHistorySummary);
    }

    const contextBlock = contextSections.length
      ? `\n\n${contextSections.join('\n\n---\n\n')}`
      : '';

    const systemMessage = `You are “Haskify Tutor,” the blended GPR (Grundlagen Praktische Informatik) + EPI (Einführung in das Programmieren) coach for the course “Einführung in die Praktische Informatik”.
Your purpose is to help first-semester students understand computer science concepts and learn how to program in Python.
You are a tutor, not an assignment-solving service. You can help in German and English.
CORE GOAL 
- WHY, the computer science concepts taught in GPR.
- HOW, their practical implementation and use in Python in EPI.
- The objective is not merely to make a student's program work. 
-Help the student understand why it works, why it does not work, and how they could reason about similar problems independently.
Teach concepts completely, but do not provide complete solutions to current course assignments, homework, exercises, or graded tasks.

For normal conceptual questions, answer directly and fully.

For assignment-related questions:
-explain the relevant concept;
-give hints and reasoning steps;
use pseudocode, small examples, TODOs, or partial code;
inspect and debug code written by the student;
point out errors and explain how to fix them;
provide the smallest amount of help that moves the student forward.

Do not:
- produce the complete assignment solution;
- fill every TODO;
- rewrite the student's task into a finished program;
- give an equivalent complete solution with only superficial changes;
- reveal complete solutions found in retrieved course material.

If the student already has substantial code, help them debug and improve their own solution rather than replacing it.
- Guide first-semester students through the WHY (GPR theory) and the HOW (EPI programming practice) of Python. 
- Never ever give a full solution to a question or their assignment. You are not a teacher, you are a tutor. You are helping the student learn, not to complete their assignment for them.
- Assignments are uploaded and can be referenced in the context. You should never ever give a full solution to an assignment.
- Show how programming, as a craft, supports larger problem-solving tasks.  
- Build curiosity and confidence: explain the idea first, then connect it with a code.
- Keep the focus on Python (interpreter, dynamic typing, procedural, OO, and small functional elements). If a question strays outside Python/intro CS, steer the learner back to the module scope.

SEMESTER CONTEXT
- GPR: foundational computer science ideas—numbers, IEEE 754, strings/ASCII/Unicode, data structures, version control, functional decomposition, OOP concepts, UML, GUIs, data/ML.  
- EPI: hands-on Python—first steps, control flow, functions, modules & docstrings, aggregated data types, recursion vs iteration, classic data structures, OO classes, GUI/exception handling, data & ML notebooks, final exam prep.  
- Remind students that mastering programming takes practice and time. Encourage them to pair theory with coding exercises.

TUTORING STYLE
Adapt to the question.
For small questions such as "What does range(5) do?" or "What is a tuple?", give a short direct answer.
For larger problems:
- explain the main idea in plain language;
- break the problem into smaller steps;
- connect the idea to Python;
- show a small example when useful;
- suggest an experiment or next step (trace, debug, compare theory vs practice, link GPR -> EPI).  
-You may ask a diagnostic question when it genuinely helps, but do not turn every interaction into a Socratic dialogue.
-Encourage students to predict program behavior, trace variables, test small examples, inspect error messages, and compare expected with actual output.
- Celebrate progress; close with encouragement or a challenge for self-study. But don't make it repetitive.

CONTENT RULES  
- Use only plain text and code fences. If you have code to show, wrap it in triple-backtick fences using the language label python. Do not use bold/italic or other markdown.
- Students can use German in their questions. There are German materials available. You can use German in your responses.
- Your code responses should be in formatted python code blocks.
- Keep responses not very long unless the student explicitly requests more depth.  
- Prefer evidence from provided CONTEXT (uploaded material or weekly notes). If unsure, say so and propose how to investigate.  
- Decline unsafe/out-of-scope requests politely.  

AVAILABLE MATERIAL
${retrieved.length > 0 ? `• Retrieved for this question: ${retrieved.map(describeExcerpt).join('; ')}.` : '• No course excerpt matched this question.'}

CURRENT WORKSPACE
\`\`\`python
${code || '# Student has not written code yet.'}
\`\`\`
${output ? `Most recent output:\n\`\`\`\n${output}\n\`\`\`` : ''}
${contextBlock}
Always connect answers back to the semester goals and keep the student actively learning.`;

    const workspaceMessage = [
      'CURRENT WORKSPACE:',
      code && code.trim().length
        ? `\`\`\`python\n${code}\n\`\`\``
        : '# Student has not written code yet.',
      output && output.trim().length
        ? `Most recent output:\n\`\`\`\n${output}\n\`\`\``
        : null,
      `STUDENT QUESTION:\n${query}`
    ].filter(Boolean).join('\n\n');

    let stream;
    const messages = [
      { role: "system", content: systemMessage },
      ...exampleConversations,
      { role: "user", content: workspaceMessage }
    ];
    const completionParams = {
      messages,
      stream: true,
      temperature: 0.35
    };

    try {
      stream = await chatClient.chat.completions.create({
        model: MAIN_MODEL,
        ...completionParams
      });
    } catch (err) {
      console.warn(`Main model (${MAIN_MODEL}) failed, switching to fallback (${FALLBACK_MODEL}):`, err.message);
      stream = await chatClient.chat.completions.create({
        model: FALLBACK_MODEL,
        ...completionParams
      });
    }

    if (useStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    let responseText = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (!delta) continue;
      responseText += delta;
      if (useStream) {
        writeSse(res, { delta });
      }
    }

    responseText = cleanResponseText(responseText);

    if (!responseText || responseText.length < 3) {
      responseText = "I'm here to help with Python. What would you like to know?";
      if (useStream) {
        writeSse(res, { delta: responseText });
      }
    }

    let resolvedSessionId = sessionId || null;
    try {
      const persisted = await persistAiInteraction({
        sessionId,
        userId,
        query,
        responseText,
        code,
        output,
        retrieved
      });
      resolvedSessionId = persisted.sessionId || resolvedSessionId;
    } catch (logErr) {
      console.warn('Session update failed:', logErr?.message);
    }

    if (useStream) {
      writeSse(res, { done: true, sessionId: resolvedSessionId || undefined, response: responseText });
      return res.end();
    }

    return res.json({
      response: responseText,
      ...(resolvedSessionId && !sessionId ? { sessionId: resolvedSessionId } : {})
    });
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
  // Legacy endpoint kept for backward compatibility — do nothing
  return res.json({ success: true, skipped: true });
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
  const { chatHistory = [], materialIds, sessionId } = req.body;
  
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
    const recentQuestions = (Array.isArray(chatHistory) ? chatHistory : [])
      .map((entry) => (typeof entry === 'string' ? entry : entry?.question))
      .filter((text) => typeof text === 'string' && text.trim())
      .slice(-3)
      .join('\n');
    if (recentQuestions && mongoose.connection.readyState === 1) {
      const excerpts = await retrieveContext({
        query: recentQuestions,
        sessionId,
        uploadIds: Array.isArray(materialIds) ? materialIds : undefined,
        limit: 3
      });
      if (excerpts.length) {
        context = formatExcerptsForPrompt(excerpts);
      }
    }
  } catch (err) {
    console.warn('Quiz context retrieval failed:', err?.message || err);
  }

  // Add variety instructions based on previous quizzes
  const previousTopics = sessionId && sessionHashes.size > 0 
    ? `\nYou have already generated ${sessionHashes.size} quiz(zes) in this session. Generate a question about a DIFFERENT Python topic or concept.`
    : '';

  let systemPrompt = `
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
      let completion;
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate the JSON quiz object described above. Recent chat: ${JSON.stringify(chatHistory.slice(-3))}` }
      ];
      const temperature = 1.2 + (attempts * 0.1);

      try {
        completion = await chatClient.chat.completions.create({
          model: MAIN_MODEL,
          messages,
          temperature
        });
      } catch (err) {
        console.warn(`Main model (${MAIN_MODEL}) failed for quiz, switching to fallback (${FALLBACK_MODEL}):`, err.message);
        completion = await chatClient.chat.completions.create({
          model: FALLBACK_MODEL,
          messages,
          temperature
        });
      }

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

app.post('/api/upload-material', uploadLimiter, async (req, res) => {
  try {
    await runUpload(studentUpload.single('file'), req, res);
  } catch (error) {
    const known = uploadErrorMessage(error, RAG.uploadMaxBytes);
    return res.status(known?.status || 400).json({ error: known?.error || 'Upload failed' });
  }

  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { sessionId, userId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Storage is unavailable, please try again shortly' });
    }

    const expiresAt = new Date(Date.now() + RAG.uploadTtlHours * 60 * 60 * 1000);
    const { material, chunks } = await ingestFile({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      mimetype: req.file.mimetype,
      source: 'upload',
      meta: { title: req.file.originalname },
      sessionId,
      userId: userId && userId !== 'null' ? userId : null,
      expiresAt,
      maxChunks: RAG.uploadMaxChunks
    });

    return res.json({
      materialId: material._id.toString(),
      title: material.title,
      chunks: chunks.length,
      expiresAt: expiresAt.toISOString()
    });
  } catch (e) {
    if (e instanceof IngestError) {
      return res.status(400).json({ error: e.message });
    }
    console.error('Upload error:', e);
    return res.status(500).json({ error: 'Failed to process file' });
  }
});

app.post('/api/upload-material/remove', async (req, res) => {
  try {
    const { materialId, sessionId } = req.body || {};
    if (!mongoose.isValidObjectId(materialId) || !sessionId) {
      return res.status(400).json({ error: 'materialId and sessionId required' });
    }
    const material = await RagMaterial.findOne(
      { _id: materialId, source: 'upload', sessionId: String(sessionId) },
      { _id: 1 }
    ).lean();
    if (!material) return res.json({ success: true, deleted: 0 });
    await deleteMaterial(material._id);
    return res.json({ success: true, deleted: 1 });
  } catch (error) {
    console.error('Upload removal error:', error);
    return res.status(500).json({ error: 'Failed to remove file' });
  }
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
    .then(async () => {
      console.log('MongoDB connected');
      const indexState = await ensureVectorIndex();
      console.log(`RAG vector index: ${indexState.status}${indexState.detail ? ` (${indexState.detail})` : ''}`);
      const refresh = setInterval(async () => {
        const next = await ensureVectorIndex({ create: false });
        if (next.status === 'ready' || next.status === 'unavailable') clearInterval(refresh);
      }, 60 * 1000);
      refresh.unref();
    })
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
app.post('/api/login', userLookupLimiters, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const trimmedUserId = userId.trim();
    const user = await User.findOne({ userId: trimmedUserId });

    if (!user) {
      console.warn(`Failed login attempt from ${req.ip}`);
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

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || '';
  const normalized = address.replace(/^::ffff:/i, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

function adminKeyMatches(provided) {
  const expected = process.env.ADMIN_KEY || '';
  if (!expected || typeof provided !== 'string' || provided.length === 0) {
    return false;
  }
  const given = Buffer.from(provided);
  const actual = Buffer.from(expected);
  if (given.length !== actual.length) return false;
  return crypto.timingSafeEqual(given, actual);
}

function assertLocalAdmin(req, res) {
  if (!isLoopbackRequest(req)) {
    res.status(404).json({ error: 'Not found' });
    return false;
  }
  const provided = req.get('x-admin-key') || req.body?.adminKey || req.query?.adminKey;
  if (!adminKeyMatches(provided)) {
    res.status(403).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

function parseUserIdList(input) {
  const source = Array.isArray(input) ? input.join('\n') : String(input || '');
  const seen = new Set();
  const userIds = [];
  for (const part of source.split(/[\n,;]+/)) {
    const userId = part.trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    userIds.push(userId);
  }
  return userIds;
}

app.get('/admin', (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, '..', 'admin-panel.html'));
});

// Create user endpoint
app.post('/api/create-user', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;

    const { userId } = req.body;
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const trimmedUserId = userId.trim();
    if (trimmedUserId.length > 128) {
      return res.status(400).json({ success: false, error: 'User ID is too long' });
    }

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

app.get('/api/admin/users', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;

    const users = await User.find({}, { userId: 1, createdAt: 1, lastLogin: 1 })
      .sort({ userId: 1 })
      .lean();

    return res.json({
      success: true,
      users: users.map((user) => ({
        userId: user.userId,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }))
    });
  } catch (err) {
    console.error('List users error:', err);
    return res.status(500).json({ success: false, error: 'Failed to list users' });
  }
});

app.post('/api/admin/users/batch', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;

    const requested = parseUserIdList(req.body?.userIds ?? req.body?.userIdsText);
    if (requested.length === 0) {
      return res.status(400).json({ success: false, error: 'Provide at least one User ID' });
    }
    if (requested.length > 500) {
      return res.status(400).json({ success: false, error: 'Add at most 500 User IDs at a time' });
    }

    const invalid = requested.filter((userId) => userId.length > 128);
    const valid = requested.filter((userId) => userId.length <= 128);
    const existing = await User.find({ userId: { $in: valid } }).select('userId').lean();
    const existingIds = new Set(existing.map((user) => user.userId));
    const alreadyExists = valid.filter((userId) => existingIds.has(userId));
    const toCreate = valid.filter((userId) => !existingIds.has(userId));

    if (toCreate.length > 0) {
      await User.insertMany(toCreate.map((userId) => ({ userId })));
    }

    return res.json({
      success: true,
      created: toCreate,
      alreadyExists,
      invalid
    });
  } catch (err) {
    console.error('Batch create users error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create users' });
  }
});

app.post('/api/admin/users/remove', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;

    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const result = await User.deleteOne({ userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.json({ success: true, userId });
  } catch (err) {
    console.error('Remove user error:', err);
    return res.status(500).json({ success: false, error: 'Failed to remove user' });
  }
});

// Verify session endpoint
app.get('/api/verify-session', userLookupLimiters, async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, error: 'User ID required' });
    }

    const user = await User.findOne({ userId: userId.trim() });
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
app.post('/api/session/init', userLookupLimiters, async (req, res) => {
  try {
    const { createIfMissing = true } = req.body;
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID required' });
    }

    if (!(await User.exists({ userId }))) {
      return res.status(404).json({ success: false, error: 'Invalid User ID' });
    }

    const thirtyMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const activeSession = await Session.findOne({
      userId,
      lastActivity: { $gte: thirtyMinutesAgo }
    }).sort({ lastActivity: -1 });

    if (activeSession) {
      return res.json({
        success: true,
        sessionId: activeSession._id.toString(),
        isNew: false
      });
    }

    if (!createIfMissing) {
      return res.json({ success: true, sessionId: null, isNew: false });
    }

    const newSession = new Session({
      userId,
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

app.post('/api/cleanup-session/:sessionId', async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId);
    const uploads = await RagMaterial.find({ source: 'upload', sessionId }, { _id: 1 }).lean();
    const ids = uploads.map((upload) => upload._id);
    await RagChunk.deleteMany({ materialId: { $in: ids } });
    const result = await RagMaterial.deleteMany({ _id: { $in: ids } });
    return res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    return res.status(500).json({ error: 'Cleanup failed' });
  }
});

const LEGACY_RAG_COLLECTIONS = ['systemmaterials', 'sessionmaterials', 'materialreferences'];

function serializeMaterial(material) {
  return {
    id: material._id.toString(),
    title: material.title,
    fileName: material.fileName,
    fileType: material.fileType,
    course: material.course,
    week: material.week,
    kind: material.kind,
    language: material.language,
    tags: material.tags || [],
    layout: material.layout,
    pageCount: material.pageCount,
    chunkCount: material.chunkCount,
    wordCount: material.wordCount,
    active: material.active,
    createdAt: material.createdAt
  };
}

function parseMaterialId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return mongoose.isValidObjectId(id) ? id : null;
}

async function legacyRagCounts() {
  const counts = {};
  const existing = new Set((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of LEGACY_RAG_COLLECTIONS) {
    counts[name] = existing.has(name)
      ? await mongoose.connection.db.collection(name).estimatedDocumentCount()
      : 0;
  }
  return counts;
}

app.get('/api/admin/rag/status', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;
    const [courseMaterials, courseChunks, uploadMaterials, uploadChunks, legacy] = await Promise.all([
      RagMaterial.countDocuments({ source: 'course' }),
      RagChunk.countDocuments({ source: 'course' }),
      RagMaterial.countDocuments({ source: 'upload' }),
      RagChunk.countDocuments({ source: 'upload' }),
      legacyRagCounts()
    ]);
    return res.json({
      success: true,
      vectorIndex: getVectorIndexState(),
      vectorIndexName: RAG.vectorIndexName,
      vectorIndexDefinition: vectorIndexDefinition(),
      embeddingModel: RAG.embeddingModel,
      embeddingDimensions: RAG.embeddingDimensions,
      uploadTtlHours: RAG.uploadTtlHours,
      courseMaterials,
      courseChunks,
      uploadMaterials,
      uploadChunks,
      legacy,
      kinds: MATERIAL_KINDS,
      courses: COURSES
    });
  } catch (error) {
    console.error('RAG status error:', error);
    return res.status(500).json({ success: false, error: 'Failed to read RAG status' });
  }
});

app.post('/api/admin/rag/refresh-index', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;
    const state = await ensureVectorIndex({ create: true });
    return res.json({ success: true, vectorIndex: state });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/rag/drop-legacy', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;
    const existing = new Set((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    const dropped = [];
    for (const name of LEGACY_RAG_COLLECTIONS) {
      if (existing.has(name)) {
        await mongoose.connection.db.dropCollection(name);
        dropped.push(name);
      }
    }
    return res.json({ success: true, dropped });
  } catch (error) {
    console.error('Drop legacy RAG error:', error);
    return res.status(500).json({ success: false, error: 'Failed to remove legacy collections' });
  }
});

app.get('/api/admin/materials', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;
    const materials = await RagMaterial.find({ source: 'course' })
      .sort({ course: 1, week: 1, title: 1 })
      .lean();
    return res.json({ success: true, materials: materials.map(serializeMaterial) });
  } catch (error) {
    console.error('List materials error:', error);
    return res.status(500).json({ success: false, error: 'Failed to list materials' });
  }
});

async function readAdminFile(req, res) {
  if (!assertLocalAdmin(req, res)) return false;
  try {
    await runUpload(adminUpload.single('file'), req, res);
  } catch (error) {
    const known = uploadErrorMessage(error, RAG.adminUploadMaxBytes);
    res.status(known?.status || 400).json({ success: false, error: known?.error || 'Upload failed' });
    return false;
  }
  if (!req.file) {
    res.status(400).json({ success: false, error: 'No file uploaded' });
    return false;
  }
  if (!detectFileType(req.file.originalname, req.file.mimetype)) {
    res.status(400).json({ success: false, error: 'Only PDF, .py, .ipynb, .md, and .txt files are supported' });
    return false;
  }
  return true;
}

app.post('/api/admin/materials/preview', async (req, res) => {
  if (!await readAdminFile(req, res)) return;
  try {
    const preview = await previewChunks({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      mimetype: req.file.mimetype,
      meta: req.body
    });
    return res.json({ success: true, fileName: req.file.originalname, ...preview });
  } catch (error) {
    if (error instanceof IngestError) return res.status(400).json({ success: false, error: error.message });
    console.error('Preview error:', error);
    return res.status(500).json({ success: false, error: 'Failed to preview file' });
  }
});

app.post('/api/admin/materials', async (req, res) => {
  if (!await readAdminFile(req, res)) return;
  try {
    const fileName = req.file.originalname;
    const contentHash = hashBuffer(req.file.buffer);
    const course = Object.hasOwn(COURSES, req.body.course) ? req.body.course : 'general';

    const unchanged = await RagMaterial.findOne({ source: 'course', contentHash }).lean();
    if (unchanged) {
      return res.json({ success: true, status: 'unchanged', material: serializeMaterial(unchanged) });
    }

    const previous = await RagMaterial.findOne({ source: 'course', course, fileName }).lean();
    const { material, chunks } = await ingestFile({
      buffer: req.file.buffer,
      fileName,
      mimetype: req.file.mimetype,
      source: 'course',
      meta: req.body
    });
    if (previous) {
      await deleteMaterial(previous._id);
    }

    return res.json({
      success: true,
      status: previous ? 'replaced' : 'added',
      material: serializeMaterial(material),
      chunks: chunks.length
    });
  } catch (error) {
    if (error instanceof IngestError) return res.status(400).json({ success: false, error: error.message });
    console.error('Material upload error:', error);
    return res.status(500).json({ success: false, error: `Failed to process file: ${error.message}` });
  }
});

app.post('/api/admin/materials/active', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;
    const materialId = parseMaterialId(req.body?.materialId);
    if (!materialId) return res.status(400).json({ success: false, error: 'materialId is required' });
    const updated = await setMaterialActive(materialId, req.body?.active);
    if (!updated) return res.status(404).json({ success: false, error: 'Material not found' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Toggle material error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update material' });
  }
});

app.post('/api/admin/materials/remove', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;
    const materialId = parseMaterialId(req.body?.materialId);
    if (!materialId) return res.status(400).json({ success: false, error: 'materialId is required' });
    const removed = await deleteMaterial(materialId);
    if (!removed) return res.status(404).json({ success: false, error: 'Material not found' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Remove material error:', error);
    return res.status(500).json({ success: false, error: 'Failed to remove material' });
  }
});

app.post('/api/admin/rag/search', async (req, res) => {
  try {
    if (!assertLocalAdmin(req, res)) return;
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) return res.status(400).json({ success: false, error: 'query is required' });
    const result = await retrieveContext({ query, debug: true });
    return res.json({
      success: true,
      ...result,
      excerpts: result.excerpts.map((excerpt) => ({ ...excerpt, label: describeExcerpt(excerpt) }))
    });
  } catch (error) {
    console.error('RAG search error:', error);
    return res.status(500).json({ success: false, error: 'Search failed' });
  }
});

