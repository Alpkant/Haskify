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
- Backend: Express, MongoDB, OpenAI API compatability for AI chat connection with local or global models, OpenAI embeddings.
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
   git clone https://github.com/Ahmadkhdeir/haskify.git
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
   OPENAI_API_KEY=your_openai_api_key_here
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

1. Upload PDF documents using the upload button
2. View materials in the PDF viewer
3. Reference materials while coding
4. You can upload system materials using admin-panel.html
5. AI also references system materials

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
- `POST /api/session/init`
- `POST /api/create-user` (admin key)
- `POST /api/admin/create-user`
- `POST /api/admin/upload-system-material`
- `GET /api/admin/system-materials`
- `POST /api/cleanup-session/:sessionId`
- `GET /health`

## 🔧 Configuration

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENROUTER_API_KEY` | Chat completions (Gemma 3 27B) | Required |
| `OPENAI_API_KEY` | Embeddings | Required |
| `MONGODB_URI` | Session storage | Required |
| `ADMIN_KEY` | Admin panel auth | Required |
| `PORT` / `VITE_API_URL` | Server + client URL | Required |
| `ORIGIN_WHITELIST` (if you add stricter CORS) | |

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
- **Ahmadkhedeir** - This repo is based on his Haskell version of Haskify. The base interaction and design created by him.
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
