# Haskify 🚀

<div align="center">
  <img src="https://github.com/Alpkant/haskify/blob/main/demo.gif?raw=true" width="600" alt="Haskify Demo"/>
  <br/>
  <em>An interactive web application for learning Python and programming with AI-powered assistance</em>
</div>

Haskify is a Python-first practice studio. It pairs a live Pyodide-backed editor, contextual AI help, quiz drills, and session logging so students can run code, ask follow-up questions, and keep their progress synced across visits.

## 📖 Overview

Haskify is a modern web application designed to make learning Python and programming fun and interactive. It combines a powerful code editor with an AI assistant to provide a comprehensive learning experience for students.

### ✨ Key Features

- `Live Python editor` (react-py, interrupt button, input support).
- `AI assistant with workspace context` (code/output automatically streamed, RAG on uploaded materials).
- `Quiz generator + answer logging`.
- `Session timeline` (interactions stored in Mongo, resume on reload).
- `Admin console` (upload system materials, create users, view status).
- Optional: `Anonymous sessions` auto-create on first interaction.

## 🏗️ Architecture

Haskify is built with a modern full-stack architecture:

- Frontend: React + Vite + Ace editor + react-py.
- Backend: Express, MongoDB, OpenAI API compatability for AI chat connection with local or global models, Qwen3 embeddings through the university LiteLLM gateway.
- Execution: Pyodide/React-Py
- Security bits (COOP/COEP, admin key, rate limiting).

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- MongoDB (optional, for advanced features)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Alpkant/haskify.git
   cd haskify
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Install backend dependencies**:
   ```bash
   cd backend
   npm install
   cd ..
   ```

4. **Set up environment variables**:
   Create a `.env` file in the backend directory:
   ```env
   OPENROUTER_API_KEY=your_aimodel_api_key_here
   GOETHE_API_KEY=your_litellm_gateway_key_here
   MONGODB_URI=your_mongodb_connection_string
   PORT=5001
   VITE_API_URL=http://localhost:5001
   ADMIN_KEY=your_admin_key_here
   ORIGIN_WHITELIST=http://localhost:5173
   ```

5. **Start the development servers**:
   ```bash
   # Start both frontend and backend concurrently
   npm run dev-all
   
   # Or start them separately:
   # Frontend only
   npm run dev
   
   # Backend only
   npm run start-backend
   ```

6. **Open your browser**:
   Navigate to `http://localhost:5173` to access the application.

## 🎯 Usage

### Writing Python Code

1. Use the **Code Editor** panel to write your Python code
2. Click the **Run** button to execute your code
3. View the output in the **Output** panel
4. For interactive programs, use the **Input** field to provide user input

### Getting AI Assistance

1. Type your questions in the **AI Assistant** panel
2. The AI will analyze your current code, system materials and provide helpful responses
3. Ask about:
   - Code explanations
   - Debugging help
   - Python and programming concepts
   - Best practices and patterns

### Working with Learning Materials

1. Students can attach a PDF, `.py`, `.ipynb`, `.md`, or `.txt` file (up to 5 MB) in the chat. It is searchable for that student for 4 hours, then MongoDB deletes it.
2. Course material (slides, scripts, assignment sheets, notebooks, code examples) is uploaded from the local admin page at `http://localhost:5001/admin` and stays available to the tutor until removed or switched off.
3. For each question the tutor receives up to four excerpts with their source, for example "EPI week 3 lecture slides, p. 4". Assignment excerpts are marked so the tutor explains the task without solving it.

### Course material retrieval

- Files are split by structure: one slide per chunk for decks, headings and tasks for scripts and sheets, cells for notebooks, functions and classes for Python files.
- Each chunk is embedded with `qwen3-embedding-8b` at 1024 dimensions through the university LiteLLM gateway, together with a short header naming the course, week, type, title, and section. Questions get a short retrieval instruction in front, as Qwen3 expects. Changing the model or dimensions in `backend/rag/config.js` requires re-uploading all course material.
- Search combines Atlas Vector Search (index `rag_vector`, created automatically on startup) with a MongoDB text index, then adds neighbouring chunks from the same task or section.
- Use the admin page to preview chunking before uploading and to test which excerpts a question retrieves.
- Measure retrieval with real questions: copy `backend/scripts/rag-eval.example.json` to `backend/scripts/rag-eval.json`, fill in questions and the file or page that should answer them, and run `npm run rag:eval` in `backend`.
- Compare embedding models with `npm run rag:bench` in `backend`. It scores each model on the passages and questions in `backend/scripts/embedding-benchmark.data.json` without touching the database.

## 🛠️ Development

### Project Structure

```
haskify/
├── src/                    # Frontend React application
│   ├── Components/        # React components
│   │   ├── AIAssistant/   # AI chat interface
│   │   ├── PythonEditor/ # Code editor component
│   │   ├── Header/        # Navigation header
│   │   ├── Footer/        # Footer component
│   │   └── ...
│   ├── pages/             # Page components
│   └── utils/             # Utility functions
├── backend/               # Node.js/Express server
│   ├── server.js         # Main server file
│   └── package.json      # Backend dependencies
├── public/               # Static assets
└── docs/                 # Documentation
```

### Available Scripts

- `npm run dev` - Start frontend development server
- `npm run start-backend` - Start backend server
- `npm run dev-all` - Start both frontend and backend
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build

### API Endpoints

- `POST /ai/ask`
- `POST /run-python`
- `POST /api/log/run`
- `POST /api/log/quiz`
- `POST /api/upload-material`
- `POST /api/upload-material/remove`
- `POST /api/session/init`
- `POST /api/cleanup-session/:sessionId`

Admin routes only answer requests from the same computer and need the admin key in the `x-admin-key` header:

- `GET /admin`
- `POST /api/create-user`
- `GET /api/admin/users`, `POST /api/admin/users/batch`, `POST /api/admin/users/remove`
- `GET /api/admin/materials`, `POST /api/admin/materials`, `POST /api/admin/materials/preview`
- `POST /api/admin/materials/active`, `POST /api/admin/materials/remove`
- `GET /api/admin/rag/status`, `POST /api/admin/rag/search`, `POST /api/admin/rag/refresh-index`, `POST /api/admin/rag/drop-legacy`
- `GET /health`

## 🔧 Configuration

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENROUTER_API_KEY` | Chat completions (Gemma 3 27B) | Required |
| `GOETHE_API_KEY` | Chat completions and embeddings (LiteLLM gateway) | Required |
| `OPENAI_API_KEY` | Only for the OpenAI row in `npm run rag:bench` | Optional |
| `MONGODB_URI` | Session storage | Required |
| `ADMIN_KEY` | Admin panel auth | Required |
| `PORT` / `VITE_API_URL` | Server + client URL | Required |
| `ORIGIN_WHITELIST` (if you add stricter CORS) | |
| `UPLOAD_TTL_HOURS` | How long student uploads stay searchable | `4` |
| `UPLOAD_MAX_MB` | Maximum student upload size | `5` |
| `RAG_MIN_SIMILARITY` | Minimum cosine similarity for an excerpt | `0.45` |

### Customization

- **Editor Theme**: Modify `src/Components/PythonEditor/PythonEditor.jsx`
- **AI Behavior**: Adjust prompts in `backend/server.js`
- **Styling**: Customize Tailwind classes in component CSS files

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Ensure all linting checks pass

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments
- [**Ahmadkhedeir**](http://github.com/Ahmadkhdeir/haskify) - This repo is based on his Haskell version of Haskify. The base interaction and design created by him.
- **Goethe University Frankfurt** - Academic support and resources
- **Monaco Editor** - Powerful code editing capabilities
- **DeepSeek** - AI language model integration
- **React Community** - Excellent documentation and tools

## 📞 Support

- **Issues**: Report bugs and request features on [GitHub Issues](https://github.com/Alpkant/haskify/issues)
- **Documentation**: Check the [docs/](docs/) folder for detailed guides
- **Contact**: Reach out through the contact modal in the application

---

<div align="center">
  <strong>Happy coding! 🎉</strong>
</div>
