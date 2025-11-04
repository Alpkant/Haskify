import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import './PythonEditor.css';

let editorInstance = null;
let pyodideInstance = null;

// Add console output capture
let consoleOutput = [];

const stdout = (msg) => {
  consoleOutput.push(String(msg));
  console.log(msg);
};

export default function PythonEditor({ sharedState, updateSharedState }) {
  const [isRunning, setIsRunning] = useState(false);
  const [isPyodideReady, setIsPyodideReady] = useState(false);
  const [changedLines, setChangedLines] = useState([]);
  const [userInput, setUserInput] = useState('');

  // Initialize Pyodide
  useEffect(() => {
    const initPyodide = async () => {
      try {
        updateSharedState({ output: "> Initializing Python environment..." });
        
        // Clear console output before initialization
        consoleOutput = [];
        
        // Dynamic import to avoid bundling issues
        const { loadPyodide } = await import('pyodide');
        
        pyodideInstance = await loadPyodide({
          indexURL: `https://cdn.jsdelivr.net/pyodide/v0.28.3/full/`,
          stdout: stdout,
          stderr: stdout,
          checkAPIVersion: true,
        });
        
        // Load common packages for CS students
        await pyodideInstance.loadPackage([
          'numpy',      // For numerical computations and arrays
          'pandas',     // For data analysis and manipulation
          'matplotlib', // For data visualization
          'scipy',      // For scientific computing
          'scikit-learn', // For machine learning
          'scikit-image', // For image processing
          'pyodide-http',  // For better HTTP support
          'micropip',      // For installing additional packages
        ]);
        
        setIsPyodideReady(true);
        updateSharedState({ output: "> Python environment ready!" });
      } catch (error) {
        console.error('Failed to initialize Pyodide:', error);
        updateSharedState({ output: `> Error: Failed to initialize Python environment` });
      }
    };

    initPyodide();
  }, []);

  useEffect(() => {
    if (editorInstance && changedLines.length > 0) {
      // Create decorations for changed lines
      const decorations = changedLines.map(line => ({
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1
        },
        options: {
          isWholeLine: true,
          className: 'highlight-line',
          stickiness: 1
        }
      }));

      const decorationIds = editorInstance.deltaDecorations([], decorations);

      const timer = setTimeout(() => {
        editorInstance.deltaDecorations(decorationIds, []);
        setChangedLines([]);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [changedLines]);

  const handleEditorDidMount = (editor) => {
    editorInstance = editor;
  };

  const handleRunCode = async () => {
    if (!isPyodideReady) {
      updateSharedState({ output: "> Error: Python environment not ready yet" });
      return;
    }

    setIsRunning(true);
    updateSharedState({ output: "> Running Python code..." });

    try {
      const code = sharedState.code;
      
      if (!code || code.trim() === '') {
        updateSharedState({ output: "> No code to execute" });
        setIsRunning(false);
        return;
      }

      // Clear console output before running new code
      consoleOutput = [];
      
      const result = pyodideInstance.runPython(code);
      
      // Combine console output and result
      let output = "";
      
      // Add console output (print statements, etc.)
      if (consoleOutput.length > 0) {
        output += consoleOutput.join('\n');
      }
      
      // Add the result if there is one
      if (result !== undefined && result !== null) {
        if (output) output += '\n';
        output += String(result);
      }
      
      updateSharedState({ 
        output: output || "> Program executed (no output)" 
      });

      // Log the code execution
      try {
        const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
        const savedUser = localStorage.getItem('haskify_user');
        const userId = savedUser ? JSON.parse(savedUser).userId : null;
        
        // Get sessionId from localStorage (set by AI Assistant)
        const savedSessionId = sessionStorage.getItem('haskify_session');
        
        console.log('📝 Logging code execution...');
        console.log('  API:', API_BASE);
        console.log('  UserId:', userId);
        console.log('  SessionId:', savedSessionId || 'None (will create new)');
        
        const response = await fetch(`${API_BASE}/api/log/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId, 
            sessionId: savedSessionId,
            code: code,
            output: output || "> Program executed (no output)"
          })
        });

        console.log('  Response status:', response.status);
        
        if (!response.ok) {
          console.error('  Failed to log:', await response.text());
          return;
        }

        // Save the sessionId if a new one was created
        const logResult = await response.json();
        console.log('  [PythonEditor] Log result:', logResult);

        if (logResult.sessionId && !savedSessionId) {
          sessionStorage.setItem('haskify_session', logResult.sessionId);
          console.log('✓ [PythonEditor] Created and saved new session:', logResult.sessionId.substring(0, 8) + '...');
        } else if (savedSessionId) {
          console.log('✓ [PythonEditor] Code logged to existing session:', savedSessionId.substring(0, 8) + '...');
        }

      } catch (logErr) {
        console.error('❌ Code execution log failed:', logErr);
      }

    } catch (error) {
      console.error('Python execution error:', error);
      updateSharedState({ 
        output: `> Error: ${error.message || "Python execution failed"}` 
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="editor-container">
      <div className="editor-section">
        <Editor
          height="100%"
          language="python"
          theme="vs-dark"
          value={sharedState.code}
          onChange={(value) => updateSharedState({ code: value || '' })}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: 'on',
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            padding: { top: 20 },
            renderLineHighlight: 'none',
            lineDecorationsWidth: 10,
            glyphMargin: false,
            lineNumbersMinChars: 3,
            folding: false,
            autoClosingBrackets: 'always',
            formatOnType: true,
            suggestOnTriggerCharacters: true,
            tabSize: 4,
            insertSpaces: true
          }}
        />
      </div>

      <div className="input-field-container">
        <input
          type="text"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Enter input for your program..."
          className="program-input"
        />
      </div>

      <div className="output-section">
        <div className="output-header">
          <h3 className='output-title'>Output</h3>
          <div className="status-indicator">
            <button 
              className="run-button"
              onClick={handleRunCode}
              disabled={isRunning || !isPyodideReady}
            >
              {isRunning ? 'Running...' : 'Run'}
            </button>
          </div>
        </div>
        <pre className="output-content">
          {sharedState.output}
        </pre>
      </div>
    </div>
  );
}