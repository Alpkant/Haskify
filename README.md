# Haskify 🚀

<div align="center">
  <img src="https://github.com/Ahmadkhdeir/haskify/blob/main/demo.gif?raw=true" width="600" alt="Haskify Demo"/>
  <br/>
  <em>An interactive web application for learning Haskell with AI-powered assistance</em>
</div>

## 📖 Overview

Haskify is a modern web application designed to make learning Haskell fun and interactive. It combines a powerful code editor with an AI assistant to provide a comprehensive learning experience for functional programming enthusiasts.

### ✨ Key Features

- **🖥️ Interactive Haskell Editor**: Write, compile, and run Haskell code directly in your browser
- **🤖 AI Assistant**: Get intelligent help and explanations for your Haskell code
- **📄 PDF Viewer**: Upload and view learning materials alongside your coding workspace
- **💬 Real-time Code Execution**: See your code output instantly with error handling
- **🎨 Modern UI**: Clean, responsive design built with React and Tailwind CSS
- **🔧 Full-stack Architecture**: Robust backend with Express.js and MongoDB integration

## 🏗️ Architecture

Haskify is built with a modern full-stack architecture:

- **Frontend**: React 19 with Vite, Tailwind CSS, Monaco Editor
- **Backend**: Node.js with Express.js
- **AI Integration**: DeepSeek API for intelligent code assistance
- **Database**: MongoDB for data persistence
- **Code Execution**: GHC (Glasgow Haskell Compiler) integration

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- GHC (Glasgow Haskell Compiler) - for code execution
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
   OPENAI_API_KEY=your_deepseek_api_key_here
   MONGODB_URI=your_mongodb_connection_string
   PORT=5001
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

### Writing Haskell Code

1. Use the **Code Editor** panel to write your Haskell functions
2. Click the **Run** button to compile and execute your code
3. View the output in the **Output** panel
4. For interactive programs, use the **Input** field to provide user input

### Getting AI Assistance

1. Type your questions in the **AI Assistant** panel
2. The AI will analyze your current code and provide helpful responses
3. Ask about:
   - Code explanations
   - Debugging help
   - Haskell concepts (monads, functors, etc.)
   - Best practices and patterns

### Working with Learning Materials

1. Upload PDF documents using the upload button
2. View materials in the PDF viewer
3. Reference materials while coding

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

- `POST /execute` - Execute Haskell code
- `POST /ai/ask` - Get AI assistance
- `POST /upload` - Upload PDF materials
- `GET /health` - Health check endpoint

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | DeepSeek API key for AI features | Required |
| `MONGODB_URI` | MongoDB connection string | Optional |
| `PORT` | Backend server port | 5001 |
| `VITE_API_URL` | Frontend API base URL | http://localhost:5001 |

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

- **Goethe University Frankfurt** - Academic support and resources
- **Monaco Editor** - Powerful code editing capabilities
- **DeepSeek** - AI language model integration
- **React Community** - Excellent documentation and tools

## 📞 Support

- **Issues**: Report bugs and request features on [GitHub Issues](https://github.com/Ahmadkhdeir/haskify/issues)
- **Documentation**: Check the [docs/](docs/) folder for detailed guides
- **Contact**: Reach out through the contact modal in the application

---

<div align="center">
  <strong>Happy Haskelling! 🎉</strong>
</div>