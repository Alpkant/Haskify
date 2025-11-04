import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import './PythonEditor.css';
import { usePython } from 'react-py';

let editorInstance = null;

export default function PythonEditor({ sharedState, updateSharedState }) {
  const {
    runPython,
    stdout,
    stderr,
    isLoading,
    isRunning,
    interruptExecution,
    isAwaitingInput,  // ← NEW: Detects when Python calls input()
    sendInput,        // ← NEW: Sends user input to Python
    prompt            // ← NEW: The prompt text from input("prompt")
  } = usePython();

  const [inputValue, setInputValue] = useState('');
  const [showOutput, setShowOutput] = useState(false);

  const handleEditorDidMount = (editor) => {
    editorInstance = editor;
  };

  const handleRunCode = async () => {
    const code = sharedState.code;
    
    if (!code || code.trim() === '') {
      updateSharedState({ output: "> No code to execute" });
      return;
    }

    // Clear previous output and run
    setShowOutput(false);
    updateSharedState({ output: "> Running Python code..." });
    
    try {
      await runPython(code);
      setShowOutput(true);
      
      // Combine stdout and stderr
      let output = "";
      if (stdout) output += stdout;
      if (stderr) {
        if (output) output += '\n';
        output += stderr;
      }
      
      const finalOutput = output || "> Program executed (no output)";
      updateSharedState({ output: finalOutput });

      // Log to backend
      await logToBackend(code, finalOutput);

    } catch (error) {
      console.error('Python execution error:', error);
      const errorMsg = stderr || error.message || "Python execution failed";
      updateSharedState({ output: `> Error:\n${errorMsg}` });
      setShowOutput(true);
    }
  };

  const logToBackend = async (code, output) => {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
      const savedUser = localStorage.getItem('haskify_user');
      const userId = savedUser ? JSON.parse(savedUser).userId : null;
      
      const savedSessionId = sessionStorage.getItem('haskify_session');
      
      const response = await fetch(`${API_BASE}/api/log/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, 
          sessionId: savedSessionId,
          code: code,
          output: output
        })
      });

      if (response.ok) {
        const logResult = await response.json();
        
        if (logResult.sessionId && !savedSessionId) {
          sessionStorage.setItem('haskify_session', logResult.sessionId);
          console.log('✓ [PythonEditor] Created new session:', logResult.sessionId.substring(0, 8) + '...');
        }
      }
    } catch (logErr) {
      console.error('❌ Code execution log failed:', logErr);
    }
  };

  const handleStop = () => {
    interruptExecution();
    setShowOutput(false);
    updateSharedState({ output: "> Execution interrupted" });
  };

  const handleInputSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim()) {
      sendInput(inputValue);  // Send input to Python
      setInputValue('');       // Clear input field
    }
  };

  const handleInputKeyPress = (e) => {
    if (e.key === 'Enter' && !isAwaitingInput) {
      e.preventDefault();
      handleRunCode();
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
            insertSpaces: true,
            readOnly: isRunning  // Disable editing while running
          }}
        />
      </div>

      {/* Real-time input prompt (shows when Python calls input()) */}
      {isAwaitingInput && (
        <div className="input-prompt-overlay">
          <div className="input-prompt-box">
            <p className="input-prompt-text">
              {prompt || 'Python is waiting for input:'}
            </p>
            <form onSubmit={handleInputSubmit}>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Enter value..."
                className="input-prompt-field"
                autoFocus
              />
              <button type="submit" className="input-prompt-button">
                Submit
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Optional: Pre-input field for batch inputs (if you want to keep it) */}
      {!isAwaitingInput && !isRunning && (
        <div className="input-field-container">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleInputKeyPress}
            placeholder="Press Enter to run code..."
            className="program-input"
          />
        </div>
      )}

      <div className="output-section">
        <div className="output-header">
          <h3 className='output-title'>Output</h3>
          <div className="status-indicator">
            {isRunning && (
              <button 
                className="stop-button"
                onClick={handleStop}
                title="Stop execution"
              >
                Stop
              </button>
            )}
            <button 
              className="run-button"
              onClick={handleRunCode}
              disabled={isRunning || isLoading}
            >
              {isRunning ? 'Running...' : isLoading ? 'Loading Python...' : 'Run'}
            </button>
          </div>
        </div>
        {showOutput && (
          <pre className="output-content">
            {sharedState.output}
          </pre>
        )}
      </div>
    </div>
  );
}